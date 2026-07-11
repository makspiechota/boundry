import {
  testE2E,
  generatingRulesAndVerifying,
  noViolations,
  importRuleViolated,
  type Scenario,
} from './e2e-framework.js';

const noViolationsScenario: Scenario = {
  name: 'clean codebase → no violations',
  given: {
    likeC4Path: 'src/__tests__/e2e/fixtures/clean/arch',
    codebasePath: 'src/__tests__/e2e/fixtures/clean',
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    noViolations(response);
  },
};

const importViolationScenario: Scenario = {
  name: 'illegal domain → infra import → boundary violated',
  given: {
    likeC4Path: 'src/__tests__/e2e/fixtures/violation/arch',
    codebasePath: 'src/__tests__/e2e/fixtures/violation',
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    importRuleViolated(response);
  },
};

testE2E([noViolationsScenario, importViolationScenario]);
