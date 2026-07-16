import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Pipeline } from "../../core/pipeline/pipeline.js";
import { LikeC4Visualizer } from "../../adapters/visualizer/likec4.js";
import { DepCruiserEnforcer } from "../../adapters/enforcer/depcruiser.js";
import type { CheckResult } from "../../core/ports/ports.js";
import type { AllowedEdge } from "../../core/model/boundary-model.js";
import {
  newlyAllowedEdges,
  newlyExemptedImporters,
} from "../../core/model/boundary-model.js";

export interface Given {
  likeC4Path: string;
  codebasePath: string;
}

export type WhenAction = (given: Given) => Promise<CheckResult>;

export interface Scenario<G = Given, R = CheckResult> {
  name?: string;
  given: G;
  when: (given: G) => Promise<R>;
  then: (response: R) => void;
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

/** Assertion: a warning was raised mentioning `fragment`. */
export function warnsAbout(
  fragment: string
): (response: CheckResult) => void {
  return (response) => {
    assert.ok(
      response.warnings.some((w) => w.includes(fragment)),
      `expected a warning mentioning '${fragment}', got: ${
        response.warnings.join(" | ") || "(none)"
      }`
    );
  };
}

/** Assertion: exactly `expected` violations were found — nothing else slips through. */
export function violationCount(
  expected: number
): (response: CheckResult) => void {
  return (response) => {
    assert.equal(
      response.violations.length,
      expected,
      `expected exactly ${expected} violation(s), got ${response.violations.length}: ` +
        response.violations.map((v) => `${v.from} → ${v.to}`).join(", ")
    );
  };
}

// ─── Verification: nobody may grant themselves an edge ───────────────

export interface VerifyGiven {
  baseArchPath: string;
  headArchPath: string;
}

/**
 * Lift both diagrams and report edges that are ALLOWED at head but were not at
 * base. Because `#proposed` edges are excluded from the allow-list, this delta
 * is exactly the set of edges someone granted without proposing them.
 */
export function comparingArchitectures(): (
  given: VerifyGiven
) => Promise<AllowedEdge[]> {
  return async ({ baseArchPath, headArchPath }) => {
    const base = await new LikeC4Visualizer(resolve(baseArchPath)).read();
    const head = await new LikeC4Visualizer(resolve(headArchPath)).read();
    return newlyAllowedEdges(base, head);
  };
}

/**
 * The same delta for importer exemptions. An exemption lifts whole files out of
 * every rule, so a new one is a grant and has to be as visible as a new edge.
 */
export function comparingExemptions(): (
  given: VerifyGiven
) => Promise<string[]> {
  return async ({ baseArchPath, headArchPath }) => {
    const base = await new LikeC4Visualizer(resolve(baseArchPath)).read();
    const head = await new LikeC4Visualizer(resolve(headArchPath)).read();
    return newlyExemptedImporters(base, head);
  };
}

/** Assertion: no exemption was added behind the base's back. */
export function noSelfGrantedExemptions(patterns: string[]): void {
  assert.equal(
    patterns.length,
    0,
    `expected no self-granted exemptions, got: ${patterns.join(", ")}`
  );
}

/** Assertion: exactly this exemption was added since base. */
export function selfGrantedExemption(
  pattern: string
): (patterns: string[]) => void {
  return (patterns) => {
    assert.deepEqual(
      patterns,
      [pattern],
      `expected only the exemption '${pattern}', got: ${patterns.join(", ")}`
    );
  };
}

const render = (edges: AllowedEdge[]): string =>
  edges.map((e) => `${e.from} -> ${e.to}`).join(", ");

/** Assertion: no edge was granted without going through a proposal. */
export function noSelfApprovedEdges(edges: AllowedEdge[]): void {
  assert.equal(
    edges.length,
    0,
    `expected no self-approved edges, got: ${render(edges)}`
  );
}

/** Assertion: exactly this edge was granted without a proposal. */
export function selfApprovedEdge(
  from: string,
  to: string
): (edges: AllowedEdge[]) => void {
  return (edges) => {
    assert.ok(
      edges.some((e) => e.from === from && e.to === to),
      `expected self-approved edge ${from} -> ${to}, got: ${render(edges)}`
    );
    assert.equal(
      edges.length,
      1,
      `expected only ${from} -> ${to}, got: ${render(edges)}`
    );
  };
}

/** Register a list of declarative scenarios as node:test cases. */
export function testE2E<G, R>(scenarios: Scenario<G, R>[]): void {
  scenarios.forEach((scenario, index) => {
    test(scenario.name ?? `e2e scenario #${index + 1}`, async () => {
      const response = await scenario.when(scenario.given);
      scenario.then(response);
    });
  });
}

// ─── Approval flow (intent → approved) ───────────────────────────────

export interface ApprovalGiven {
  /** Directory holding the proposed LikeC4 diagram (carrying #proposed markers). */
  proposedArchPath: string;
}

/**
 * Approve every `#proposed` marker in the diagram. Runs on a throwaway copy so
 * the fixture stays pristine; returns the resulting diagram source.
 */
export function approving(): (given: ApprovalGiven) => Promise<string> {
  return async ({ proposedArchPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-approve-"));
    cpSync(resolve(proposedArchPath), workDir, { recursive: true });
    const visualizer = new LikeC4Visualizer(workDir);
    await visualizer.approve();
    return readFileSync(join(workDir, "architecture.likec4"), "utf8");
  };
}

/**
 * The full loop: approve the diagram's `#proposed` markers (on a throwaway copy,
 * so the fixture stays pristine), then run the real check against the codebase
 * using the now-approved diagram. Proves approval actually flips enforcement.
 */
export function approvingThenVerifying(
  sources: string[] = ["src"]
): WhenAction {
  return async ({ likeC4Path, codebasePath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-approve-check-"));
    cpSync(resolve(likeC4Path), workDir, { recursive: true });

    const visualizer = new LikeC4Visualizer(workDir);
    await visualizer.approve();

    const pipeline = new Pipeline(visualizer, new DepCruiserEnforcer());
    const previousCwd = process.cwd();
    process.chdir(resolve(codebasePath));
    try {
      return await pipeline.check(sources);
    } finally {
      process.chdir(previousCwd);
    }
  };
}

/** Assertion: the approved diagram source matches the expected accepted file. */
export function matchesDiagram(expectedPath: string): (actual: string) => void {
  return (actual) => {
    const expected = readFileSync(resolve(expectedPath), "utf8");
    assert.equal(
      actual,
      expected,
      "approved diagram does not match the expected accepted diagram"
    );
  };
}
