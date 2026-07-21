---
name: define-architecture-boundaries
description: How to annotate a LikeC4 diagram so Boundry compiles it into deterministic dependency-linter rules, and how to propose an architecture change with the #proposed marker instead of granting yourself a dependency. Use when creating or editing an architecture Boundry enforces, or when a boundary violation blocks you.
---

# Defining architecture boundaries for Boundry

Boundry reads a LikeC4 diagram and generates a dependency linter from it. The
diagram is the source of truth; the code is checked against it. Everything you do
not draw is forbidden.

## The two annotations that matter

1. **`metadata { folder '<path>' }`** on an element makes it a *module* mapped to
   a source folder, relative to the repo root (e.g. `src/domain`). Elements
   **without** it are ignored — keep actors, external systems, and notes in the
   diagram freely; they never participate in enforcement.
   - **`metadata { file '<path>' }`** maps an element to a *single file* instead.
     Use it for a guarded contract or port that lives beside sibling sub-folders
     in a deep nested diagram: as a file leaf it stays a sibling, so its edges
     are sibling-to-sibling and the model is legal in LikeC4 (which rejects an
     ancestor↔descendant edge). A file module owns exactly its file; a folder
     module owns its subtree minus any mapped descendants (nested folders and
     file leaves alike). Declare `folder` or `file`, never both.

2. **A relationship `a -> b`** declares that `a` may depend on `b`. It is a
   directional allow-list. `a -> b` does **not** permit `b -> a`.

3. **`#anything`** on an element makes it a *wildcard*: a box that maps to no
   folder and stands for "the rest of the code". A module with an edge into it
   is exempt from every rule. This exists for the composition root, which must
   import everything to wire it together. See below — you do not add these.

## Rules Boundry applies

- A module may import its own folder and any folder it has an edge to. Every
  other module folder is forbidden.
- Imports into non-module paths (`node_modules`, unmapped folders) are never
  constrained — Boundry only governs edges between folders you mapped.
- One element maps to exactly one path — a folder or a single file.
- **A repo may declare a govern root** — `metadata { governRoot 'src' }` on a
  top element. Then the whole tree is governed: importing anything under the
  root that no module claims is a **violation**, and `check` warns about code no
  module covers. Without it, unmapped folders are ignored (the default).
- **Files may be exempt as importers.** `metadata { exemptImporters '<regex>' }`
  drops matched files from every rule's `from` side — for test files that wire
  real adapters across layers, and ambient `.d.ts` declarations. From-side only:
  they stay governed as import *targets*. Backslashes must be doubled (`'\\.d\\.ts$'`)
  because LikeC4 processes string escapes.
- **A wildcard exempts one module, not the diagram.** Only the source of the
  `-> anything` edge goes unconstrained; every other module is governed exactly
  as before. Nothing may import a wildcard's *source* more freely either.
- **Nesting is supported.** You may map a parent folder *and* its children. A
  module owns its folder minus its mapped children, so a parent's edges govern
  only the parent's own files — **a child never inherits them** and must be
  permitted explicitly. A connection between two subtrees never permits every
  child pair across them.

## Template

```likec4
specification {
  element module {
    style { shape rectangle }
  }
  // Required to propose changes. Colours both boxes and edges that carry the
  // marker — declared once, no per-element styling.
  tag proposed {
    color #f59e0b
  }
  // Proposes a removal: colours the edge/box red; approve removes it outright.
  tag proposal-delete {
    color #ef4444
  }
  // Marks a wildcard box. Reserved for the composition root.
  tag anything {
    color #64748b
  }
}

model {
  module domain 'Domain' {
    metadata { folder 'src/domain' }
  }
  module infra 'Infrastructure' {
    metadata { folder 'src/infra' }
  }
  module api 'API' {
    metadata { folder 'src/api' }
  }

  // Allowed dependencies. Anything not drawn is forbidden.
  infra -> domain
  api -> domain
  api -> infra
}

views {
  view index { include * }
}
```

`domain` may depend on nothing but itself; `infra` and `api` may depend on
`domain`. So `domain -> infra` fails the check, while `infra -> domain` passes.

## The composition root

A repo has one place that legitimately imports everything: the entry point that
constructs the object graph. Give it a module and wire it to a wildcard:

```likec4
  // Owns 'src' minus every mapped descendant — the loose files at the root.
  module entry 'Composition root' {
    metadata { folder 'src' }
  }
  element anything 'Anything' {
    #anything
  }

  entry -> anything
```

Under a `governRoot` this is what keeps `src/index.ts` legal without leaving it
unmapped. That distinction is the whole point: an unmapped folder would get the
same freedom by *omission* — nothing drawn, nothing to review. The wildcard makes
the exemption a visible, coloured box someone approved on purpose.

## Proposing a change — read this before touching the diagram

**A boundary violation is not a diagram bug.** When `boundry check` blocks you,
the boundary is usually right and the code is wrong. Prefer fixing the code —
route through the permitted module, use the port, move the logic.

If the dependency is genuinely warranted, **propose** it. Add the edge **with
the marker** — one token, no styling:

```likec4
  domain -> shared #proposed
```

