#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pipeline } from '../core/pipeline/pipeline.js';
import { LikeC4Visualizer } from '../adapters/visualizer/likec4.js';
import { DepCruiserEnforcer } from '../adapters/enforcer/depcruiser.js';

const USAGE =
  'usage: boundry <generate|check> [--arch <dir>] [--cwd <dir>] [--out <file>] [sources...]';

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

  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
