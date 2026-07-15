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

2. **A relationship `a -> b`** declares that `a` may depend on `b`. It is a
   directional allow-list. `a -> b` does **not** permit `b -> a`.

## Rules Boundry applies

- A module may import its own folder and any folder it has an edge to. Every
  other module folder is forbidden.
- Imports into non-module paths (`node_modules`, unmapped folders) are never
  constrained — Boundry only governs edges between folders you mapped.
- One element maps to exactly one folder.
- **Nesting is supported.** You may map a parent folder *and* its children. A
  module owns its folder minus its mapped children, so a parent's edges govern
  only the parent's own files — **a child never inherits them** and must be
  permitted explicitly. A connection between two subtrees never permits every
  child pair across them.

## Template

```likec4
specification {
  color proposed #f59e0b   // marker colour, so proposals are visible
  element module {
    style { shape rectangle }
  }
  tag proposed             // required to propose changes
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

## Proposing a change — read this before touching the diagram

**A boundary violation is not a diagram bug.** When `boundry check` blocks you,
the boundary is usually right and the code is wrong. Prefer fixing the code —
route through the permitted module, use the port, move the logic.

If the dependency is genuinely warranted, **propose** it. Add the edge **with
the marker**:

```likec4
  domain -> shared {
    #proposed
    style {
      color proposed
      line dashed
    }
  }
```

It renders amber/dashed so a human can see exactly what you are asking for.

**Proposing does not unblock you.** A `#proposed` edge is intent, not
permission: it is excluded from the allow-list, so `boundry check` still fails
until a human approves. That is correct — say the check is still red and that
the proposal is awaiting approval, and stop there.

### Never do these

- **Never add a bare (unmarked) edge** to make a check pass. That grants
  yourself a dependency. `boundry verify --base <ref>` compares against the
  approved architecture and rejects any edge granted without a marker — and
  `boundry approve` refuses to launder it.
- **Never remove or edit an existing `#proposed` marker.** Stripping the marker
  *is* the approval, and approval is a human act.
- **Never run `boundry approve`.** That command is the human's.
- **Never widen an edge to dodge a violation** (e.g. mapping a coarser folder,
  or deleting a module so its rules vanish).

## Checklist

- [ ] Every folder you want governed has an element with `metadata { folder '…' }`.
- [ ] Folder paths are relative to the repo root, not the diagram file.
- [ ] Every legitimate cross-folder import is drawn, in the right direction.
- [ ] No edge exists that you do not actually want to permit.
- [ ] Every edge you added in this change carries `#proposed`.

## Running it

```bash
boundry check   --arch <dir> [--cwd <repo>] src   # run the linter; exit 1 on any violation
boundry generate --arch <dir>                     # emit the dependency-cruiser config
boundry verify  --arch <dir> --base <git-ref>     # reject edges granted without #proposed
boundry approve --arch <dir> --base <git-ref>     # HUMAN ONLY: strip markers = approve
```

`--arch` is the LikeC4 workspace directory (all `.likec4` files in it are
merged). `--cwd` is the repo root the `folder` paths resolve against.

The lifecycle is: **propose** (`#proposed`, check still red) → **approve** (a
human strips the marker; the edge joins the allow-list) → **commit** (git).
