---
name: define-architecture-boundaries
description: How to annotate a LikeC4 diagram so Boundry compiles it into deterministic dependency-linter rules. Use when creating or editing an architecture that Boundry will enforce over a codebase.
---

# Defining architecture boundaries for Boundry

Boundry reads a LikeC4 diagram and generates a dependency linter from it. The
diagram is the source of truth; the code is checked against it. Your job when
defining or editing that diagram is to express two things: **which folders are
modules** and **which dependencies between them are allowed**. Everything you do
not draw is forbidden.

## The two annotations that matter

1. **`metadata { folder '<path>' }`** on an element makes it a *module* mapped to
   a source folder. The path is a prefix relative to the repo root where
   `boundry check` runs (e.g. `src/domain`). Elements **without** this metadata
   are ignored — keep actors, external systems, and ports in the diagram freely;
   they never participate in enforcement.

2. **A relationship `a -> b`** declares that `a` may depend on `b`. It is a
   directional allow-list. `a -> b` does **not** permit `b -> a`.

## Rules Boundry applies

- A module may import its own folder and any folder it has an edge to. Every
  other module folder is forbidden.
- Imports into non-module paths (`node_modules`, unmapped folders) are never
  constrained — Boundry only governs edges between folders you mapped.
- One element maps to exactly one folder. Split a concern into multiple modules
  if it owns multiple folders.

## Template

```likec4
specification {
  element module {
    style { shape rectangle }
  }
}

model {
  module domain "Domain" {
    metadata { folder 'src/domain' }
  }
  module infra "Infrastructure" {
    metadata { folder 'src/infra' }
  }
  module api "API" {
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

This says: `domain` may depend on nothing but itself; `infra` and `api` may
depend on `domain`; `api` may also depend on `infra`. So a `domain -> infra`
import fails the check, but an `infra -> domain` import passes.

## Checklist before handing the diagram to Boundry

- [ ] Every folder you want governed has an element with `metadata { folder '…' }`.
- [ ] Folder paths are relative to the repo root, not the diagram file.
- [ ] Every legitimate cross-folder import is drawn as an edge, in the right
      direction.
- [ ] No edge exists that you do not actually want to permit.

## Running it

```bash
boundry generate --arch <dir>       # emit .dependency-cruiser.cjs from the diagram
boundry check   --arch <dir> src    # run the linter; exit 1 on any violation
```

`--arch` is the LikeC4 workspace directory (all `.likec4` files in it are
merged). Run from the repo root so the `folder` prefixes resolve.
