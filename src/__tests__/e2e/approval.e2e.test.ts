import {
  testE2E,
  approving,
  approvingThenVerifying,
  generatingRulesAndVerifying,
  matchesDiagram,
  noViolations,
  violationBetween,
  violationCount,
  type ApprovalGiven,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/approval";

// Given the proposed diagram (with a #proposed marker), approving must strip the
// marker deterministically and produce exactly the accepted diagram.
const approvesProposedEdge: Scenario<ApprovalGiven, string> = {
  name: "approval · stripping #proposed promotes the intent edge to approved",
  given: { proposedArchPath: `${FIXTURES}/proposed/arch` },
  when: approving(),
  then: matchesDiagram(`${FIXTURES}/accepted/arch/architecture.likec4`),
};

testE2E([approvesProposedEdge]);

// ─── Enforcement: proposed is intent, not permission ──────────────────
// The codebase uses the #proposed domain -> shared edge. api -> domain and
// api -> shared are already approved in the same diagram.

const proposedEdgeIsNotYetAllowed: Scenario = {
  name: "approval · a #proposed edge is NOT enforced as allowed until approved",
  given: {
    likeC4Path: `${FIXTURES}/proposed/arch`,
    codebasePath: `${FIXTURES}/codebase`,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    // The proposed edge is rejected...
    violationBetween("src/domain", "src/shared")(response);
    // ...and only it: the already-approved api edges stay allowed.
    violationCount(1)(response);
  },
};

const approvingMakesTheEdgeAllowed: Scenario = {
  name: "approval · approving the marker flips the same edge to allowed",
  given: {
    likeC4Path: `${FIXTURES}/proposed/arch`,
    codebasePath: `${FIXTURES}/codebase`,
  },
  when: approvingThenVerifying(),
  then: noViolations,
};

testE2E([proposedEdgeIsNotYetAllowed, approvingMakesTheEdgeAllowed]);
