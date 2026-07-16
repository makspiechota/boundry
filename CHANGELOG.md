# Changelog

All notable changes to Boundry are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [semver](https://semver.org/).

## [0.3.0] — unreleased

Makes the "one file can be both the communication diagram and the enforcement
model" promise hold for deep, nested C4 trees.

### Added

- **`#proposal-delete` — the deletion half of the approval lifecycle.** Tag an
  edge or a box `#proposal-delete` to propose retiring it. The marker colours it
  red; a pending deletion changes nothing (the edge stays allowed, the box stays
  enforced), so proposing a removal never breaks the build. On `approve`, the
  marked edge or box is removed from the diagram outright — deterministically, by
  splicing the LikeC4 CST — where `#proposed` only strips its own marker and
  leaves the edge behind. `#proposed` (amber, additive) and `#proposal-delete`
  (red, subtractive) are now the two halves of every change.
- **File-level mapping — `metadata { file 'src/x.ts' }`** ([#3]). An element maps
  to a single file instead of a folder. A file module owns exactly its file; a
  folder module owns its subtree minus any mapped descendants — nested folders
  and file leaves alike.
  - This is what lets a deep nested diagram stay legal *and* enforceable. A
    guarded contract or port that sits beside sibling sub-folders can be a file
    leaf rather than collapsing into its parent folder. Collapsed, its edges
    become ancestor↔descendant, which LikeC4 rejects with
    `Invalid parent-child relationship`; as a leaf they stay sibling-to-sibling.
  - Declaring both `folder` and `file` on one element is an error.

### Changed

- **`Module.folder: string` → `Module.path: string` + `Module.kind: 'folder' | 'file'`.**
  SDK-breaking; the diagram surface and CLI are unaffected.

[#3]: https://github.com/makspiechota/boundry/issues/3

## [0.2.0] — 2026-07-16

The release that makes the diagram a *governed* artifact rather than just a
source of rules. An agent can now be handed the diagram without being handed the
ability to grant itself dependencies.

### Added

- **Approval lifecycle — `#proposed`.** An edge marked `#proposed` is intent, not
  permission: it is excluded from the allow-list, so `check` stays red until a
  human approves. Mark an element too and the reviewer sees the new box as well
  as the new arrow.
  - On an **edge** the marker is semantic (the edge grants nothing until
    approved). On an **element** it is visual only — a module is enforced from
    the moment it is drawn, which is safe, because a module grants nothing until
    an edge permits it. **The edge is always the only grant.**
- **`boundry approve`** — strips `#proposed` markers deterministically by
  splicing the LikeC4 CST. Never an LLM edit: source-preserving, idempotent, and
  byte-exact. Approval is a human act; this command is the human's.
- **`boundry verify --base <ref>`** — compares the working diagram against an
  approved git ref and rejects any edge granted *without* going through a
  proposal. Because proposals are excluded from the allow-list, the set of
  newly-allowed edges is exactly the set of self-approvals. `approve --base` uses
  the same gate, so it refuses to launder a self-granted edge.
- **`governRoot` (opt-in)** ([#1]) — `metadata { governRoot 'src' }` declares a code
  root fully governed: importing territory under it that no module claims is a
  violation rather than free, and `check` warns about code no module covers. The
  mirror of the zero-files warning. Without it, unmapped folders stay ignored, so
  a communication diagram still works as an enforcement diagram.
- **`#anything` wildcard** — a box tagged `#anything` maps to no folder and stands
  for the rest of the code; a module with an edge into it is exempt from every
  rule. This is the explicit way to say "deliberately unconstrained", for the
  composition root that must import everything to wire it together.
  - It rides the same protocol as any other edge: `#proposed` suppresses it until
    approved, and `verify` reports a self-granted wildcard edge like any other.
  - Prior to this, the only way to let `src/index.ts` wire things up under a
    govern root was to leave it *unmapped* — granting the same power by
    **omission**, with nothing drawn for a reviewer to see.
  - The exemption belongs to the wired module alone and does not leak.
- **`exemptImporters`** ([#2]) — `metadata { exemptImporters '/__tests__/|\\.d\\.ts$' }`
  drops matched files from every rule's `from` side: they are analysed, but never
  held to a boundary as an importer. For test files that legitimately wire real
  adapters across layers, and for ambient `.d.ts` declarations.
  - **From-side only.** Exempt files stay governed as import *targets*, so
    production importing a test helper is still a violation.
  - Patterns are regexes and union across every element that declares one.
    LikeC4 has no repeated metadata keys, so use a `|` alternation or one per
    element. **Backslashes must be doubled** — LikeC4 processes string escapes,
    so `'\.d\.ts$'` arrives as `.d.ts$` and over-matches silently.
  - `check` warns when an exemption matches **zero** files or **every** file;
    both mean the pattern is wrong. An invalid or empty pattern is a hard error.
  - `verify` reports an exemption added since the base, like any other grant.
- **Skill for coding agents** — `.claude/skills/define-architecture-boundaries`
  documents the annotations and the proposal protocol, including the things an
  agent must never do: add a bare edge, strip a marker, run `approve`, draw a
  wildcard, or route around a boundary through an unmodelled folder.
- **Nesting support.** A module owns its folder *minus* any mapped descendants,
  so a parent's edges govern only the parent's own files. A child never inherits
  them and must be permitted explicitly; a connection between two subtrees never
  permits every child pair across them.

### Fixed

- **A check that analysed zero files reported success.** `check` now throws when
  dependency-cruiser sees no sources — the setup being broken is a failure, not a
  clean run. This is the guard that caught the 0.1.0 packaging bug below.

### Changed

- **`Pipeline.verify()` returns `VerifyResult`** (`{ edges, exemptions }`) rather
  than a bare edge array, so both kinds of grant surface. SDK-breaking; the CLI
  is unaffected.

[#1]: https://github.com/makspiechota/boundry/issues/1
[#2]: https://github.com/makspiechota/boundry/issues/2

## [0.1.1] — never released

Tagged locally, never published or pushed; its contents ship as part of 0.2.0.

### Fixed

- **`typescript` moved to `dependencies`.** dependency-cruiser needs it at
  runtime to parse `.ts`; as a devDependency it was absent from a real install.
- **Stale `dist/` artifacts in the published tarball.** `build` now cleans first,
  so a restructure can't leave orphaned files from a previous layout.

## [0.1.0] — 2026-07 — **deprecated, do not use**

**This version silently enforces nothing.** `typescript` was a devDependency, so
in a clean install dependency-cruiser could not parse TypeScript and reported
`✓ no boundary violations` while checking zero files. A guardrail that fails open
is worse than none. Upgrade.

## [0.0.1]

First publish. Compiles a LikeC4 diagram into dependency-cruiser rules:
`metadata { folder '…' }` maps an element to a folder, every drawn relationship
is an allowed dependency, and everything undrawn is forbidden. Commands: `check`,
`generate`.
