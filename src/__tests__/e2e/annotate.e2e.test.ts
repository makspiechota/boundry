import {
  testE2E,
  approvingWritesLock,
  annotating,
  annotatingThenChecking,
  lockAllowsEdge,
  lockOmitsEdge,
  matchesDiagram,
  violationBetween,
  violationCount,
  type AnnotateGiven,
  type ApprovalGiven,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/annotate";

// approve records the accepted, post-enactment model as a lock — the baseline
// Boundry owns, rather than inferring it from whatever git happens to hold. An
// approved addition lands in the lock; an approved deletion is gone from it.
const approveRecordsTheAcceptedStateAsALock: Scenario<ApprovalGiven, string> = {
  name: "annotate · approve writes a lock of the accepted state",
  given: { proposedArchPath: `${FIXTURES}/proposed` },
  when: approvingWritesLock(),
  then: (lock) => {
    lockAllowsEdge("api", "legacy")(lock); // the approved #proposed addition
    lockOmitsEdge("domain", "legacy")(lock); // the approved #proposal-delete removal
  },
};

testE2E([approveRecordsTheAcceptedStateAsALock]);

// The core: a bare edge (a self-grant) that drifted past the lock is rewritten
// into an explicit #proposed proposal, deterministically and byte-for-byte.
const annotateRewritesADriftedEdgeAsAProposal: Scenario<AnnotateGiven, string> = {
  name: "annotate · a bare self-granted edge is rewritten as a #proposed proposal",
  given: { archPath: `${FIXTURES}/drifted` },
  when: annotating(),
  then: matchesDiagram(`${FIXTURES}/annotated/architecture.likec4`),
};

testE2E([annotateRewritesADriftedEdgeAsAProposal]);

// And it isn't cosmetic: once annotate marks api -> legacy #proposed, the edge
// leaves the allow-list, so the import that drifted through is a violation again
// — now correctly a proposal awaiting approval rather than a silent grant.
const annotatingFlipsTheEdgeBackToBlocked: Scenario = {
  name: "annotate · marking the drifted edge #proposed makes its import a violation again",
  given: {
    likeC4Path: `${FIXTURES}/drifted`,
    codebasePath: `${FIXTURES}/codebase`,
  },
  when: annotatingThenChecking(),
  then: (response) => {
    violationBetween("api", "legacy")(response);
    violationCount(1)(response);
  },
};

testE2E([annotatingFlipsTheEdgeBackToBlocked]);
