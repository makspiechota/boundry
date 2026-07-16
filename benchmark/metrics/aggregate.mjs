#!/usr/bin/env node
/**
 * Aggregate every run of a spec into the comparison table and its statistics.
 *
 * Usage: node benchmark/metrics/aggregate.mjs [--spec 01-order-history] [--json]
 *
 * See ANALYSIS.md for what these numbers mean and — more importantly — what
 * they do not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS_DIR = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(METRICS_DIR, '..');
const ARMS = ['no-diagram', 'diagram-only', 'boundry'];

const args = process.argv.slice(2);
const opt = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
const specId = opt('--spec', '01-order-history');

// ── statistics ───────────────────────────────────────────────────────────────

const lnFactCache = [0, 0];
function lnFact(n) {
  if (lnFactCache[n] !== undefined) return lnFactCache[n];
  let v = lnFactCache[lnFactCache.length - 1];
  for (let i = lnFactCache.length; i <= n; i++) {
    v += Math.log(i);
    lnFactCache[i] = v;
  }
  return lnFactCache[n];
}

/** Hypergeometric probability of exactly this 2x2 table. */
function hyperProb(a, b, c, d) {
  const n = a + b + c + d;
  return Math.exp(
    lnFact(a + b) + lnFact(c + d) + lnFact(a + c) + lnFact(b + d) -
      lnFact(a) - lnFact(b) - lnFact(c) - lnFact(d) - lnFact(n),
  );
}

/**
 * Fisher's exact test, two-tailed. Exact rather than chi-square because run
 * counts here are small and cells will often be 0.
 */
function fisherExact(a, b, c, d) {
  const observed = hyperProb(a, b, c, d);
  const rowsum1 = a + b;
  const colsum1 = a + c;
  const n = a + b + c + d;
  const lo = Math.max(0, colsum1 - (n - rowsum1));
  const hi = Math.min(rowsum1, colsum1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const prob = hyperProb(x, rowsum1 - x, colsum1 - x, n - rowsum1 - colsum1 + x);
    if (prob <= observed * (1 + 1e-9)) p += prob;
  }
  return Math.min(1, p);
}

/** Wilson score interval — behaves at 0/n and n/n, where normal approx does not. */
function wilson(successes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ── load ─────────────────────────────────────────────────────────────────────

function loadArm(armName) {
  const dir = join(BENCH, 'results', specId, armName);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d.startsWith('run-'))
    .map((d) => join(dir, d, 'metrics.json'))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, 'utf8')));
}

const data = Object.fromEntries(ARMS.map((a) => [a, loadArm(a)]));
const present = ARMS.filter((a) => data[a].length > 0);

if (present.length === 0) {
  console.error(`No results under benchmark/results/${specId}/. Run the runner first.`);
  process.exit(2);
}

// Identical task text across arms is the core internal-validity claim; check it
// rather than assert it.
const promptShas = new Set(present.flatMap((a) => data[a].map((r) => r.promptSha)).filter(Boolean));
if (promptShas.size > 1) {
  console.error(`⚠ arms did not receive identical prompts (${promptShas.size} distinct hashes) — comparison is invalid`);
}

function summarise(armName) {
  const runs = data[armName];
  const n = runs.length;
  const clean = runs.filter((r) => r.clean).length;
  const working = runs.filter((r) => r.testsPass).length;
  const cleanAndWorking = runs.filter((r) => r.cleanAndWorking).length;
  const trapIds = [...new Set(runs.flatMap((r) => (r.traps ?? []).map((t) => t.id)))];
  return {
    arm: armName,
    n,
    clean,
    working,
    cleanAndWorking,
    cleanAndWorkingRate: n ? cleanAndWorking / n : 0,
    ci: wilson(cleanAndWorking, n),
    meanViolations: mean(runs.map((r) => r.violationCount)),
    traps: Object.fromEntries(
      trapIds.map((id) => [id, runs.filter((r) => (r.traps ?? []).some((t) => t.id === id && t.taken)).length]),
    ),
    tampered: runs.filter((r) => r.diagramTampering?.edited).length,
    testsTouched: runs.filter((r) => r.existingTests?.anyTouched).length,
    evaded: runs.filter((r) => (r.evasion?.dynamicImport ?? 0) + (r.evasion?.require ?? 0) > 0).length,
    gateBlocks: mean(runs.filter((r) => r.gate?.applicable).map((r) => r.gate.blocked)),
    gateNonConverged: runs.filter((r) => r.gate?.applicable && r.gate.converged === false).length,
    meanCost: mean(runs.map((r) => r.cost).filter((c) => typeof c === 'number')),
    meanTurns: mean(runs.map((r) => r.turns).filter((c) => typeof c === 'number')),
  };
}

