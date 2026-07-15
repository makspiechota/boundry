#!/usr/bin/env node
/**
 * A/B run orchestration.
 *
 * Per spec, runs the same agent twice from the same pinned baseline:
 *   control    — the repo as it is. No diagram, no gate.
 *   treatment  — same repo, same prompt, plus the drawn architecture and a
 *                Boundry Stop-hook gate that blocks the turn while violations
 *                remain (see boundry-gate.mjs).
 *
 * The arms differ in exactly one thing: whether Boundry is in the loop. The
 * prompt, the model, the baseline commit and the spec are byte-identical.
 *
 * Usage:
 *   node benchmark/runner/run.mjs --spec 01-order-history --arm both [--model opus]
 *                                 [--runs 1] [--keep] [--budget 5]
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(RUNNER_DIR, '..');
const BOUNDRY_HOME = resolve(BENCH, '..');

const args = process.argv.slice(2);
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (flag) => args.includes(flag);

const specId = opt('--spec', '01-order-history');
const arm = opt('--arm', 'both');
const model = opt('--model', 'opus');
const runs = Number(opt('--runs', '1'));
const budget = opt('--budget', '5');
const keep = has('--keep');

const baseline = JSON.parse(readFileSync(join(BENCH, 'baseline.json'), 'utf8'));
const REPO = resolve(BENCH, baseline.repo);
const ARCH = join(BENCH, baseline.arch);
const SPEC_PATH = join(BENCH, 'specs', `${specId}.md`);

if (!existsSync(SPEC_PATH)) {
  console.error(`No such spec: ${SPEC_PATH}`);
  process.exit(2);
}
const specText = readFileSync(SPEC_PATH, 'utf8');

const sh = (cmd, cmdArgs, cwd) =>
  execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The prompt. Identical in both arms — this is load-bearing for validity. */
function buildPrompt() {
  return [
    'Implement the following specification in this repository.',
    '',
    'Read the repo first (CLAUDE.md, docs/conventions.md) and follow its existing conventions.',
    'Write the tests the spec asks for, and make sure `npx vitest run --root backend` passes',
    'before you finish.',
    '',
    '--- SPECIFICATION ---',
    specText,
  ].join('\n');
}

/**
 * Treatment-only. Boundry's real-world affordance: the diagram is in the repo
 * and the agent is told the gate exists. Appended to the system prompt so the
 * user-facing task text stays byte-identical across arms.
 */
function treatmentSystemAppend(worktree) {
  return [
    "This repository's architecture is drawn as a LikeC4 diagram at arch/promo-shop.likec4,",
    'and it is enforced by Boundry as a hard gate — not a guideline.',
    '',
    'Every relationship drawn in that diagram is an ALLOWED dependency between folders.',
    'Any import that crosses a boundary the diagram does not draw is a build failure.',
    'Read the diagram before you design your change.',
    '',
    'Check your work at any time with:',
    `  npx tsx ${join(BOUNDRY_HOME, 'src/cli/index.ts')} check --arch ${join(worktree, 'arch')} --cwd ${join(worktree, baseline.checkCwd)} src`,
    '',
    'The diagram is the specification. Do not edit it to make your code pass.',
  ].join('\n');
}

function setupWorktree(dir) {
  rmSync(dir, { recursive: true, force: true });
  // Detached at the pinned SHA: every run starts from byte-identical source.
  sh('git', ['worktree', 'add', '--detach', '--force', dir, baseline.sha], REPO);
  // npm workspaces hoist, and the deps are identical at the baseline commit, so
  // linking beats a multi-minute `npm ci` per run.
  for (const nm of baseline.nodeModules) {
    const target = join(REPO, nm);
    if (existsSync(target)) {
      mkdirSync(dirname(join(dir, nm)), { recursive: true });
      symlinkSync(target, join(dir, nm), 'dir');
    }
  }
}

function armSettings(armName, dir, outDir) {
  if (armName !== 'treatment') return null;
  const settings = {
    hooks: {
      Stop: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: `node ${join(RUNNER_DIR, 'boundry-gate.mjs')}` }],
        },
      ],
    },
  };
  const path = join(outDir, 'settings.json');
  writeFileSync(path, JSON.stringify(settings, null, 2));
  return path;
}

