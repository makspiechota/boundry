# Changelog

All notable changes to Boundry are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [semver](https://semver.org/).

## [0.5.0] — 2026-07-21

### Fixed

- **`approve` no longer leaves a stale, corrupted `boundry.diff.likec4`** ([#6]).
  `approve` used to walk the derived diff file along with the model and splice the
  marker tokens out of its *view rules* (`style element.tag = #proposed …`,
  `include … where tag is #proposed`), mangling them into invalid LikeC4 — so
  `likec4 validate` (and any `arch:verify` gate) went red immediately after a
  successful approve, recoverable only by a separate `diff` run. `approve` now
  skips the derived file and deletes it as part of enacting: the moment the last
  proposal is approved those views are stale — they frame changes that are now
  approved — so the post-approve workspace is clean and validates.

### Added

- **Per-altitude diff views** ([#7]). `boundry diff` now emits a focused view for
  *every* layer that draws a changed edge, not only the common-ancestor layer. A
  cross-system dependency between two deeply-nested leaves is drawable at each
  endpoint's system and container as well as at the shared root; `diff` emits one
  `view … of <scope>` for each, so a reviewer can open the change at whatever
  altitude matters — the whole system, a specific container — instead of being
  dropped at the noisy root view. The scopes are derived from how LikeC4's
  `include *` actually renders: the common ancestor plus each endpoint's ancestor
  chain down to its parent, never *above* the common ancestor (where both
  endpoints collapse into one child and the edge becomes an undrawn self-loop) and
  never the leaf endpoints themselves. Boxes are unchanged — one view at the box's
  parent layer.

### Changed

- **`verify` now compares against the accepted `boundry.lock`, not a git ref.**
  The lock was introduced in 0.4.0 to decouple *approved* from *committed*, but
  `verify --base <ref>` kept re-deriving its baseline from a diagram at a git ref
  — quietly re-coupling "accepted" to "committed", the very thing the lock exists
  to break. `verify` now reads the lock, exactly as `annotate` does, so the two
  share one baseline and can never disagree about what "accepted" means. It also
  catches a committed-but-*unapproved* bare edge, which the git-ref baseline
  silently absorbed. The `--base` flag is gone from `verify` and `approve`;
  `approve`'s anti-laundering pre-check now runs the same lock-based gate, and the
  first `approve` (no lock yet) bootstraps the initial accepted state. **Tradeoff,
  by design:** the baseline is the working-tree lock, so the gate leans on
  `approve` being a human act — the lock moves only when someone approves, which
  is why the skill forbids agents from running it.

[#6]: https://github.com/makspiechota/boundry/issues/6
[#7]: https://github.com/makspiechota/boundry/issues/7

## [0.4.0] — 2026-07-17

Makes the "one file can be both the communication diagram and the enforcement
model" promise hold for deep, nested C4 trees, and makes a proposed change
highlight itself — deterministically, on every LikeC4 surface.

### Added

- **Accepted-state lock + `annotate` (prototype).** `approve` now records the
  accepted model to `boundry.lock` beside the diagram — a baseline Boundry
  **owns**, rather than inferring it from whatever git happens to hold, so
  "approved" is decoupled from "committed". `boundry annotate` diffs the diagram
  against that lock and rewrites every undeclared addition — a bare new edge (a
  self-grant) or box — into an explicit `#proposed` proposal in the source,
  deterministically and idempotently. Turns silent drift into a reviewable,
  colourable proposal. (Additive only; deletions are reported, not round-tripped
  back into the DSL — re-materialising a removed box would resurrect it as an
  enforced module.)
  - **Cross-surface highlighting** ([#5]). `annotate` also paints each marker with
    an intrinsic `style { color amber }` (`#proposed`) / `style { color red }`
    (`#proposal-delete`) on the element itself. Intrinsic style is the only styling
    LikeC4 renders on **every** surface — base views *and* the "relationships of X"
    panel — so a proposal is highlighted wherever a reviewer looks, not just inside
    the diff views (whose view-scoped rules stop at the view boundary). Idempotent,
    and `approve` strips the styling back out with the marker: a `#proposed` edge
    returns to bare, a `#proposed` box loses its colour, a `#proposal-delete` is
    removed outright. Needs LikeC4 ≥ 1.58 to render.
- **Per-layer diff views — `boundry diff` (prototype).** Generates a focused
  LikeC4 view for every layer that holds a pending change — an edge or box tagged
  `#proposed` or `#proposal-delete` — scoped to the tightest element that draws
  it, into a derived `boundry.diff.likec4`. This matters because a proposal nested
  inside a box is invisible once that box collapses at a wider zoom, so a single
  all-up view hides it; one view per layer surfaces every change in the scope
  where it renders. It reads the diagram's own markers, not the lock, so it frames
  whatever `annotate` or a human marked. The file is derived — overwritten each
  run, removed when nothing is proposed — so it always reflects the current
  diagram; regenerate after `approve`.
  - **Deterministic highlighting** ([#4]). `diff` emits the LikeC4 style rules
    into the derived file, so a `#proposed` box fills amber and its edge goes
    amber + solid, a `#proposal-delete` red — with no hand-styling. Boxes are
    styled in place (`style element.tag`, never force-included), so a nested
    proposal stays in its layer; the rules live only in the generated views, so
    user-authored views are untouched. Rules are emitted only for marker tags
    actually in use (referencing an undeclared tag is a hard LikeC4 error).
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
- **`likec4` floor raised to `^1.58.0`.** The diff-view style-rule syntax Boundry
  emits is verified against LikeC4 1.58; rendering the coloured views needs a
  renderer at least that new.

[#3]: https://github.com/makspiechota/boundry/issues/3
[#4]: https://github.com/makspiechota/boundry/issues/4
[#5]: https://github.com/makspiechota/boundry/issues/5

## [0.3.0] — 2026-07-16 — superseded by 0.4.0

Published early from a pre-feature snapshot (≈ 0.2.0 plus the `#anything`
wildcard) and never carried the work now listed under 0.4.0. npm versions are
immutable, so it stays on the registry; use **0.4.0**.

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
