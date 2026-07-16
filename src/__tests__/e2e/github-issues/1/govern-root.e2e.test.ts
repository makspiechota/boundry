import {
  testE2E,
  generatingRulesAndVerifying,
  noViolations,
  violationBetween,
  violationCount,
  warnsAbout,
  type Scenario,
} from "../../e2e-framework.js";

// github.com/makspiechota/boundry/issues/1 — brand-new, unmodelled code was free
// to import, so an agent blocked by a boundary could route around it through a
// folder nobody had drawn.

const FIXTURES = "src/__tests__/e2e/github-issues/1/fixtures";
const CODEBASE = `${FIXTURES}/codebase`;

// The codebase imports a drawn edge (a -> b) and also reaches into
// src/unmapped, a folder no element models.

// With `governRoot 'src'`, the whole tree is the govern universe: territory
// nobody modelled is forbidden, not free.
const unmappedCodeUnderRootIsBlocked: Scenario = {
  name: "govern-root · importing unmapped code under the govern root is blocked",
  given: {
    likeC4Path: `${FIXTURES}/arch-governed`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween("src/a", "src/unmapped")(response);
    // ...and only that: the drawn a -> b edge stays allowed.
    violationCount(1)(response);
    // The symmetric guard to the zero-files warning: code the model doesn't claim.
    warnsAbout("src/unmapped")(response);
  },
};

// Opt-in: with no govern root declared, unmapped folders stay ignored, so the
// communication diagram can keep actors/externals without breaking enforcement.
const withoutGovernRootUnmappedIsIgnored: Scenario = {
  name: "govern-root · without a govern root, unmapped code stays ignored",
  given: {
    likeC4Path: `${FIXTURES}/arch-ungoverned`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: noViolations,
};

testE2E([unmappedCodeUnderRootIsBlocked, withoutGovernRootUnmappedIsIgnored]);
