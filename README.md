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

1. You annotate each element in your diagram with the source it owns — a folder,
   `metadata { folder 'src/domain' }`, or a single file,
   `metadata { file 'src/ports/contract.ts' }`.
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

A mapped folder claims its **entire subtree**, so the abstraction level stays
yours: one box on `src/domain` covers everything beneath it. You add finer boxes
where you want finer *rules*, not to satisfy the coverage check.

### Mapping a single file (deep nested diagrams)

A rich C4 model nests: `application` › `metrics` › `ports` › `story-points-read`
› `stub`, with a drill-down view at each level. Sometimes a *file* is the guarded
thing — a contract, a port, a single repository — sitting beside its sibling
sub-folders. Map it to a file instead of a folder:

```likec4
component ports 'ports' {
  metadata { folder 'src/ports' }

  component store 'in-memory-store' {
    metadata { file 'src/ports/in-memory-store.ts' }   // a leaf, not a folder
  }
  component read 'story-points-read' {
    metadata { folder 'src/ports/story-points-read' }
    component stub 'stub' {
      metadata { folder 'src/ports/story-points-read/stub' }
    }
  }
}

stub -> store   // a legal cross-subtree edge
```

This is what lets a deep tree be **both** the documentation and the enforcement
model. Collapse that file into its parent folder and the edge becomes
`stub -> ports` — a descendant importing its ancestor, which LikeC4 rejects with
`Invalid parent-child relationship`. As a file leaf, `store` is a sibling, so the
edge is legal *and* Boundry governs the file exactly: only `stub` may import it,
and the surrounding `ports` folder no longer owns it.

A file module owns exactly its file; a folder module owns its subtree minus any
mapped descendants — nested folders and file leaves alike.

### Exempting test files and ambient declarations

Every file under a mapped folder is governed as a rule *source* by default —
including tests. An integration test that wires a real database adapter across a
layer boundary is doing its job, not breaking the architecture. Exempt them:

```likec4
system app 'App' {
  metadata {
    exemptImporters '/__tests__/|\\.d\\.ts$'
  }
}
```

Matched files are still analysed, but they are dropped from every rule's `from`
side, so they may import anything. This is **from-side only** — they stay
governed as import *targets*, so production reaching into a test helper is as
forbidden as it ever was. Patterns are regexes, union across every element that
declares one, and change nothing unless you declare one.

> **Double your backslashes.** LikeC4 processes string escapes, so `'\.d\.ts$'`
> arrives as `.d.ts$`, where `.` is a wildcard that matches far more than you
> meant. Write `'\\.d\\.ts$'`. Boundry warns when an exemption matches **zero**
> files, or when one matches **every** file, since both mean the pattern is
> wrong.

An exemption is a grant — it lifts whole files out of every rule — so `verify`
reports one added since the approved base, exactly like an undrawn edge.

### The composition root — `#anything`

Every repo has one place that legitimately imports everything: the entry point
that constructs the object graph. Give it a module and wire it to a wildcard:

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

A box tagged `#anything` maps to no folder and stands for "the rest of the code".
A module with an edge into it is exempt from every rule — and only that module;
the exemption doesn't leak.

The alternative was to leave `src/index.ts` unmapped, which grants it the same
freedom by **omission**: nothing drawn, nothing to review. The wildcard makes the
exemption a visible box someone approved on purpose.

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

## Changing the architecture — propose, approve, commit

If agents can edit the diagram, they can grant themselves any dependency they
like, and the guardrail is theatre. So a change to the architecture goes through
a lifecycle:

**propose** → **approve** → **commit**

An agent blocked by a boundary adds the edge **with a marker**:

```likec4
  domain -> shared #proposed
```

A `#proposed` edge is *intent, not permission*. It's excluded from the allow-list,
so `check` stays red and the agent stays blocked. It has asked, not taken.

A human approves by stripping the marker — that's what `boundry approve` does,
deterministically, by splicing the LikeC4 CST. No model call, no reformatting:
source-preserving, idempotent, byte-exact.