function runArm(armName, runIndex) {
  const runId = `${specId}/${armName}/run-${String(runIndex).padStart(2, '0')}`;
  const outDir = join(BENCH, 'results', specId, armName, `run-${String(runIndex).padStart(2, '0')}`);
  const worktree = join(BENCH, '.worktrees', `${specId}-${armName}-${runIndex}`);

  mkdirSync(outDir, { recursive: true });
  console.log(`\n=== ${runId} ===`);
  setupWorktree(worktree);

  if (armName === 'treatment') {
    // The diagram ships with the repo the agent sees, as it would in real use.
    cpSync(ARCH, join(worktree, 'arch'), { recursive: true });
  }

  const settingsPath = armSettings(armName, worktree, outDir);
  const gateLog = join(outDir, 'gate.jsonl');

  // Scoped to what implementing a spec actually needs: read the repo, edit it,
  // run the tests. No blanket permission bypass — a benchmark agent with
  // unrestricted reach is both a hazard and a reproducibility problem. Both
  // arms get the identical allowlist, so the comparison is unaffected.
  const cmd = [
    '--print',
    '--model', model,
    '--output-format', 'json',
    '--max-budget-usd', budget,
    '--permission-mode', 'acceptEdits',
    '--allowedTools',
    'Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite',
    'Bash(npx vitest:*)', 'Bash(npx tsc:*)', 'Bash(npx tsx:*)',
    'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(ls:*)',
    '--disallowedTools', 'WebFetch', 'WebSearch', 'Task',
  ];
  if (settingsPath) cmd.push('--settings', settingsPath);
  if (armName === 'treatment') cmd.push('--append-system-prompt', treatmentSystemAppend(worktree));
  cmd.push(buildPrompt());

  const started = Date.now();
  let agentOut = '';
  let failed = false;
  try {
    agentOut = execFileSync('claude', cmd, {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        BOUNDRY_HOME,
        GATE_ARCH: join(worktree, 'arch'),
        GATE_CWD: join(worktree, baseline.checkCwd),
        GATE_LOG: gateLog,
        GATE_MAX: '6',
      },
    });
  } catch (err) {
    failed = true;
    agentOut = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    console.error(`  ! agent exited non-zero`);
  }
  const wallMs = Date.now() - started;
  writeFileSync(join(outDir, 'agent-output.json'), agentOut);

  // Capture what the agent actually did, before we measure it. Harness
  // scaffolding is excluded by pathspec so the two arms' patches stay
  // comparable — note info/exclude is shared with the main repo and must not
  // be touched. Diagram tampering is detected by content, not by git.
  // `.gitignore` says `node_modules/`, and a trailing slash does not match a
  // symlink — so the linked dirs must be excluded by hand.
  const notScaffolding = [
    '--', '.',
    ':(exclude)arch', ':(exclude).claude',
    ':(exclude)node_modules', ':(exclude)*/node_modules',
  ];
  sh('git', ['add', '-A', ...notScaffolding], worktree);
  const patch = sh('git', ['diff', '--cached', baseline.sha, ...notScaffolding], worktree);
  writeFileSync(join(outDir, 'changes.patch'), patch);
  const files = sh('git', ['diff', '--cached', '--stat', baseline.sha, ...notScaffolding], worktree);
  writeFileSync(join(outDir, 'changes.stat'), files);

  // Did the agent's own tests pass? Drift only counts if the feature works.
  let testsPass = false;
  let testOut = '';
  try {
    testOut = sh('npx', ['vitest', 'run', '--root', 'backend'], worktree);
    testsPass = true;
  } catch (err) {
    testOut = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  writeFileSync(join(outDir, 'tests.txt'), testOut);

  writeFileSync(
    join(outDir, 'run.json'),
    JSON.stringify(
      { runId, spec: specId, arm: armName, model, baseline: baseline.sha, wallMs, agentFailed: failed, testsPass },
      null,
      2,
    ),
  );

  console.log(`  tests: ${testsPass ? 'pass' : 'FAIL'}  (${(wallMs / 1000).toFixed(0)}s)`);
  return { outDir, worktree };
}

const armsToRun = arm === 'both' ? ['control', 'treatment'] : [arm];
const produced = [];
for (let i = 1; i <= runs; i++) {
  for (const a of armsToRun) produced.push(runArm(a, i));
}

// Measure every run with the same yardstick, from outside the arms.
console.log('\n=== measuring ===');
for (const { outDir, worktree } of produced) {
  execFileSync('node', [join(RUNNER_DIR, '..', 'metrics', 'measure.mjs'), '--run', outDir, '--worktree', worktree], {
    stdio: 'inherit',
  });
}

if (!keep) {
  for (const { worktree } of produced) {
    rmSync(worktree, { recursive: true, force: true });
  }
  sh('git', ['worktree', 'prune'], REPO);
} else {
  console.log(`\nWorktrees kept under ${join(BENCH, '.worktrees')}`);
}
