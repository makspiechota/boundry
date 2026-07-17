import {
  testE2E,
  emittingDiffViews,
  matchesDiffFile,
  emitsLayers,
  emitsNothing,
  viewDraws,
  viewOmits,
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
  when: emittingDiffViews(),
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
// #proposed edge vanishes — so a single all-up view would hide it.
const nestedProposalIsVisibleOnlyInItsLayer: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · a nested proposal is drawn in its layer's view, not the collapsed root",
  given: { archPath: `${FIXTURES}/nested` },
  when: emittingDiffViews(),
  then: (outcome) => {
    // billing's view draws the amber proposed edge...
    viewDraws("boundry_diff_billing", "billing.invoicer->billing.ledger[proposed]")(outcome);
    // ...and the root view draws the red proposed removal...
    viewDraws("boundry_diff_root", "api->billing[proposal-delete]")(outcome);
    // ...but the root view cannot show the inner edge (billing is collapsed there).
    viewOmits("boundry_diff_root", "billing.invoicer->billing.ledger")(outcome);
  },
};

testE2E([nestedProposalIsVisibleOnlyInItsLayer]);

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
