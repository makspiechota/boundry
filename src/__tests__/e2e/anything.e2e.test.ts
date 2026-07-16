import {
  testE2E,
  generatingRulesAndVerifying,
  noViolations,
  violationBetween,
  violationCount,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/anything";
const CODEBASE = `${FIXTURES}/codebase`;

// src/index.ts is the composition root: it imports the domain and the
// infrastructure to wire them together. Under a govern root, every module is
// constrained by default — so the wiring is a violation until the diagram says
// otherwise.

const compositionRootIsBlockedByDefault: Scenario = {
  name: "anything · without a wildcard, the composition root's wiring is blocked",
  given: {
    likeC4Path: `${FIXTURES}/arch-no-wildcard`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween("src/index.ts", "src/domain")(response);
    violationBetween("src/index.ts", "src/infra")(response);
    violationCount(2)(response);
  },
};

// An edge into a box tagged `#anything` exempts its source from every rule.
const wildcardEdgeExemptsItsSource: Scenario = {
  name: "anything · an edge to an #anything box lets its source import anything",
  given: {
    likeC4Path: `${FIXTURES}/arch-wildcard`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: noViolations,
};

// The exemption is granted to one module, not opened to the diagram.
const exemptionDoesNotLeak: Scenario = {
  name: "anything · the exemption is the wired module's alone and does not leak",
  given: {
    likeC4Path: `${FIXTURES}/arch-wildcard`,
    codebasePath: `${FIXTURES}/codebase-leak`,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween("src/domain", "src/infra")(response);
    violationCount(1)(response);
  },
};

testE2E([
  compositionRootIsBlockedByDefault,
  wildcardEdgeExemptsItsSource,
  exemptionDoesNotLeak,
]);
