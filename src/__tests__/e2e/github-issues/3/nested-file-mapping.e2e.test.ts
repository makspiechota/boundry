import {
  testE2E,
  generatingRulesAndVerifying,
  noViolations,
  violationBetween,
  violationCount,
  type Scenario,
} from "../../e2e-framework.js";

// github.com/makspiechota/boundry/issues/3 — a deep nested C4 tree could not
// double as the enforcement model. Folder-only mapping forced a guarded FILE to
// collapse into its parent folder, turning sibling edges into ancestor↔descendant
// edges that LikeC4 rejects with "Invalid parent-child relationship". Mapping the
// guard to a file leaf keeps it a sibling, so the nested model stays legal AND
// enforceable.

const FIXTURES = "src/__tests__/e2e/github-issues/3/fixtures";
const ARCH = `${FIXTURES}/arch-nested`;

// The store is a file leaf inside ports/, beside the story-points-read sub-folder.
// stub (a descendant of ports) imports it — the very edge that was illegal when
// the store was collapsed into the ports folder.
const descendantMayImportAnAncestorsFileLeaf: Scenario = {
  name: "issue-3 · a file leaf lets a descendant import an ancestor folder's guarded file",
  given: {
    likeC4Path: ARCH,
    codebasePath: `${FIXTURES}/codebase`,
  },
  when: generatingRulesAndVerifying(),
  then: noViolations,
};

// The grant is stub -> store, not "anything -> store". A sibling reaching into
// the same file is caught — the file leaf is a first-class governed target, and
// stub's allowance does not leak to read.
const theFileLeafIsAGovernedTargetNotAFreeForAll: Scenario = {
  name: "issue-3 · a file leaf is a governed target; a sibling's undrawn import is caught",
  given: {
    likeC4Path: ARCH,
    codebasePath: `${FIXTURES}/codebase-leak`,
  },
  when: generatingRulesAndVerifying(),
  then: (response) => {
    // read.ts → in-memory-store.ts is not drawn, so it violates...
    violationBetween("read.ts", "in-memory-store")(response);
    // ...and only it: the drawn stub -> store edge stays allowed.
    violationCount(1)(response);
  },
};

testE2E([
  descendantMayImportAnAncestorsFileLeaf,
  theFileLeafIsAGovernedTargetNotAFreeForAll,
]);
