#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Pipeline, type VerifyResult } from '../core/pipeline/pipeline.js';
import { LikeC4Visualizer } from '../adapters/visualizer/likec4.js';
import { DepCruiserEnforcer } from '../adapters/enforcer/depcruiser.js';

const USAGE =
  'usage: boundry <generate|check|approve|verify|annotate|diff> [--arch <dir>] [--cwd <dir>] [--out <file>] [sources...]';

function optValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip the flag's value
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function countGrants(granted: VerifyResult): number {
  return granted.edges.length + granted.exemptions.length;
}

function listGrants(granted: VerifyResult): void {
  for (const edge of granted.edges) console.error(`  ${edge.from} → ${edge.to}`);
  for (const pattern of granted.exemptions) {
    console.error(`  exemption '${pattern}' — lifts matching files out of every rule`);
  }
  if (granted.edges.length > 0) {
    console.error('  Mark them #proposed so the grant is an explicit, reviewable act.');
  }
  if (granted.exemptions.length > 0) {
    console.error('  An exemption cannot be proposed — a human adds it to the diagram, or not at all.');
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  // Resolve paths against the *original* cwd before we optionally move into the
  // target repo, so `--arch` and `--out` are unaffected by `--cwd`.
  const archDir = resolve(optValue(rest, '--arch') ?? '.');
  const outArg = optValue(rest, '--out');
  const outFile = outArg ? resolve(outArg) : undefined;

  // `--cwd` lets you check a repo without cd-ing into it. `folder` metadata is
  // relative to the target repo root, so the enforcer runs from there.
  const cwd = optValue(rest, '--cwd');
  if (cwd) process.chdir(resolve(cwd));

  // The accepted-state lock lives beside the diagram it locks. `approve` writes
  // it; `verify` and `annotate` read it — the baseline Boundry owns, decoupled
  // from git, so "accepted" never means merely "committed".
  const lockFile = join(archDir, 'boundry.lock');
  const readLock = (): string | undefined =>
    existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : undefined;

  const pipeline = new Pipeline(new LikeC4Visualizer(archDir), new DepCruiserEnforcer());

  if (command === 'generate') {
    const config = await pipeline.generate();
    const out = outFile ?? resolve(config.filename);
    writeFileSync(out, config.content);
    console.log(`Boundry: wrote ${out}`);
    return;
  }

  if (command === 'check') {
    const sources = positionals(rest);
    const result = await pipeline.check(sources.length ? sources : ['src']);
    for (const warning of result.warnings) {
      console.error(`Boundry: ⚠ ${warning}`);
    }
    if (result.ok) {
      console.log('Boundry: ✓ no boundary violations');
      return;
    }
    console.error(`Boundry: ✗ ${result.violations.length} boundary violation(s)`);
    for (const v of result.violations) {
      console.error(`  ${v.from} → ${v.to}  [${v.rule}]`);
    }
    process.exitCode = 1;
    return;
  }

  if (command === 'verify') {
    const lock = readLock();
    if (!lock) {
      console.error(
        `Boundry: no ${relative(process.cwd(), lockFile)} — run 'boundry approve' first to record the accepted state`,
      );
      process.exitCode = 2;
      return;
    }
    const granted = await pipeline.verify(lock);
    if (countGrants(granted) === 0) {
      console.log('Boundry: ✓ nothing granted without a #proposed marker (vs the accepted lock)');
      return;
    }
    console.error(
      `Boundry: ✗ ${countGrants(granted)} grant(s) made without a #proposed marker (vs the accepted lock)`,
    );
    listGrants(granted);
    process.exitCode = 1;
    return;
  }

  if (command === 'approve') {
    // Approving must never launder an edge that skipped the proposal protocol.
    // The accepted lock is the baseline: a bare edge added since the last approve
    // is in the allow-list but not the lock, so it surfaces here; a #proposed one
    // is excluded from the allow-list, so it passes and gets enacted below. The
    // first approve has no lock yet — it establishes the initial accepted state.
    const lock = readLock();
    if (lock) {
      const granted = await pipeline.verify(lock);
      if (countGrants(granted) > 0) {
        console.error(
          `Boundry: ✗ refusing to approve — ${countGrants(granted)} grant(s) were made without a #proposed marker (vs the accepted lock)`,
        );
        listGrants(granted);
        process.exitCode = 1;
        return;
      }
    } else {
      console.error('Boundry: ⚠ no boundry.lock yet — approving to record the initial accepted state');
    }
    const nextLock = await pipeline.approve();
    writeFileSync(lockFile, nextLock);
    console.log('Boundry: ✓ approved — enacted the diagram and wrote', relative(process.cwd(), lockFile));
    return;
  }

  if (command === 'annotate') {
    if (!existsSync(lockFile)) {
      console.error(
        `Boundry: no ${relative(process.cwd(), lockFile)} — run 'boundry approve' first to record an accepted state`,
      );
      process.exitCode = 2;
      return;
    }
    const { edges, modules } = await pipeline.annotate(readFileSync(lockFile, 'utf8'));
    if (edges.length === 0 && modules.length === 0) {
      console.log('Boundry: ✓ nothing to annotate — the diagram matches the accepted lock');
      return;
    }
    console.log(
      `Boundry: ✎ marked ${edges.length} edge(s) and ${modules.length} box(es) #proposed:`,
    );
    for (const edge of edges) console.log(`  ${edge.from} → ${edge.to}`);
    for (const mod of modules) console.log(`  [${mod.title}]`);
    console.log('  Review the highlighted diagram, then approve or revert.');
    return;
  }

  if (command === 'diff') {
    const views = await pipeline.diffViews();
    const diffFile = join(archDir, 'boundry.diff.likec4');
    if (views.length === 0) {
      console.log('Boundry: ✓ nothing proposed — no diff views to draw');
      return;
    }
    console.log(
      `Boundry: ✎ wrote ${views.length} diff view(s) to ${relative(process.cwd(), diffFile)}:`,
    );
    for (const view of views) {
      const layer = view.scope ?? 'root';
      console.log(`  ${view.id}  (layer ${layer}, ${view.changes} change(s))`);
    }
    console.log('  Open the diagram in `likec4 serve` to review each layer.');
    return;
  }

  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
