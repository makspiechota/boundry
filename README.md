# Boundry

**Compile a C4 architecture diagram into a deterministic dependency linter.**

You draw the allowed architecture once, as a [LikeC4](https://likec4.dev) diagram.
Boundry turns it into a [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
ruleset and checks your code against it — locally and in CI. No model calls, no
heuristics, no judgement: the architecture you drew *is* the linter.

It's built for a world where AI agents write most of the code. Review doesn't
scale and LLM-judge supervisors are non-deterministic; Boundry gives agents a
hard boundary they can't cross instead of a suggestion they might.

```
diagram (LikeC4)  ──►  boundary model  ──►  dependency-cruiser rules  ──►  ✓ / ✗
     you draw            source-agnostic         generated                 the gate
```

## How it works

1. You annotate each element in your diagram with the folder it owns:
   `metadata { folder 'src/domain' }`.
2. Every relationship you draw (`a -> b`) is an **allowed** dependency.
   Anything you don't draw is **forbidden**.
3. Boundry lifts the diagram into a source-agnostic boundary model, compiles a
   dependency-cruiser ruleset from it, and runs the linter over your code.

Elements without a `folder` (actors, external systems, notes) are ignored, so a
rich communication diagram and an enforcement diagram can be the same file.

### Governing a whole root (opt-in)

By default a folder no element maps to is *ignored* — any module may import it.
That is what keeps a communication diagram usable as an enforcement diagram, but
it means brand-new, unmodelled code is free to import. Declare a root as fully
governed and the whole tree becomes the universe instead:

```likec4
system app 'App' {
  metadata { governRoot 'src' }
}
```

Now importing anything under `src/` that no module claims is a **violation**, and
`check` **warns** about code under the root that no module covers. That is the
mirror of the zero-files warning: the model failing to cover the code is as much
a gap as the code failing to back the model. Nothing changes unless you declare
it.

## See it

The diagram you draw *is* the whole spec. Below is the example architecture that
Boundry's own end-to-end suite enforces — a hexagonal model with a pure DDD
core, CQRS, and a public-API boundary.

**[Explore every view interactively →](https://makspiechota.github.io/boundry/)**

### Top-level layers

![Top-level layers: entry point, domain, application, infrastructure](docs/diagrams/example-overview.png)

### Inside the domain — the rules are what's *not* drawn

Aggregates compose Entities and hold Value Objects; Entities may reach Value
Objects but never Aggregates; Value Objects import nothing. Every missing arrow
is a forbidden dependency Boundry will reject.

![Domain internals: aggregates, entities, value objects](docs/diagrams/example-domain.png)

## Install

```bash
npm install --save-dev boundry
```

Requires Node 20+. `likec4` and `dependency-cruiser` come along as dependencies.

## Quickstart

Draw your architecture — `arch/architecture.likec4`:

```likec4
specification {
  element module { style { shape rectangle } }
}

model {
  module domain 'Domain' {
    metadata { folder 'src/domain' }
  }
  module infra 'Infrastructure' {
    metadata { folder 'src/infra' }
  }

  // Allowed dependency. Everything not drawn is forbidden.
  infra -> domain
}

views {
  view index { include * }
}
```

Check your code against it:

```bash
npx boundry check --arch arch src
# ✓ no boundary violations                          (exit 0)
# ✗ src/domain/user.ts → src/infra/db.ts [boundary-domain]   (exit 1)
```

A `domain → infra` import is now a build failure; `infra → domain` is fine.

## CLI

```
boundry check    [--arch <dir>] [--cwd <dir>] [sources...]
boundry generate [--arch <dir>] [--cwd <dir>] [--out <file>]
```

| Flag | Meaning |
| --- | --- |
| `--arch <dir>` | LikeC4 workspace directory (all `.likec4` files in it are merged). Default `.`. |
| `--cwd <dir>` | Repo root to check. `folder` paths are relative to it. Lets you run from anywhere. |
| `--out <file>` | `generate` only: where to write the dependency-cruiser config. Default `.dependency-cruiser.cjs`. |
| `sources...` | `check` only: paths to lint. Default `src`. |

- **`check`** compiles the rules and runs the linter. Exits non-zero on any violation.
- **`generate`** just emits the dependency-cruiser config so you can commit it or
  run `depcruise` yourself.

Boundry warns (but does not fail) when a mapped folder matches **zero** files —
so a passing check can never silently enforce nothing.

## CI

```yaml
# .github/workflows/architecture.yml
name: architecture
on: [push, pull_request]
jobs:
  boundry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx boundry check --arch arch src
```

## Programmatic use (SDK)

The CLI is a thin wrapper over the SDK. Everything is pluggable — the diagram
source and the target linter are both adapters behind ports.

```ts
import { Pipeline, LikeC4Visualizer, DepCruiserEnforcer } from 'boundry';

const pipeline = new Pipeline(
  new LikeC4Visualizer('arch'),
  new DepCruiserEnforcer(),
);

const result = await pipeline.check(['src']);
if (!result.ok) {
  for (const v of result.violations) console.error(`${v.from} → ${v.to}`);
  process.exit(1);
}
```

## Status & scope

Early but real — Boundry enforces its own architecture on itself, and ships an
end-to-end test suite covering a hexagonal + CQRS + DDD model (pure domain core,
read/write separation, a public-API boundary).

Today: **TypeScript** via dependency-cruiser, **LikeC4** as the diagram source.
Both are adapters, so more languages/linters and diagram formats can plug in
without touching the core.

Current limitations:

- One element maps to exactly one folder.
- Nesting is supported: you can map a parent folder *and* its children. A
  parent's edges govern only the parent's own files — a child never inherits
  them and must be permitted explicitly.
- `folder` paths are relative to the repo root (`--cwd`), not the diagram file.

## License

[MIT](./LICENSE) © Maksymilian Piechota
