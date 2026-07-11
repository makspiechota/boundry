import {
  testE2E,
  generatingRulesAndVerifying,
  noViolations,
  violationBetween,
  type Scenario,
} from './e2e-framework.js';

const ARCH = 'src/__tests__/e2e/fixtures/hexagonal/arch';
const CODEBASES = 'src/__tests__/e2e/fixtures/hexagonal/codebases';

// One architecture diagram governs every scenario; only the codebase changes.

const clean: Scenario = {
  name: 'hexagonal · clean codebase respects every boundary',
  given: { likeC4Path: ARCH, codebasePath: `${CODEBASES}/clean` },
  when: generatingRulesAndVerifying(),
  then: noViolations,
};

const valueObjectImportsEntity: Scenario = {
  name: 'hexagonal · value object imports entity (DDD purity)',
  given: { likeC4Path: ARCH, codebasePath: `${CODEBASES}/breach-vo-imports-entity` },
  when: generatingRulesAndVerifying(),
  then: violationBetween('value-objects', 'entities'),
};

const commandImportsAggregate: Scenario = {
  name: 'hexagonal · command reaches aggregate directly (CQRS rule #1)',
  given: { likeC4Path: ARCH, codebasePath: `${CODEBASES}/breach-command-imports-aggregate` },
  when: generatingRulesAndVerifying(),
  then: violationBetween('application/commands', 'domain/aggregates'),
};

const infraImportsCommand: Scenario = {
  name: 'hexagonal · infrastructure bypasses public service (encapsulation)',
  given: { likeC4Path: ARCH, codebasePath: `${CODEBASES}/breach-infra-imports-command` },
  when: generatingRulesAndVerifying(),
  then: violationBetween('infrastructure', 'application/commands'),
};

// The only public surface is application/service. An outside caller that reaches
// any other application module, or into infrastructure or the domain, violates.
const entrypointReachesInternals: Scenario = {
  name: 'hexagonal · outside code may reach only the public service',
  given: {
    likeC4Path: ARCH,
    codebasePath: `${CODEBASES}/breach-entrypoint-reaches-internals`,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    violationBetween('src/main', 'application/commands')(response);
    violationBetween('src/main', 'infrastructure')(response);
    violationBetween('src/main', 'domain')(response);
  },
};

testE2E([
  clean,
  valueObjectImportsEntity,
  commandImportsAggregate,
  infraImportsCommand,
  entrypointReachesInternals,
]);
