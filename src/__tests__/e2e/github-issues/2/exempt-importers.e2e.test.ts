import {
  testE2E,
  generatingRulesAndVerifying,
  comparingExemptions,
  noViolations,
  selfGrantedExemption,
  violationBetween,
  violationCount,
  warnsAbout,
  type Scenario,
  type VerifyGiven,
} from "../../e2e-framework.js";

// github.com/makspiechota/boundry/issues/2 — every file under a mapped folder was
// governed as a rule *source*, with no way to exempt any of them. Reported from
// dogfooding on a hexagonal repo: `boundry check src` returned 9 violations, all
// of them test files legitimately wiring real adapters across layers. Production
// code was clean.

const FIXTURES = "src/__tests__/e2e/github-issues/2/fixtures";
const CODEBASE = `${FIXTURES}/codebase`;

// The codebase: an integration test under src/application/__tests__ imports the
// infrastructure adapter, and an ambient .d.ts types a global with an
// infrastructure type. Neither is production code taking a dependency.

const testsAndAmbientDeclsAreGovernedByDefault: Scenario = {
  name: "issue-2 · without an exemption, test files and .d.ts are policed as importers",
  given: {
    likeC4Path: `${FIXTURES}/arch-no-exempt`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween("src/application", "src/infrastructure")(response);
    violationBetween("src/domain", "src/infrastructure")(response);
    violationCount(2)(response);
  },
};

// The acceptance criterion from the issue: the same imports, now exempt.
const exemptImportersAreNotPoliced: Scenario = {
  name: "issue-2 · exemptImporters drops matched files from every rule's from side",
  given: {
    likeC4Path: `${FIXTURES}/arch-exempt`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: noViolations,
};

// The other half of the criterion: the exemption is from-side only. Production
// reaching into a test helper is still a violation.
const exemptionIsFromSideOnly: Scenario = {
  name: "issue-2 · exempt files are still governed as import targets",
  given: {
    likeC4Path: `${FIXTURES}/arch-exempt`,
    codebasePath: `${FIXTURES}/codebase-leak`,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween("src/domain", "src/application")(response);
    violationCount(1)(response);
  },
};

// LikeC4 processes string escapes, so '\.d\.ts$' silently arrives as '.d.ts$'.
// A pattern that matches nothing is the symptom, and it must not pass quietly:
// the author thinks files are exempt while they are still being policed.
const deadExemptionIsReported: Scenario = {
  name: "issue-2 · an exemption that matches no files is reported",
  given: {
    likeC4Path: `${FIXTURES}/arch-dead-exempt`,
    codebasePath: CODEBASE,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    warnsAbout("/__specs__/")(response);
    // The exemption is dead, so the files it meant to cover are still policed.
    violationCount(2)(response);
  },
};

testE2E([
  testsAndAmbientDeclsAreGovernedByDefault,
  exemptImportersAreNotPoliced,
  exemptionIsFromSideOnly,
  deadExemptionIsReported,
]);

// An exemption is a grant: it lifts whole files out of every rule. An agent
// blocked by a boundary could otherwise add one and walk straight through, so
// verify has to report it like any other self-granted dependency.
const addingAnExemptionIsASelfGrant: Scenario<VerifyGiven, string[]> = {
  name: "issue-2 · verify reports an exemption added since the approved base",
  given: {
    baseArchPath: `${FIXTURES}/arch-no-exempt`,
    headArchPath: `${FIXTURES}/arch-exempt`,
  },
  when: comparingExemptions(),
  then: selfGrantedExemption("/__tests__/|\\.d\\.ts$"),
};

testE2E([addingAnExemptionIsASelfGrant]);
