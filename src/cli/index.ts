#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Pipeline, type VerifyResult } from '../core/pipeline/pipeline.js';
import { LikeC4Visualizer } from '../adapters/visualizer/likec4.js';
import { DepCruiserEnforcer } from '../adapters/enforcer/depcruiser.js';

const USAGE =
  'usage: boundry <generate|check|approve|verify|annotate> [--arch <dir>] [--base <git-ref>] [--cwd <dir>] [--out <file>] [sources...]';

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

/**
 * Materialize the architecture as of a git ref into a temp workspace, so the
 * previously-approved boundary model can be lifted and compared against HEAD.
 */
function materializeArchAt(archDir: string, ref: string): string {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: archDir,
    encoding: 'utf8',
  }).trim();
  const workDir = mkdtempSync(join(tmpdir(), 'boundry-base-'));
  for (const file of readdirSync(archDir).filter((f) => f.endsWith('.likec4'))) {
    try {
      const content = execFileSync('git', ['show', `${ref}:${relative(gitRoot, join(archDir, file))}`], {
        cwd: gitRoot,
        encoding: 'utf8',
      });
      writeFileSync(join(workDir, file), content);
    } catch {
      // The file did not exist at `ref` — everything it declares is new.
    }
  }
  return workDir;
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
  const baseRef = optValue(rest, '--base');

  // `--cwd` lets you check a repo without cd-ing into it. `folder` metadata is
  // relative to the target repo root, so the enforcer runs from there.
  const cwd = optValue(rest, '--cwd');
  if (cwd) process.chdir(resolve(cwd));

  // The accepted-state lock lives beside the diagram it locks. `approve` writes
  // it; `annotate` reads it — the baseline Boundry owns, not one inferred from git.
  const lockFile = join(archDir, 'boundry.lock');

  const pipeline = new Pipeline(new LikeC4Visualizer(archDir), new DepCruiserEnforcer());
  const grantedSince = (ref: string) =>
    pipeline.verify(new LikeC4Visualizer(materializeArchAt(archDir, ref)));

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
    if (!baseRef) {
      console.error('Boundry: verify requires --base <git-ref>');
      process.exitCode = 2;
      return;
    }
    const granted = await grantedSince(baseRef);
    if (countGrants(granted) === 0) {
      console.log(`Boundry: ✓ nothing granted without a #proposed marker (vs ${baseRef})`);
      return;
    }
    console.error(
      `Boundry: ✗ ${countGrants(granted)} grant(s) made without a #proposed marker (vs ${baseRef})`,
    );
    listGrants(granted);
    process.exitCode = 1;
    return;
  }

  if (command === 'approve') {
    // Approving must never launder an edge that skipped the proposal protocol.
    if (baseRef) {
      const granted = await grantedSince(baseRef);
      if (countGrants(granted) > 0) {
        console.error(
          `Boundry: ✗ refusing to approve — ${countGrants(granted)} grant(s) were made without a #proposed marker (vs ${baseRef})`,
        );
        listGrants(granted);
        process.exitCode = 1;
        return;
      }
    } else {
      console.error('Boundry: ⚠ no --base given — approving without verifying that every new edge was proposed');
    }
    const lock = await pipeline.approve();
    writeFileSync(lockFile, lock);
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

  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
