import {
  testE2E,
  emittingDiffViews,
  matchesDiffFile,
  emitsLayers,
  emitsNothing,
  viewOmits,
  viewColorsEdge,
  viewColorsNode,
  viewIsUnhighlighted,
  type DiffGiven,
  type DiffOutcome,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/diff-views";

// One focused view per layer that holds a pending change: a proposed removal at
// the root, a proposed addition nested inside billing. The generated file is
// deterministic — a golden byte-for-byte comparison.
const emitsAViewPerChangedLayer: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · writes one scoped view per layer that holds a pending change",
  given: { archPath: `${FIXTURES}/nested` },
  when: emittingDiffViews(true),
  then: (outcome) => {
    matchesDiffFile(`${FIXTURES}/nested/expected.boundry.diff.txt`)(outcome);
    emitsLayers([
      { id: "boundry_diff_root", changes: 1 },
      { id: "boundry_diff_billing", changes: 1 },
    ])(outcome);
  },
};

testE2E([emitsAViewPerChangedLayer]);

// The point of per-layer views: a proposal nested inside billing is only drawn
// in billing's own view. At root, billing collapses to one box and the inner
// #proposed edge vanishes — so a single all-up view would hide it. And the
// highlighting is deterministic: amber+solid for additions, red+solid for
// removals, resolved by the emitted style rules (no hand-styling).
const nestedProposalIsColouredOnlyInItsLayer: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · a nested proposal is coloured in its layer's view, not the collapsed root",
  given: { archPath: `${FIXTURES}/nested` },
  when: emittingDiffViews(true),
  then: (outcome) => {
    // billing's view colours the proposed edge amber + solid...
    viewColorsEdge("boundry_diff_billing", "billing.invoicer->billing.ledger", "amber", "solid")(outcome);
    // ...the root view colours the proposed removal red + solid...
    viewColorsEdge("boundry_diff_root", "api->billing", "red", "solid")(outcome);
    // ...but the root view cannot show the inner edge (billing is collapsed there)...
    viewOmits("boundry_diff_root", "billing.invoicer->billing.ledger")(outcome);
    // ...and the user's own view is left completely untouched — no colour leak.
    viewIsUnhighlighted("index")(outcome);
  },
};

testE2E([nestedProposalIsColouredOnlyInItsLayer]);

// Issue #7: a deep cross-system edge must be reviewable at every altitude it is
// drawn, not just the common-ancestor (root) layer. The proposal between two
// nested leaves (s1.c1.a -> s2.c2.b) emits five views — root, and each endpoint's
// system and container — never the leaf endpoints themselves, never above the
// common ancestor (where it would collapse to a self-loop). It is coloured
// amber + solid at each, collapsed to the shallowest visible endpoint per side.
const deepEdgeIsDrawnAtEveryAltitude: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · a deep cross-system edge emits one view per altitude it is drawable at",
  given: { archPath: `${FIXTURES}/deep` },
  when: emittingDiffViews(true),
  then: (outcome) => {
    emitsLayers([
      { id: "boundry_diff_root", changes: 1 },
      { id: "boundry_diff_s1", changes: 1 },
      { id: "boundry_diff_s1_c1", changes: 1 },
      { id: "boundry_diff_s2", changes: 1 },
      { id: "boundry_diff_s2_c2", changes: 1 },
    ])(outcome);
    viewColorsEdge("boundry_diff_root", "s1->s2", "amber", "solid")(outcome);
    viewColorsEdge("boundry_diff_s1", "s1.c1->s2", "amber", "solid")(outcome);
    viewColorsEdge("boundry_diff_s1_c1", "s1.c1.a->s2", "amber", "solid")(outcome);
    viewColorsEdge("boundry_diff_s2", "s1->s2.c2", "amber", "solid")(outcome);
    viewColorsEdge("boundry_diff_s2_c2", "s1->s2.c2.b", "amber", "solid")(outcome);
    viewIsUnhighlighted("index")(outcome);
  },
};

testE2E([deepEdgeIsDrawnAtEveryAltitude]);

// Boxes, not just edges: a #proposed box fills amber, a #proposal-delete box
// fills red, deterministically — while unchanged boxes and edges keep their
// defaults. This is the seam issue #4 closes: colouring with no inline styling.
const proposedAndDeletedBoxesAreFilled: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · proposed / proposal-delete boxes are filled amber / red",
  given: { archPath: `${FIXTURES}/boxes` },
  when: emittingDiffViews(true),
  then: (outcome) => {
    viewColorsNode("boundry_diff_root", "reporting", "amber")(outcome); // #proposed box
    viewColorsNode("boundry_diff_root", "legacy", "red")(outcome); // #proposal-delete box
    viewColorsEdge("boundry_diff_root", "api->reporting", "amber", "solid")(outcome); // #proposed edge
    // Unchanged neighbours keep the defaults — highlighting is targeted.
    viewColorsNode("boundry_diff_root", "domain", "primary")(outcome);
    viewColorsEdge("boundry_diff_root", "api->domain", "gray", "dashed")(outcome);
    viewIsUnhighlighted("index")(outcome);
  },
};

testE2E([proposedAndDeletedBoxesAreFilled]);

// Nothing proposed: no diff file is written.
const cleanDiagramEmitsNoViews: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · a diagram with no markers emits no diff views",
  given: { archPath: `${FIXTURES}/clean` },
  when: emittingDiffViews(),
  then: emitsNothing,
};

testE2E([cleanDiagramEmitsNoViews]);

// A stale diff file left from an earlier proposal is removed once the proposals
// are gone, so `serve` never renders a diff that no longer exists.
const staleDiffFileIsClearedWhenNothingIsProposed: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · a stale diff file is cleared when nothing is proposed",
  given: { archPath: `${FIXTURES}/stale` },
  when: emittingDiffViews(),
  then: emitsNothing,
};

testE2E([staleDiffFileIsClearedWhenNothingIsProposed]);
