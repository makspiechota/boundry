import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Pipeline } from "../../core/pipeline/pipeline.js";
import { LikeC4Visualizer } from "../../adapters/visualizer/likec4.js";
import { DepCruiserEnforcer } from "../../adapters/enforcer/depcruiser.js";
import type { CheckResult } from "../../core/ports/ports.js";

export interface Given {
  likeC4Path: string;
  codebasePath: string;
}

export type WhenAction = (given: Given) => Promise<CheckResult>;

export interface Scenario {
  name?: string;
  given: Given;
  when: WhenAction;
  then: (response: CheckResult) => void;
}

/**
 * The one supported `when`: run the real Boundry pipeline end to end — read the
 * LikeC4 workspace, compile rules, and run dependency-cruiser over the codebase.
 * `folder` metadata in the diagram is relative to the codebase root, so we run
 * the enforcer with the codebase root as cwd.
 */
export function generatingRulesAndVerifying(
  sources: string[] = ["src"]
): WhenAction {
  return async ({ likeC4Path, codebasePath }) => {
    const archDir = resolve(likeC4Path);
    const codebaseRoot = resolve(codebasePath);
    const pipeline = new Pipeline(
      new LikeC4Visualizer(archDir),
      new DepCruiserEnforcer()
    );

    const previousCwd = process.cwd();
    process.chdir(codebaseRoot);
    try {
      return await pipeline.check(sources);
    } finally {
      process.chdir(previousCwd);
    }
  };
}

/** Assertion: the codebase respects every drawn boundary. */
export function noViolations(response: CheckResult): void {
  assert.equal(
    response.ok,
    true,
    `expected no violations, got ${response.violations.length}: ` +
      response.violations
        .map((v) => `${v.from} → ${v.to} [${v.rule}]`)
        .join(", ")
  );
}

/** Assertion: at least one forbidden import was caught. */
export function importRuleViolated(response: CheckResult): void {
  assert.equal(
    response.ok,
    false,
    "expected a boundary violation, but found none"
  );
  assert.ok(
    response.violations.length > 0,
    "expected at least one import violation"
  );
}

/**
 * Assertion factory: expect a violation whose importing file lives under
 * `fromFragment` and whose imported file lives under `toFragment` (path
 * fragments, e.g. 'value-objects' → 'entities' or 'application/commands' →
 * 'domain/aggregates').
 */
export function violationBetween(
  fromFragment: string,
  toFragment: string
): (response: CheckResult) => void {
  return (response) => {
    assert.equal(
      response.ok,
      false,
      `expected a violation ${fromFragment} → ${toFragment}, but the check passed`
    );
    const hit = response.violations.some(
      (v) => v.from.includes(fromFragment) && v.to.includes(toFragment)
    );
    assert.ok(
      hit,
      `expected a violation ${fromFragment} → ${toFragment}; got: ` +
        response.violations.map((v) => `${v.from} → ${v.to}`).join(", ")
    );
  };
}

/** Register a list of declarative scenarios as node:test cases. */
export function testE2E(scenarios: Scenario[]): void {
  scenarios.forEach((scenario, index) => {
    test(scenario.name ?? `e2e scenario #${index + 1}`, async () => {
      const response = await scenario.when(scenario.given);
      scenario.then(response);
    });
  });
}
