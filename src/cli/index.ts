#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Pipeline } from '../core/pipeline/pipeline.js';
import { LikeC4Visualizer } from '../adapters/visualizer/likec4.js';
import { DepCruiserEnforcer } from '../adapters/enforcer/depcruiser.js';

const USAGE =
  'usage: boundry <generate|check|approve|verify> [--arch <dir>] [--base <git-ref>] [--cwd <dir>] [--out <file>] [sources...]';

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

function listGrantedEdges(granted: { from: string; to: string }[]): void {
  for (const edge of granted) console.error(`  ${edge.from} → ${edge.to}`);
  console.error('  Mark them #proposed so the grant is an explicit, reviewable act.');
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
    if (granted.length === 0) {
      console.log(`Boundry: ✓ no edges granted without a #proposed marker (vs ${baseRef})`);
      return;
    }
    console.error(
      `Boundry: ✗ ${granted.length} edge(s) granted without a #proposed marker (vs ${baseRef})`,
    );
    listGrantedEdges(granted);
    process.exitCode = 1;
    return;
  }

  if (command === 'approve') {
    // Approving must never launder an edge that skipped the proposal protocol.
    if (baseRef) {
      const granted = await grantedSince(baseRef);
      if (granted.length > 0) {
        console.error(
          `Boundry: ✗ refusing to approve — ${granted.length} edge(s) were granted without a #proposed marker (vs ${baseRef})`,
        );
        listGrantedEdges(granted);
        process.exitCode = 1;
        return;
      }
    } else {
      console.error('Boundry: ⚠ no --base given — approving without verifying that every new edge was proposed');
    }
    await pipeline.approve();
    console.log('Boundry: ✓ approved — stripped #proposed markers from the diagram');
    return;
  }

  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
