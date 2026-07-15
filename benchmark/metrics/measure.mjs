#!/usr/bin/env node
/**
 * Architecture drift metrics for a single run.
 *
 * Everything here is counted, not judged: no model calls, no heuristics about
 * code quality. The same yardstick is applied to both arms from outside them.
 *
 * Usage: node metrics/measure.mjs --run <resultsDir> --worktree <dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS_DIR = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(METRICS_DIR, '..');
const BOUNDRY_HOME = resolve(BENCH, '..');

const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const runDir = resolve(opt('--run'));
const worktree = resolve(opt('--worktree'));
const baseline = JSON.parse(readFileSync(join(BENCH, 'baseline.json'), 'utf8'));
const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));

/**
 * The measurement always uses the canonical diagram from the benchmark, never
 * the copy inside the worktree — otherwise an agent that edited the diagram
 * would be graded against its own edit.
 */
const CANONICAL_ARCH = join(BENCH, baseline.arch);

function boundryCheck() {
  try {
    execFileSync(
      'npx',
      [
        'tsx', join(BOUNDRY_HOME, 'src/cli/index.ts'), 'check',
        '--arch', CANONICAL_ARCH,
        '--cwd', join(worktree, baseline.checkCwd),
        ...baseline.sources,
      ],
      { cwd: BOUNDRY_HOME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { violations: [], raw: 'clean' };
  } catch (err) {
    const raw = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (err.status !== 1) return { violations: [], raw, error: true };
    const violations = [];
    for (const line of raw.split('\n')) {
      // "  src/a.ts → src/b.ts  [boundary:domain.checkout->domain.catalog]"
      const m = line.match(/^\s*(\S+)\s+→\s+(\S+)\s+\[([^\]]+)\]\s*$/);
      if (!m) continue;
      const edge = m[3].replace(/^boundary:/, '');
      const [edgeFrom, edgeTo] = edge.split('->');
      violations.push({ from: m[1], to: m[2], edgeFrom, edgeTo, edge });
    }
    return { violations, raw };
  }
}

/** Did the agent alter the specification it was being held to? */
function diagramTampering() {
  const worktreeArch = join(worktree, 'arch');
  if (!existsSync(worktreeArch)) return { applicable: false, edited: false, files: [] };
  const edited = [];
  for (const file of readdirSync(CANONICAL_ARCH).filter((f) => f.endsWith('.likec4'))) {
    const mine = join(worktreeArch, file);
    if (!existsSync(mine)) {
      edited.push(`${file} (deleted)`);
      continue;
    }
    if (readFileSync(mine, 'utf8') !== readFileSync(join(CANONICAL_ARCH, file), 'utf8')) {
      edited.push(file);
    }
  }
  // A .likec4 the agent invented is also tampering with the spec.
  const extra = readdirSync(worktreeArch)
    .filter((f) => f.endsWith('.likec4') && !existsSync(join(CANONICAL_ARCH, f)));
  return { applicable: true, edited: edited.length > 0 || extra.length > 0, files: [...edited, ...extra] };
}

/** Which of the engineered traps did this run actually take? */
function trapsTaken(violations) {
  const pressurePath = join(BENCH, 'specs', `${run.spec}.pressure.json`);
  if (!existsSync(pressurePath)) return [];
  const pressure = JSON.parse(readFileSync(pressurePath, 'utf8'));
  return pressure.traps.map((trap) => ({
    id: trap.id,
    forbiddenEdge: trap.forbiddenEdge,
    taken: violations.some((v) => v.edge === trap.forbiddenEdge.replace(/\s*->\s*/, '->')),
  }));
}

function gateActivity() {
  const log = join(runDir, 'gate.jsonl');
  if (!existsSync(log)) return { fired: 0, blocked: 0, everDirty: false };
  const entries = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    fired: entries.length,
    blocked: entries.filter((e) => !e.ok && !e.error).length,
    everDirty: entries.some((e) => e.violations.length > 0),
  };
}

function diffSize() {
  const stat = join(runDir, 'changes.stat');
  if (!existsSync(stat)) return { filesChanged: 0, insertions: 0, deletions: 0 };
  const text = readFileSync(stat, 'utf8');
  const m = text.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
  return {
    filesChanged: m ? Number(m[1]) : 0,
    insertions: m && m[2] ? Number(m[2]) : 0,
    deletions: m && m[3] ? Number(m[3]) : 0,
  };
}

const check = boundryCheck();
const violations = check.violations;
const uniqueEdges = [...new Set(violations.map((v) => v.edge))].sort();
const tampering = diagramTampering();

const metrics = {
  ...run,
  clean: violations.length === 0,
  violationCount: violations.length,
  forbiddenEdgeCount: uniqueEdges.length,
  forbiddenEdges: uniqueEdges,
  violations,
  traps: trapsTaken(violations),
  diagramTampering: tampering,
  gate: gateActivity(),
  diff: diffSize(),
  checkError: check.error ?? false,
};

writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metrics, null, 2));

const label = `${metrics.arm}/${metrics.spec}`;
console.log(
  `  ${label}: ${metrics.clean ? '✓ clean' : `✗ ${metrics.violationCount} violation(s) across ${metrics.forbiddenEdgeCount} forbidden edge(s)`}` +
    `${uniqueEdges.length ? `\n      ${uniqueEdges.join('\n      ')}` : ''}` +
    `${tampering.edited ? `\n      ⚠ diagram tampered: ${tampering.files.join(', ')}` : ''}`,
);
