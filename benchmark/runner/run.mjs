#!/usr/bin/env node
/**
 * A/B/C run orchestration.
 *
 * Per spec, runs the same agent from the same pinned baseline under three arms:
 *
 *   no-diagram    — the repo as it is. The agent has CLAUDE.md's conventions
 *                   and nothing else. Establishes the natural drift rate.
 *   diagram-only  — the architecture diagram is in the repo and the agent is
 *                   told to follow it. No gate. This is the rival hypothesis —
 *                   "just document the architecture" — and it is deliberately
 *                   the strongest version of it, so a Boundry win is not a
 *                   straw man.
 *   boundry       — same diagram, plus the Stop-hook gate that blocks the turn
 *                   while violations remain (see boundry-gate.mjs).
 *
 * Successive arms add exactly one variable: knowledge of the architecture, then
 * enforcement of it. Prompt, model, baseline commit, spec and tool allowlist are
 * identical throughout.
 *
 * Note the `boundry` arm is clean largely *by construction* — the gate will not
 * let it stop otherwise. The load-bearing evidence is therefore the drift rate
 * of the two unenforced arms, plus this arm's convergence and collateral cost.
 * See ANALYSIS.md.
 *
 * Usage:
 *   node benchmark/runner/run.mjs --spec 01-order-history --arm all [--model opus]
 *                                 [--runs 1] [--keep] [--budget 5]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const ARMS = ['no-diagram', 'diagram-only', 'boundry'];
/** Arms that see the diagram at all. */
const ARMS_WITH_DIAGRAM = new Set(['diagram-only', 'boundry']);

const specId = opt('--spec', '01-order-history');
const arm = opt('--arm', 'all');
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
 * What each arm is told about the architecture. Appended to the system prompt so
 * the task text itself stays byte-identical across arms.
 *
 * The two diagram arms share an identical description of the architecture and an
 * identical instruction to obey it. They differ only in whether that instruction
 * is *enforced*. Keeping the shared paragraphs literally shared, rather than
 * paraphrased, is what makes the diagram-only vs boundry comparison a clean test
 * of enforcement instead of an accidental test of wording.
 */
function architectureBriefing(armName, worktree) {
  if (!ARMS_WITH_DIAGRAM.has(armName)) return null;

  const shared = [
    "This repository's architecture is drawn as a LikeC4 diagram at arch/promo-shop.likec4.",
    '',
    'Every relationship drawn in that diagram is an ALLOWED dependency between the folders',
    'the elements map to. Any import that crosses a boundary the diagram does not draw is a',
    'violation of the intended architecture. Read the diagram before you design your change,',
    'and keep your implementation inside it.',
    '',
    'The diagram is the specification. Do not edit it to make your code fit.',
  ];

  if (armName === 'diagram-only') return shared.join('\n');

  return [
    ...shared,
    '',
    'This architecture is enforced by Boundry as a hard gate, not a guideline: an import that',
    'crosses a boundary the diagram does not draw is a build failure. Check your work at any',
    'time with:',
    `  npx tsx ${join(BOUNDRY_HOME, 'src/cli/index.ts')} check --arch ${join(worktree, 'arch')} --cwd ${join(worktree, baseline.checkCwd)} src`,
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
  if (armName !== 'boundry') return null;
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

  if (ARMS_WITH_DIAGRAM.has(armName)) {
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
  const briefing = architectureBriefing(armName, worktree);
  if (briefing) cmd.push('--append-system-prompt', briefing);
  if (briefing) writeFileSync(join(outDir, 'system-append.txt'), briefing);
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

  // The task text must be byte-identical across arms; record its hash so that
  // is verifiable from the results alone rather than taken on trust.
  const promptSha = createHash('sha256').update(buildPrompt()).digest('hex');

  // Cost and turn count are findings, not bookkeeping: the gate buys compliance
  // by making the agent work longer, and the report has to price that.
  let cost = null;
  let turns = null;
  try {
    const parsed = JSON.parse(agentOut);
    cost = parsed.total_cost_usd ?? null;
    turns = parsed.num_turns ?? null;
  } catch {
    // Budget exhaustion or a crash can leave non-JSON on stdout; the run still
    // gets measured, it just has no cost line.
  }

  writeFileSync(
    join(outDir, 'run.json'),
    JSON.stringify(
      {
        runId, spec: specId, arm: armName, model, baseline: baseline.sha,
        promptSha, wallMs, agentFailed: failed, testsPass, cost, turns,
      },
      null,
      2,
    ),
  );

  console.log(`  tests: ${testsPass ? 'pass' : 'FAIL'}  (${(wallMs / 1000).toFixed(0)}s)`);
  return { outDir, worktree };
}

const armsToRun = arm === 'all' ? ARMS : arm.split(',');
for (const a of armsToRun) {
  if (!ARMS.includes(a)) {
    console.error(`Unknown arm "${a}". Expected one of: ${ARMS.join(', ')} (or "all").`);
    process.exit(2);
  }
}
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
