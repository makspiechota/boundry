import {
  testE2E,
  verifyingAgainstLock,
  noSelfApprovedEdges,
  selfApprovedEdge,
  type AnnotateGiven,
  type Scenario,
} from "./e2e-framework.js";
import type { AllowedEdge } from "../../core/model/boundary-model.js";

const FIXTURES = "src/__tests__/e2e/fixtures/verify-lock";

// verify compares the working diagram against the accepted boundry.lock — the
// state approve records — not a git ref. The lock exists to decouple "accepted"
// from "committed", so the gate reads from it, exactly as annotate does.

// The lock accepts only a -> b. A bare a -> c in the diagram is a grant made
// since the last approve: in the allow-list, absent from the lock. Caught.
const bareEdgeSinceLockIsASelfApproval: Scenario<AnnotateGiven, AllowedEdge[]> = {
  name: "verify · a bare edge added since the accepted lock is caught as a self-approval",
  given: { archPath: `${FIXTURES}/sneaked` },
  when: verifyingAgainstLock(),
  then: selfApprovedEdge("a", "c"),
};

// The same edge marked #proposed is excluded from the allow-list, so it is a
// proposal, not a grant — verify against the lock passes.
const proposedEdgeSinceLockPasses: Scenario<AnnotateGiven, AllowedEdge[]> = {
  name: "verify · a #proposed edge added since the accepted lock is not a self-approval",
  given: { archPath: `${FIXTURES}/proposed` },
  when: verifyingAgainstLock(),
  then: noSelfApprovedEdges,
};

testE2E([bareEdgeSinceLockIsASelfApproval, proposedEdgeSinceLockPasses]);