```bash
boundry verify  --arch arch   # any edge granted without a marker, vs the lock?
boundry approve --arch arch   # HUMAN ONLY: strip markers = approve, update the lock
```

`verify` compares the working diagram against the accepted **`boundry.lock`** and
rejects edges that appeared *without* going through a proposal. Because proposals
are excluded from the allow-list, the newly-allowed set is exactly the set of
self-approvals — no diff engine required. `approve` runs the same gate first, so
it won't launder a self-granted edge into an approved one; then it enacts the
proposals and records the new accepted state to the lock.

The baseline is the lock, not a git ref: it's the state Boundry *owns*, so
"accepted" never collapses into merely "committed". (One consequence, by design:
the gate leans on `approve` being a human act — the lock moves only when someone
approves. That's why the skill forbids agents from running it.)

**To retire an edge or a box, propose its removal** with `#proposal-delete`
instead of deleting it. The marker colours it red; a pending deletion changes
nothing (the edge stays allowed, the box stays enforced) so it never breaks the
build. Then `approve` removes the marked edge or box outright:

```likec4
  module legacy 'Legacy' {
    #proposal-delete
    metadata { folder 'src/legacy' }
  }
  api -> legacy #proposal-delete
```

So `#proposed` and `#proposal-delete` are the two halves of a change — an amber
addition that `approve` makes permanent, and a red removal that `approve` takes
away — each a visible mark on the diagram until a human acts.

Point your agents at
[`.claude/skills/define-architecture-boundaries`](.claude/skills/define-architecture-boundaries/SKILL.md)
and they'll follow this protocol.

### Catching drift — `annotate` (prototype)

`verify` catches a self-grant and fails; `annotate` is the other half — it
*rewrites* the same drift into a reviewable proposal. Both read the same baseline,
the accepted **`boundry.lock`** that `approve` records beside the diagram, so they
can never disagree about what "accepted" means.

```bash
boundry approve  --arch arch          # enact proposals AND write boundry.lock
boundry annotate --arch arch          # rewrite undeclared additions as #proposed
```

`annotate` finds every edge or box that drifted past the lock without a marker —
a self-grant — and rewrites it in place as a `#proposed` proposal. That's not
cosmetic: a `#proposed` edge leaves the allow-list, so the silent grant becomes a
red-again check and a highlighted box on the diagram, awaiting a real approval. It
handles additions only; a removal is reported, not re-drawn (re-adding a deleted
box would resurrect it as an enforced module).

It also **paints the markers** — every `#proposed` edge/box gets an intrinsic
`style { color amber }`, every `#proposal-delete` a `style { color red }`, written
onto the element itself. Intrinsic style is the one styling LikeC4 renders on
*every* surface — base views **and the "relationships of X" panel** — so a
proposal shows up highlighted wherever a reviewer looks, not only in the generated
diff views (whose view-scoped rules stop at the view boundary). `approve` strips
this styling back out with the marker: a `#proposed` edge returns to bare, a
`#proposed` box stays but loses its colour, a `#proposal-delete` is removed
outright. Requires **LikeC4 ≥ 1.58** to render.

### Reviewing a proposal — the diff view (prototype)

`diff` generates a single **proposed-changes** view — every pending change on one
landing — into a derived `boundry.diff.likec4`:

```bash
boundry diff --arch arch              # (re)write boundry.diff.likec4
likec4 serve arch                     # open 'Boundry diff — proposed changes'
```

The highlighting is **generated, not hand-styled** — `diff` emits the LikeC4
rules into the derived file, so every `#proposed` box fills amber and edge goes
amber + solid, every `#proposal-delete` red, deterministically. That closes the
last manual seam: `annotate` marks, `diff` colours, no agent-dependent styling
step. Unchanged elements keep their defaults, and the rules live only in the
generated view, so your own views are untouched.

The view uses `include * -> * where tag is #proposed` (no bare `include *`), so it
pulls in exactly the proposed edges and the leaf modules they touch — a
deeply-nested proposal renders as its **own coloured node** instead of collapsing
into a grey ancestor. A proposed *module* with no edge yet is included too, so a
proposed-but-unwired box still shows. Each change nests under its layer/system for
context.

For a small change you can ask for the old per-layer shape instead — one focused
`view … of <scope>` for every layer that draws a change:

```bash
boundry diff --arch arch --per-layer
```

The file is a **derived artifact**: overwritten every run, removed when nothing is
proposed, so it always matches the current diagram. `approve` deletes it too, as
part of enacting — the moment the last proposal is approved the view is stale, so
the post-approve workspace validates clean. It reads the diagram's own markers
(not the lock), so it frames whatever `annotate` or a human has marked. Being
derived, it's a `.gitignore` candidate (`boundry.diff.likec4`).

> Rendering the coloured diff views needs **LikeC4 ≥ 1.58** (the style-rule syntax
> Boundry emits). Boundry itself depends on that floor; the tool you review with
> (`likec4 serve`, the CLI, or the IDE extension) has to meet it too.

## CLI

```
boundry check    [--arch <dir>] [--cwd <dir>] [sources...]
boundry generate [--arch <dir>] [--cwd <dir>] [--out <file>]
boundry verify   [--arch <dir>] [--cwd <dir>]
boundry approve  [--arch <dir>] [--cwd <dir>]
boundry annotate [--arch <dir>]
boundry diff     [--arch <dir>] [--per-layer]
```

| Flag | Meaning |
| --- | --- |
| `--arch <dir>` | LikeC4 workspace directory (all `.likec4` files in it are merged). Default `.`. |
| `--cwd <dir>` | Repo root to check. `folder` paths are relative to it. Lets you run from anywhere. |
| `--out <file>` | `generate` only: where to write the dependency-cruiser config. Default `.dependency-cruiser.cjs`. |
| `--per-layer` | `diff` only: emit one focused view per layer instead of the single proposed-changes view. |
| `sources...` | `check` only: paths to lint. Default `src`. |

- **`check`** compiles the rules and runs the linter. Exits non-zero on any violation.
- **`generate`** just emits the dependency-cruiser config so you can commit it or
  run `depcruise` yourself.
- **`verify`** rejects dependencies granted without a proposal, comparing the
  diagram against the accepted `boundry.lock`. Needs a lock — run `approve` once
  to record one.
- **`approve`** runs the same gate, then enacts markers (strips `#proposed`,
  removes `#proposal-delete`) and writes `boundry.lock`. For humans, not agents.
- **`annotate`** rewrites undeclared additions as `#proposed`, diffing against
  `boundry.lock`.
- **`diff`** generates a single colour-coded "proposed changes" review view into a
  derived `boundry.diff.likec4` (or, with `--per-layer`, one focused view per layer
  that draws a change).

Boundry warns (but does not fail) when a mapped folder matches **zero** files, and
**fails outright** when a check analysed no files at all — so a passing check can
never silently enforce nothing. A guardrail that fails open is worse than none.

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
      # Reject any dependency granted without a proposal, vs the committed lock.
      - run: npx boundry verify --arch arch
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

- One element maps to exactly one path — a folder or a single file.
- Nesting is supported: you can map a parent folder *and* its children. A
  parent's edges govern only the parent's own files — a child never inherits
  them and must be permitted explicitly.
- `folder` paths are relative to the repo root (`--cwd`), not the diagram file.
- With a `governRoot`, unmapped code is blocked as an import *target* but is not
  yet constrained as an *importer* — rules are generated per mapped module, so
  unmapped code has no rules of its own.

See the [changelog](./CHANGELOG.md) for what's in each release.
**`0.1.0` is deprecated** — it silently enforces nothing (see the changelog).

## License

[MIT](./LICENSE) © Maksymilian Piechota
