import {
  testE2E,
  emittingDiffViews,
  emitsLayers,
  viewDraws,
  viewColorsEdge,
  viewColorsNode,
  viewIsUnhighlighted,
  type DiffGiven,
  type DiffOutcome,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/diff-single";

// Issue #8: the default `boundry diff` emits ONE `boundry_diff` landing view that
// draws every pending change at once — no per-layer explosion, uniform amber, no
// collapse. `include * -> * where tag is #proposed` (with no bare `include *`)
// pulls each proposed edge and its endpoint LEAVES in at leaf level, so a deeply-
// nested proposal keeps its own coloured node instead of collapsing into a grey
// ancestor (the failure mode of the per-layer `include *`).
const singleViewDrawsEveryChangeUncollapsed: Scenario<DiffGiven, DiffOutcome> = {
  name: "diff · single view draws every change at once, uncollapsed and uniformly coloured",
  given: { archPath: `${FIXTURES}` },
  when: emittingDiffViews(),
  then: (outcome) => {
    // Exactly one view, counting all four changes (2 edges + 2 boxes).
    emitsLayers([{ id: "boundry_diff", changes: 4 }])(outcome);

    // The proposed edge is drawn between its LEAF endpoints — deep does not
    // collapse into app — amber + solid; the removal red + solid.
    viewColorsEdge("boundry_diff", "app.mid.deep->infra.client", "amber", "solid")(outcome);
    viewColorsEdge("boundry_diff", "app.mid.deep->infra.legacy", "red", "solid")(outcome);
    // The deep leaf renders as its own node (proof it did not collapse).
    viewDraws("boundry_diff", "app.mid.deep")(outcome);

    // A standalone #proposed box (no edge) still shows and is amber; a
    // #proposal-delete box is red.
    viewColorsNode("boundry_diff", "app.shallow", "amber")(outcome);
    viewColorsNode("boundry_diff", "infra.legacy", "red")(outcome);

    // The user's own view is untouched — no colour leak from the diff view.
    viewIsUnhighlighted("index")(outcome);
  },
};

testE2E([singleViewDrawsEveryChangeUncollapsed]);
