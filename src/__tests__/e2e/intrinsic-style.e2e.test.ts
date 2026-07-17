import {
  testE2E,
  stylingThenRendering,
  stylingThenApproving,
  matchesDiagram,
  viewColorsNode,
  viewColorsEdge,
  type DiffGiven,
  type DiffOutcome,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/intrinsic-style";

// Issue #5: the diff views colour proposals with view-scoped rules, which LikeC4
// applies only inside those views. annotate paints INTRINSIC style on the marked
// edges/boxes, which renders on every surface — proven here in a base authored
// view (`index`), where no view-scoped rule reaches.
const intrinsicStyleColoursABaseView: Scenario<DiffGiven, DiffOutcome> = {
  name: "intrinsic-style · marked edges/boxes are coloured in a base view (not just diff views)",
  given: { archPath: `${FIXTURES}/marked` },
  when: stylingThenRendering(),
  then: (outcome) => {
    // #proposed box + edge → amber, on the base `index` view.
    viewColorsNode("index", "reporting", "amber")(outcome);
    viewColorsEdge("index", "api->reporting", "amber")(outcome);
    // #proposal-delete box + edge → red (still present until approve).
    viewColorsNode("index", "legacy", "red")(outcome);
    viewColorsEdge("index", "api->legacy", "red")(outcome);
    // Unmarked neighbours keep their defaults — styling is targeted.
    viewColorsNode("index", "domain", "primary")(outcome);
    viewColorsEdge("index", "api->domain", "gray")(outcome);
  },
};

testE2E([intrinsicStyleColoursABaseView]);

// And approve reverses it completely: a #proposed edge goes back to bare, a
// #proposed box stays but loses its amber, a #proposal-delete edge/box is removed
// outright — no marker, no injected styling left behind on any surface.
const approveStripsMarkerAndStyling: Scenario<DiffGiven, string> = {
  name: "intrinsic-style · approve strips both the marker and the injected styling (edges + boxes)",
  given: { archPath: `${FIXTURES}/marked` },
  when: stylingThenApproving(),
  then: matchesDiagram(`${FIXTURES}/approved/architecture.likec4`),
};

testE2E([approveStripsMarkerAndStyling]);
