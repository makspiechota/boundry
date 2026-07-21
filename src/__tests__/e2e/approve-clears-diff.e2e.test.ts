import {
  testE2E,
  emittingDiffThenApproving,
  approveClearsDiffAndValidates,
  type DiffGiven,
  type ApproveDiffOutcome,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/approve-clears-diff";

// Issue #6: after `diff` writes boundry.diff.likec4, `approve` must remove that
// derived artifact — otherwise it is left describing already-approved changes,
// and (worse) approve used to splice the `#proposed` tokens out of its view
// rules, corrupting them into invalid LikeC4 so `likec4 validate` went red right
// after a successful approve.
const approveClearsTheStaleDiffFile: Scenario<DiffGiven, ApproveDiffOutcome> = {
  name: "approve · removes the derived boundry.diff.likec4 and leaves a workspace that validates",
  given: { archPath: `${FIXTURES}` },
  when: emittingDiffThenApproving(),
  then: approveClearsDiffAndValidates,
};

testE2E([approveClearsTheStaleDiffFile]);