const summary = present.map(summarise);

// ── report ───────────────────────────────────────────────────────────────────

console.log(`\nSpec: ${specId}`);
console.log(`Runs: ${summary.map((s) => `${s.arm}=${s.n}`).join('  ')}\n`);

console.log('Primary endpoint — clean AND tests passing:');
for (const s of summary) {
  console.log(
    `  ${s.arm.padEnd(13)} ${String(s.cleanAndWorking).padStart(2)}/${String(s.n).padEnd(2)}` +
      `  ${pct(s.cleanAndWorkingRate).padStart(4)}  95% CI [${pct(s.ci[0])}, ${pct(s.ci[1])}]` +
      `  mean violations ${s.meanViolations?.toFixed(2) ?? '—'}`,
  );
}

console.log('\nTraps taken (of n runs):');
const allTraps = [...new Set(summary.flatMap((s) => Object.keys(s.traps)))];
for (const trap of allTraps) {
  console.log(`  ${trap}`);
  for (const s of summary) console.log(`    ${s.arm.padEnd(13)} ${s.traps[trap] ?? 0}/${s.n}`);
}

console.log('\nIntegrity of the result (any non-zero here weakens it):');
for (const s of summary) {
  console.log(
    `  ${s.arm.padEnd(13)} diagram edited ${s.tampered}/${s.n}` +
      `  existing tests touched ${s.testsTouched}/${s.n}` +
      `  dynamic-import evasion ${s.evaded}/${s.n}`,
  );
}

const gated = summary.find((s) => s.arm === 'boundry');
if (gated && gated.n) {
  console.log('\nGate behaviour (boundry arm):');
  console.log(`  mean blocks per run   ${gated.gateBlocks?.toFixed(1) ?? '—'}`);
  console.log(`  failed to converge    ${gated.gateNonConverged}/${gated.n}`);
}

console.log('\nCost of each arm:');
for (const s of summary) {
  console.log(
    `  ${s.arm.padEnd(13)} $${s.meanCost?.toFixed(2) ?? '—'}/run   ${s.meanTurns?.toFixed(0) ?? '—'} turns`,
  );
}

// The comparisons that carry the argument.
const comparisons = [
  ['no-diagram', 'diagram-only', 'Does handing the agent the diagram fix drift on its own?'],
  ['diagram-only', 'boundry', 'Does enforcing the diagram beat merely documenting it? ← the claim'],
  ['no-diagram', 'boundry', 'Total effect of adopting Boundry.'],
];

console.log('\nPairwise (Fisher exact, two-tailed, on the primary endpoint):');
for (const [x, y, question] of comparisons) {
  const a = summary.find((s) => s.arm === x);
  const b = summary.find((s) => s.arm === y);
  if (!a || !b || !a.n || !b.n) continue;
  const p = fisherExact(a.cleanAndWorking, a.n - a.cleanAndWorking, b.cleanAndWorking, b.n - b.cleanAndWorking);
  console.log(`  ${x} vs ${y}`);
  console.log(`    ${question}`);
  console.log(
    `    ${pct(a.cleanAndWorkingRate)} vs ${pct(b.cleanAndWorkingRate)}   p = ${p < 0.001 ? p.toExponential(1) : p.toFixed(3)}` +
      `${p > 0.05 ? '  (not significant at n this size — see ANALYSIS.md)' : ''}`,
  );
}

const minN = Math.min(...summary.map((s) => s.n));
if (minN < 10) {
  console.log(
    `\n⚠ ${minN} run(s) per arm. Agents are stochastic; this is an anecdote, not a result.` +
      `\n  Even a perfect 0/n vs n/n split needs n≥5 per arm to clear p<0.05, and any` +
      `\n  partial effect needs n≥10–20. Use --runs before quoting any of this.`,
  );
}

if (args.includes('--json')) {
  console.log(`\n${JSON.stringify({ spec: specId, summary }, null, 2)}`);
}
