import {
  testE2E,
  generatingRulesAndVerifying,
  violationBetween,
  violationCount,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/whitelist";

// The codebase imports across all three modules: a -> b, a -> c, b -> c.
const CODEBASE = `${FIXTURES}/codebase`;

// With no edges drawn, nothing is allowed — every cross-module import is blocked.
const blocksEverythingByDefault: Scenario = {
  name: "whitelist · with no edges drawn, every cross-module import is blocked",
  given: { likeC4Path: `${FIXTURES}/arch-none`, codebasePath: CODEBASE },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween("src/a", "src/b")(response);
    violationBetween("src/a", "src/c")(response);
    violationBetween("src/b", "src/c")(response);
    violationCount(3)(response);
  },
};

// Drawing a -> b whitelists exactly that edge; a -> c and b -> c stay blocked.
const whitelistsExactlyWhatIsDrawn: Scenario = {
  name: "whitelist · only the drawn edge is allowed, the rest stay blocked",
  given: { likeC4Path: `${FIXTURES}/arch-a-to-b`, codebasePath: CODEBASE },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    // a -> b is now allowed, so it must NOT appear; only the other two remain.
    violationBetween("src/a", "src/c")(response);
    violationBetween("src/b", "src/c")(response);
    violationCount(2)(response);
  },
};

testE2E([blocksEverythingByDefault, whitelistsExactlyWhatIsDrawn]);
