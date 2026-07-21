import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { LikeC4 } from "likec4";
import { Pipeline } from "../../core/pipeline/pipeline.js";
import { LikeC4Visualizer } from "../../adapters/visualizer/likec4.js";
import { DepCruiserEnforcer } from "../../adapters/enforcer/depcruiser.js";
import type { CheckResult, DiffView } from "../../core/ports/ports.js";
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
 * How the CLI actually verifies: lift the working diagram and compare it against
 * the accepted `boundry.lock` beside it — the baseline `approve` records, not a
 * git ref. Reports the edges granted without a `#proposed` marker. Takes an
 * archPath holding both architecture.likec4 and boundry.lock (AnnotateGiven).
 */
export function verifyingAgainstLock(): (given: AnnotateGiven) => Promise<AllowedEdge[]> {
  return async ({ archPath }) => {
    const dir = resolve(archPath);
    const pipeline = new Pipeline(new LikeC4Visualizer(dir), new DepCruiserEnforcer());
    const lock = readFileSync(join(dir, "boundry.lock"), "utf8");
    return (await pipeline.verify(lock)).edges;
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

// ─── Lock + annotate (accepted state → colourable proposal) ──────────

export interface AnnotateGiven {
  /** Directory holding architecture.likec4 AND a boundry.lock accepted state. */
  archPath: string;
}

/**
 * Approve a proposed diagram and return the lock string it produces — the
 * accepted state Boundry records, on a throwaway copy so the fixture stays clean.
 */
export function approvingWritesLock(): (given: ApprovalGiven) => Promise<string> {
  return async ({ proposedArchPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-lock-"));
    cpSync(resolve(proposedArchPath), workDir, { recursive: true });
    const pipeline = new Pipeline(new LikeC4Visualizer(workDir), new DepCruiserEnforcer());
    return pipeline.approve();
  };
}

/**
 * Annotate a drifted diagram against its committed lock (on a throwaway copy) and
 * return the rewritten source, so a test can see the injected `#proposed` markers.
 */
export function annotating(): (given: AnnotateGiven) => Promise<string> {
  return async ({ archPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-annotate-"));
    cpSync(resolve(archPath), workDir, { recursive: true });
    const pipeline = new Pipeline(new LikeC4Visualizer(workDir), new DepCruiserEnforcer());
    await pipeline.annotate(readFileSync(join(workDir, "boundry.lock"), "utf8"));
    return readFileSync(join(workDir, "architecture.likec4"), "utf8");
  };
}

/**
 * The full loop: annotate the drifted diagram against its lock, then run the real
 * check. Proves annotating a bare self-grant into a `#proposed` edge actually
 * flips it back out of the allow-list — the import is a violation again.
 */
export function annotatingThenChecking(sources: string[] = ["src"]): WhenAction {
  return async ({ likeC4Path, codebasePath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-annotate-check-"));
    cpSync(resolve(likeC4Path), workDir, { recursive: true });
    const pipeline = new Pipeline(new LikeC4Visualizer(workDir), new DepCruiserEnforcer());
    await pipeline.annotate(readFileSync(join(workDir, "boundry.lock"), "utf8"));

    const previousCwd = process.cwd();
    process.chdir(resolve(codebasePath));
    try {
      return await pipeline.check(sources);
    } finally {
      process.chdir(previousCwd);
    }
  };
}

/** Assertion: the recorded lock lists this edge as allowed. */
export function lockAllowsEdge(from: string, to: string): (lock: string) => void {
  return (lock) => {
    const allowed: AllowedEdge[] = JSON.parse(lock).allowed ?? [];
    assert.ok(
      allowed.some((e) => e.from === from && e.to === to),
      `expected the lock to allow ${from} -> ${to}, got: ${allowed.map((e) => `${e.from}->${e.to}`).join(", ")}`
    );
  };
}

/** Assertion: the recorded lock does NOT list this edge (it was a proposal). */
export function lockOmitsEdge(from: string, to: string): (lock: string) => void {
  return (lock) => {
    const allowed: AllowedEdge[] = JSON.parse(lock).allowed ?? [];
    assert.ok(
      !allowed.some((e) => e.from === from && e.to === to),
      `expected the lock to omit ${from} -> ${to}, but it was recorded as allowed`
    );
  };
}

// ─── Diff views (one focused view per changed layer) ─────────────────

export interface DiffGiven {
  /** Directory holding a LikeC4 diagram carrying #proposed / #proposal-delete markers. */
  archPath: string;
}

/** A laid-out view, keyed by id: nodes and edges with their resolved styling. */
export interface RenderedView {
  nodes: { id: string; color: string }[];
  /** `id` is `from->to`; `color`/`line` are the resolved edge styling. */
  edges: { id: string; color: string; line: string }[];
}

export interface DiffOutcome {
  /** The generated boundry.diff.likec4 content, or null if none was written. */
  file: string | null;
  /** The summary emitDiffViews returned — one entry per layer. */
  views: DiffView[];
  /**
   * The workspace re-read through LikeC4 AND LAID OUT after emitting, keyed by
   * view id — so a test can assert not just that a change is drawn in the right
   * layer, but that it is actually coloured. Colours resolve only in the laid-out
   * diagram (`diagrams()`), never in the computed model.
   */
  rendered: Record<string, RenderedView>;
}

/** Re-read a workspace through LikeC4 and lay every view out, keyed by view id. */
async function layoutViews(workDir: string): Promise<Record<string, RenderedView>> {
  const rendered: Record<string, RenderedView> = {};
  const likec4: any = await LikeC4.fromWorkspace(workDir);
  for (const d of await likec4.diagrams()) {
    rendered[d.id] = {
      nodes: (d.nodes ?? []).map((n: any) => ({ id: n.id, color: n.color })),
      edges: (d.edges ?? []).map((e: any) => ({
        id: `${e.source}->${e.target}`,
        color: e.color,
        line: e.line,
      })),
    };
  }
  return rendered;
}

/**
 * Emit diff views for a marked diagram (on a throwaway copy so the fixture stays
 * pristine), then re-read AND lay out the workspace through LikeC4 so a test can
 * assert both the generated source and that each view colours its layer's changes.
 */
export function emittingDiffViews(): (given: DiffGiven) => Promise<DiffOutcome> {
  return async ({ archPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-diff-"));
    cpSync(resolve(archPath), workDir, { recursive: true });
    const pipeline = new Pipeline(new LikeC4Visualizer(workDir), new DepCruiserEnforcer());
    const views = await pipeline.diffViews();

    const diffFile = join(workDir, "boundry.diff.likec4");
    const file = existsSync(diffFile) ? readFileSync(diffFile, "utf8") : null;

    return { file, views, rendered: await layoutViews(workDir) };
  };
}

/**
 * Paint intrinsic style on a marked diagram (throwaway copy), then re-read AND
 * lay out the workspace, so a test can assert the markers are coloured in a
 * *base* view — the surface the diff views' view-scoped rules cannot reach.
 * Returned as a DiffOutcome so the `viewColors*` assertions apply directly.
 */
export function stylingThenRendering(): (given: DiffGiven) => Promise<DiffOutcome> {
  return async ({ archPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-style-"));
    cpSync(resolve(archPath), workDir, { recursive: true });
    await new LikeC4Visualizer(workDir).styleMarkers();
    const file = readFileSync(join(workDir, "architecture.likec4"), "utf8");
    return { file, views: [], rendered: await layoutViews(workDir) };
  };
}

/**
 * Paint intrinsic style, then approve — on a throwaway copy — and return the
 * resulting source, so a test can prove approve strips BOTH the marker and the
 * injected styling (edges back to bare, boxes permanent and clean, deletions gone).
 */
export function stylingThenApproving(): (given: DiffGiven) => Promise<string> {
  return async ({ archPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-style-approve-"));
    cpSync(resolve(archPath), workDir, { recursive: true });
    const visualizer = new LikeC4Visualizer(workDir);
    await visualizer.styleMarkers();
    await visualizer.approve();
    return readFileSync(join(workDir, "architecture.likec4"), "utf8");
  };
}

// ─── approve clears the derived diff artifact (issue #6) ─────────────

export interface ApproveDiffOutcome {
  /** Whether `diff` wrote a boundry.diff.likec4 before approve ran. */
  diffFileBefore: boolean;
  /** Whether that file still exists after approve. */
  diffFileAfter: boolean;
  /** LikeC4 validation errors in the post-approve workspace (empty = valid). */
  errors: string[];
}

/**
 * The bug in #6: `diff` writes a derived boundry.diff.likec4 whose view rules
 * *reference* the marker tags (`style element.tag = #proposed …`). `approve` used
 * to walk that file too and splice the `#proposed` tokens out of the rules,
 * corrupting them into invalid LikeC4 and leaving the file behind — so
 * `likec4 validate` went red right after a successful approve. This drives the
 * full flow on a throwaway copy and reports whether approve cleared the artifact
 * and left a workspace that still validates.
 */
export function emittingDiffThenApproving(): (given: DiffGiven) => Promise<ApproveDiffOutcome> {
  return async ({ archPath }) => {
    const workDir = mkdtempSync(join(tmpdir(), "boundry-approve-diff-"));
    cpSync(resolve(archPath), workDir, { recursive: true });

    const pipeline = new Pipeline(new LikeC4Visualizer(workDir), new DepCruiserEnforcer());
    await pipeline.diffViews();
    const diffFile = join(workDir, "boundry.diff.likec4");
    const diffFileBefore = existsSync(diffFile);

    await new LikeC4Visualizer(workDir).approve();
    const diffFileAfter = existsSync(diffFile);

    const likec4: any = await LikeC4.fromWorkspace(workDir);
    const errors: string[] = (likec4.getErrors?.() ?? []).map(
      (e: any) => `${e.sourceFsPath ?? "?"}:${e.line ?? "?"} ${e.message ?? ""}`.trim(),
    );
    return { diffFileBefore, diffFileAfter, errors };
  };
}

/**
 * Assertion: `diff` did write the artifact, `approve` removed it, and the
 * post-approve workspace validates clean — the exact regression in #6.
 */
export function approveClearsDiffAndValidates(outcome: ApproveDiffOutcome): void {
  assert.equal(
    outcome.diffFileBefore,
    true,
    "expected `diff` to have written a boundry.diff.likec4 before approve",
  );
  assert.equal(
    outcome.diffFileAfter,
    false,
    "expected `approve` to remove the stale boundry.diff.likec4",
  );
  assert.deepEqual(
    outcome.errors,
    [],
    `expected the post-approve workspace to validate clean, got: ${outcome.errors.join(" | ")}`,
  );
}

/** Assertion: the generated diff file matches the golden byte-for-byte. */
export function matchesDiffFile(expectedPath: string): (outcome: DiffOutcome) => void {
  return ({ file }) => {
    assert.notEqual(file, null, "expected a boundry.diff.likec4 to be written, got none");
    assert.equal(
      file,
      readFileSync(resolve(expectedPath), "utf8"),
      "generated diff file does not match the expected golden"
    );
  };
}

/** Assertion: exactly these layers were emitted, each with the given change count. */
export function emitsLayers(
  expected: { id: string; changes: number }[]
): (outcome: DiffOutcome) => void {
  return ({ views }) => {
    const actual = views.map((v) => ({ id: v.id, changes: v.changes }));
    assert.deepEqual(
      actual,
      expected,
      `expected layers ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  };
}

/** Assertion: no diff file was written (nothing was proposed). */
export function emitsNothing(outcome: DiffOutcome): void {
  assert.equal(outcome.file, null, "expected no diff file, but one was written");
  assert.equal(
    outcome.views.length,
    0,
    `expected no emitted views, got ${outcome.views.length}`
  );
}

const viewOf = (rendered: Record<string, RenderedView>, viewId: string): RenderedView => {
  const view = rendered[viewId];
  assert.ok(view, `expected a rendered view '${viewId}', got: ${Object.keys(rendered).join(", ")}`);
  return view;
};

/** Assertion: the named view draws the given node or edge id (structural presence). */
export function viewDraws(
  viewId: string,
  id: string
): (outcome: DiffOutcome) => void {
  return ({ rendered }) => {
    const view = viewOf(rendered, viewId);
    const drawn = [...view.nodes.map((n) => n.id), ...view.edges.map((e) => e.id)];
    assert.ok(
      drawn.includes(id),
      `expected view '${viewId}' to draw '${id}', got: ${drawn.join(" ")}`
    );
  };
}

/** Assertion: the named view does NOT draw the given edge id (it belongs to a deeper layer). */
export function viewOmits(
  viewId: string,
  edgeId: string
): (outcome: DiffOutcome) => void {
  return ({ rendered }) => {
    const view = viewOf(rendered, viewId);
    assert.ok(
      !view.edges.some((e) => e.id === edgeId),
      `expected view '${viewId}' to omit edge '${edgeId}', but it drew it`
    );
  };
}

/** Assertion: in the named view, this edge resolves to the given colour (and line, if given). */
export function viewColorsEdge(
  viewId: string,
  edgeId: string,
  color: string,
  line?: string
): (outcome: DiffOutcome) => void {
  return ({ rendered }) => {
    const view = viewOf(rendered, viewId);
    const edge = view.edges.find((e) => e.id === edgeId);
    assert.ok(edge, `expected edge '${edgeId}' in '${viewId}', got: ${view.edges.map((e) => e.id).join(", ")}`);
    assert.equal(edge.color, color, `edge '${edgeId}' colour in '${viewId}'`);
    if (line !== undefined) assert.equal(edge.line, line, `edge '${edgeId}' line in '${viewId}'`);
  };
}

/** Assertion: in the named view, this box resolves to the given fill colour. */
export function viewColorsNode(
  viewId: string,
  nodeId: string,
  color: string
): (outcome: DiffOutcome) => void {
  return ({ rendered }) => {
    const view = viewOf(rendered, viewId);
    const node = view.nodes.find((n) => n.id === nodeId);
    assert.ok(node, `expected box '${nodeId}' in '${viewId}', got: ${view.nodes.map((n) => n.id).join(", ")}`);
    assert.equal(node.color, color, `box '${nodeId}' colour in '${viewId}'`);
  };
}

/**
 * Assertion: the named view carries no highlighting at all — every box is the
 * default `primary`, every edge the default `gray`. Proves a user-authored view
 * is left untouched (the diff styling never leaks out of the generated views).
 */
export function viewIsUnhighlighted(viewId: string): (outcome: DiffOutcome) => void {
  return ({ rendered }) => {
    const view = viewOf(rendered, viewId);
    const paintedNodes = view.nodes.filter((n) => n.color !== "primary").map((n) => n.id);
    assert.deepEqual(paintedNodes, [], `expected '${viewId}' to have no coloured boxes, got: ${paintedNodes.join(", ")}`);
    const paintedEdges = view.edges.filter((e) => e.color !== "gray").map((e) => e.id);
    assert.deepEqual(paintedEdges, [], `expected '${viewId}' to have no coloured edges, got: ${paintedEdges.join(", ")}`);
  };
}
