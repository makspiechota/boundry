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

const FIXTURES = "src/__tests__/e2e/fixtures/proposal-delete";
const CODEBASE = `${FIXTURES}/codebase`;

// #proposal-delete is the deletion counterpart to #proposed. It colours the
// edge/box red and, on approve, removes it outright — where #proposed only
// strips its own marker and leaves the edge behind.

// The core: approving a diagram with a #proposal-delete box AND edge removes both
// deterministically, producing exactly the expected accepted diagram.
const approveRemovesTheMarkedEdgeAndBox: Scenario<ApprovalGiven, string> = {
  name: "proposal-delete · approving removes the marked edge and box outright",
  given: { proposedArchPath: `${FIXTURES}/before` },
  when: approving(),
  then: matchesDiagram(`${FIXTURES}/after/architecture.likec4`),
};

testE2E([approveRemovesTheMarkedEdgeAndBox]);

// A pending deletion must not break the build: proposing to remove the edge
// leaves it allowed until a human approves. api still imports legacy — fine.
const pendingDeletionChangesNothing: Scenario = {
  name: "proposal-delete · a proposed deletion leaves the edge allowed while pending",
  given: {
    likeC4Path: `${FIXTURES}/edge-only`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: noViolations,
};

// Approving the deletion actually revokes the edge: the same api -> legacy
// import is now a violation, and legacy (kept as a module) still governs it.
const approvingTheDeletionRevokesTheEdge: Scenario = {
  name: "proposal-delete · approving the deletion turns the once-allowed import into a violation",
  given: {
    likeC4Path: `${FIXTURES}/edge-only`,
    codebasePath: CODEBASE,
  },
  when: approvingThenVerifying(),
  then: (response) => {
    violationBetween("api", "legacy")(response);
    violationCount(1)(response);
  },
};

testE2E([pendingDeletionChangesNothing, approvingTheDeletionRevokesTheEdge]);