If the change also needs a new module, mark that too, so a reviewer sees the new
box as well as the new arrow:

```likec4
  module shared 'Shared Kernel' {
    #proposed
    metadata { folder 'src/shared' }
  }
```

The `proposed` tag colours both, so the reviewer sees exactly what you are asking
for.

Note the two markers mean different things. On an **edge** it is semantic: the
edge is excluded from the allow-list until approved. On an **element** it is
only a signal — the module is enforced from the moment you draw it, which is
safe, because a new module grants nothing until an edge permits it. **The edge
is always the only grant.**

**Proposing does not unblock you.** A `#proposed` edge is intent, not
permission: it is excluded from the allow-list, so `boundry check` still fails
until a human approves. That is correct — say the check is still red and that
the proposal is awaiting approval, and stop there.

### Proposing a removal — `#proposal-delete`

To retire an edge or a module, do not delete it — **propose** its removal by
tagging it `#proposal-delete`. The tag colours it red, and a human's `approve`
removes the edge or box outright (where `#proposed` only strips its own marker
and leaves the edge behind).

```likec4
  module legacy 'Legacy' {
    #proposal-delete
    metadata { folder 'src/legacy' }
  }

  api -> legacy #proposal-delete
```

A pending deletion **changes nothing**: the edge stays allowed and the box stays
enforced until approved, so proposing a removal never breaks the build. If you
mark a box for deletion, mark every edge touching it too — approving removes the
box, and an edge left pointing at a deleted box makes the diagram invalid.

### Never do these

- **Never add a bare (unmarked) edge** to make a check pass. That grants
  yourself a dependency. `boundry verify` compares against the accepted
  `boundry.lock` and rejects any edge granted without a marker — and
  `boundry approve` refuses to launder it.
- **Never remove or edit an existing `#proposed` marker.** Stripping the marker
  *is* the approval, and approval is a human act.
- **Never delete an edge or a box, or strip a `#proposal-delete` marker.**
  Removing an edge changes the approved architecture; removing a box unmaps its
  folder, which *loosens* enforcement. To retire either, tag it
  `#proposal-delete` and stop — enacting the removal is the human's `approve`.
- **Never run `boundry approve`.** That command is the human's.
- **Never widen an edge to dodge a violation** (e.g. mapping a coarser folder,
  or deleting a module so its rules vanish).
- **Never add or widen an `exemptImporters` pattern.** It lifts whole files out
  of every rule, so it is a grant — and unlike an edge, it cannot be proposed. A
  human adds it to the diagram or nobody does. Widening one to swallow the file
  you're blocked on is the bypass wearing a lab coat; `boundry verify` reports it
  as a self-grant.
- **Never draw an `#anything` wildcard, and never add an edge into an existing
  one.** It switches enforcement off for the module it touches, which is the
  largest grant in the language. A repo needs one, for the composition root, and
  a human decides that. If you believe your module needs it, propose the specific
  edge you actually want instead — `boundry verify` reports a wildcard edge as
  self-approved like any other.
- **Never hand-edit `boundry.diff.likec4`.** It is a derived review artifact that
  `boundry diff` overwrites from the diagram's markers. Edit `architecture.likec4`
  and regenerate; changes made in the diff file are lost and enforce nothing.
- **Never hand-add a `style { color … }` to a marked edge or box.** Add the marker
  only; `boundry annotate` paints the amber/red styling deterministically and
  `boundry approve` strips it back out. Hand-styling either drifts from that
  convention or survives approval as a permanent colour.
- **Never route around a boundary through a new folder.** Creating
  `src/shared-utils/` and importing it, so the blocked dependency travels via
  unmodelled code, is the same bypass wearing a disguise. Where a `governRoot`
  is declared this fails outright; where it is not, it is still dishonest —
  model the folder and propose the edge instead.

## Checklist

- [ ] Every folder you want governed has an element with `metadata { folder '…' }`.
- [ ] Folder paths are relative to the repo root, not the diagram file.
- [ ] Every legitimate cross-folder import is drawn, in the right direction.
- [ ] No edge exists that you do not actually want to permit.
- [ ] Every edge you added in this change carries `#proposed`.
- [ ] You added no `#anything` box and no edge into one.
- [ ] You added or widened no `exemptImporters` pattern.
- [ ] You deleted nothing directly — removals are tagged `#proposal-delete`.

## Running it

```bash
boundry check   --arch <dir> [--cwd <repo>] src   # run the linter; exit 1 on any violation
boundry generate --arch <dir>                     # emit the dependency-cruiser config
boundry verify  --arch <dir>                       # reject edges granted without #proposed (vs boundry.lock)
boundry approve --arch <dir>                        # HUMAN ONLY: strip markers = approve, update boundry.lock
boundry diff    --arch <dir>                       # write per-layer review views of what you proposed
```

`--arch` is the LikeC4 workspace directory (all `.likec4` files in it are
merged). `--cwd` is the repo root the `folder` paths resolve against. `verify`
compares the diagram against the accepted `boundry.lock` — the baseline `approve`
records — so it needs no git ref.

The lifecycle is: **propose** (`#proposed`, check still red) → **approve** (a
human strips the marker; the edge joins the allow-list) → **commit** (git).
