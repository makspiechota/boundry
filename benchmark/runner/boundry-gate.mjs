#!/usr/bin/env node
/**
 * Treatment-arm gate. Wired as a Stop hook, so the agent cannot end its turn
 * while the code violates the drawn architecture: every violation is fed back
 * as the reason it must keep working.
 *
 * This is the whole treatment. Nothing here inspects *what* the agent wrote or
 * suggests how to fix it — Boundry reports the crossed edges, and that is all.
 *
 * Env (set by run.mjs):
 *   BOUNDRY_HOME  boundry checkout (to run the CLI from)
 *   GATE_ARCH     absolute path to the LikeC4 workspace
 *   GATE_CWD      absolute path to the repo root being checked
 *   GATE_LOG      absolute path to a jsonl log of every gate firing
 *   GATE_MAX      max times we may block before letting the turn end
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BOUNDRY_HOME = process.env.BOUNDRY_HOME;
const ARCH = process.env.GATE_ARCH;
const CWD = process.env.GATE_CWD;
const LOG = process.env.GATE_LOG;
const MAX = Number(process.env.GATE_MAX ?? 6);
const COUNTER = LOG ? `${LOG}.count` : null;

function readCount() {
  try {
    return Number(readFileSync(COUNTER, 'utf8')) || 0;
  } catch {
    return 0;
  }
}

/** Run `boundry check` and return its violations, or null if it could not run. */
function check() {
  try {
    const out = execFileSync(
      'npx',
      ['tsx', join(BOUNDRY_HOME, 'src/cli/index.ts'), 'check', '--arch', ARCH, '--cwd', CWD, 'src'],
      { cwd: BOUNDRY_HOME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, violations: [], raw: out };
  } catch (err) {
    const raw = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    // Exit 1 means violations; anything else means the check itself broke, and
    // a broken check must never masquerade as a clean architecture.
    if (err.status !== 1) return { ok: false, violations: [], raw, error: true };
    const violations = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('→') && l.includes('['));
    return { ok: false, violations, raw };
  }
}

const result = check();
const count = readCount();

if (LOG) {
  appendFileSync(
    LOG,
    `${JSON.stringify({
      at: new Date().toISOString(),
      blockNumber: count + 1,
      ok: result.ok,
      error: result.error ?? false,
      violations: result.violations,
    })}\n`,
  );
}

if (result.ok) {
  process.exit(0); // clean — let the turn end
}

if (result.error) {
  // Don't trap the agent behind a gate that is itself broken.
  console.error(`boundry-gate: check failed to run\n${result.raw}`);
  process.exit(0);
}

if (count >= MAX) {
  // Give up blocking: an agent that cannot get clean in MAX rounds is a real
  // result, not a reason to loop forever. The violations stay in the metrics.
  process.exit(0);
}

if (COUNTER) writeFileSync(COUNTER, String(count + 1));

const list = result.violations.map((v) => `  ${v}`).join('\n');
console.log(
  JSON.stringify({
    decision: 'block',
    reason:
      `Boundry: this change violates the architecture in ${ARCH}. ` +
      `Each line is an import that crosses a boundary the diagram does not allow:\n\n${list}\n\n` +
      `Every relationship in the diagram is an allowed dependency; anything not drawn is forbidden. ` +
      `Fix the code so these imports no longer cross those boundaries. ` +
      `Do not edit the diagram — it is the specification, not a suggestion. ` +
      `You can re-run the check yourself with:\n` +
      `  npx tsx ${join(BOUNDRY_HOME, 'src/cli/index.ts')} check --arch ${ARCH} --cwd ${CWD} src`,
  }),
);
process.exit(0);
