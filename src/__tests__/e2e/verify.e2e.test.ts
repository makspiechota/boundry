import {
  testE2E,
  comparingArchitectures,
  noSelfApprovedEdges,
  selfApprovedEdge,
  type VerifyGiven,
  type Scenario,
} from "./e2e-framework.js";
import type { AllowedEdge } from "../../core/model/boundary-model.js";

const FIXTURES = "src/__tests__/e2e/fixtures/verify";

// The base architecture allows only a -> b.

// Adding a bare `a -> c` grants a new dependency without proposing it — the
// lazy self-approval an agent would reach for. It must be caught.
const bareEdgeIsASelfApproval: Scenario<VerifyGiven, AllowedEdge[]> = {
  name: "verify · a bare new edge is caught as a self-approval",
  given: {
    baseArchPath: `${FIXTURES}/base/arch`,
    headArchPath: `${FIXTURES}/sneaked/arch`,
  },
  when: comparingArchitectures(),
  then: selfApprovedEdge("a", "c"),
};

// Adding `a -> c #proposed` is a proposal, not a grant — it is excluded from
// the allow-list, so it is not a self-approval and must pass verification.
const proposedEdgeIsNotASelfApproval: Scenario<VerifyGiven, AllowedEdge[]> = {
  name: "verify · a properly #proposed edge is not a self-approval",
  given: {
    baseArchPath: `${FIXTURES}/base/arch`,
    headArchPath: `${FIXTURES}/proposed/arch`,
  },
  when: comparingArchitectures(),
  then: noSelfApprovedEdges,
};

testE2E([bareEdgeIsASelfApproval, proposedEdgeIsNotASelfApproval]);
