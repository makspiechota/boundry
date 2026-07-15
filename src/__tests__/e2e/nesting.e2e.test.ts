import {
  testE2E,
  generatingRulesAndVerifying,
  violationBetween,
  violationCount,
  type Scenario,
} from "./e2e-framework.js";

const FIXTURES = "src/__tests__/e2e/fixtures/nesting";

// infrastructure.db -> application.ports and application.service ->
// infrastructure.db are the only drawn edges. They connect the two subtrees,
// but must not permit every child pair across them.
const subtreeConnectionIsNotBlanket: Scenario = {
  name: "nesting · a connection between two subtrees does not permit every child pair",
  given: { likeC4Path: `${FIXTURES}/arch`, codebasePath: `${FIXTURES}/codebase` },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    // infra.db may reach application.ports, but NOT application.service.
    violationBetween("infrastructure/db", "application/service")(response);
    // Only infra.db may reach application.ports — infra.mailer may not.
    violationBetween("infrastructure/mailer", "application/ports")(response);
    // ...and the two drawn edges (db -> ports, service -> db) stay allowed.
    violationCount(2)(response);
  },
};

// When a parent folder AND its child are both mapped, a top-level edge on the
// parent must apply only to the parent's own files. The child does not inherit
// it, and the child's internal imports must never be flagged.
const parentEdgeDoesNotLeakToChild: Scenario = {
  name: "nesting · a parent-level edge applies to the parent's own files, not its mapped child",
  given: {
    likeC4Path: `${FIXTURES}-parent/arch`,
    codebasePath: `${FIXTURES}-parent/codebase`,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    // The child reaching infrastructure is the one and only violation.
    violationBetween("application/secret", "infrastructure")(response);
    // Not the intra-module import, not the parent's own allowed import.
    violationCount(1)(response);
  },
};

testE2E([subtreeConnectionIsNotBlanket, parentEdgeDoesNotLeakToChild]);

