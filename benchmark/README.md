# Architecture Integrity Benchmark

A controlled experiment measuring whether Boundry keeps agent-written code inside
the drawn architecture.

The same agent implements the same spec against the same repo, from the same
commit, under three arms:

| Arm | What it gets |
| --- | --- |
| **no-diagram** | The repo as it is — CLAUDE.md's conventions and nothing else. The natural drift rate. |
| **diagram-only** | The architecture diagram is in the repo and the agent is told to follow it. No gate. |
| **boundry** | Same diagram, plus a Boundry gate that blocks the agent's turn while violations remain. |

Each arm adds exactly one variable to the one before: first knowledge of the
architecture, then enforcement of it. Same model, same baseline commit, same task
text, same tool allowlist throughout.

`diagram-only` is the arm that earns the study. It is the rival hypothesis —
*just write the architecture down* — and without it, a Boundry win cannot be told
apart from "telling the agent about the architecture works."

**The `boundry` arm is clean by construction** — the gate will not let it stop
otherwise — so its cleanliness is not the finding. The load-bearing evidence is
the drift rate of the two *unenforced* arms, plus whether the gate converges
without breaking the feature or being evaded. [`ANALYSIS.md`](./ANALYSIS.md) is
the pre-registered plan and explains what these numbers can and cannot support.

## Why this design

promo-shop is small (~900 LOC of backend source). An agent can hold most of it in
context, so it will not drift from scale alone — which means **the architectural
pressure has to be engineered into the specs, not the repo**. Each spec is
written as a plain product requirement that says nothing about layering, and is
paired with a `*.pressure.json` documenting the seams it is built to tempt and
the legal path that exists for each. If a spec's traps had no clean alternative,
we would be measuring impossibility rather than drift.

## Layout

```
baseline.json                    pinned repo + commit every run starts from
arch/promo-shop.likec4           the enforced architecture (folder-mapped, import-direction)
specs/NN-*.md                    the shared task text — pure product language
specs/NN-*.pressure.json         the traps each spec engineers, and the legal path out
runner/run.mjs                   worktree per run, both arms, capture diff + transcript
runner/boundry-gate.mjs          the treatment: a Stop hook that blocks on violations
metrics/measure.mjs              deterministic drift metrics for one run
results/<spec>/<arm>/run-NN/     metrics.json, changes.patch, tests.txt, gate.jsonl
```

## The reference repo

Phase 1 uses the existing **promo-shop backend** — TypeScript, hexagonal/DDD,
four bounded contexts (cart, catalog, inventory, checkout) plus infra and routes.
Ready-made, cleanly mappable boundaries. Backend only; the React frontend is out
of scope. Phase 2 will repeat the study on a well-known open-source TS repo for
independent credibility.

`arch/promo-shop.likec4` is deliberately **not** promo-shop's own
`docs/c4/promo-shop.likec4`. That one is a communication diagram: its elements
are single files and its edges point port → adapter, the reverse of the import
direction Boundry enforces.

### The baseline

`baseline.json` pins promo-shop at `253bf84`, the first commit where
`boundry check` is green against the diagram. Reaching it took one fix: the
`AuditLog` interface lived in `infra/` next to its Postgres implementation, so
`checkout-service.ts` had to import from infra to see it — the domain depending
outward on infrastructure. The port now lives in `domain/checkout/audit-log.ts`.

That fix mattered for validity, not tidiness: "the domain importing an infra
client" is one of the seams the specs push on, and it cannot be a measurement
target if the baseline already violates it.

## Running

```bash
# one run of each arm — a smoke test of the design, not a result
node benchmark/runner/run.mjs --spec 01-order-history --arm all --model opus

# then read the comparison
node benchmark/metrics/aggregate.mjs --spec 01-order-history
```

| Flag | Meaning |
| --- | --- |
| `--spec <id>` | Spec to run (default `01-order-history`). |
| `--arm all\|<name>[,<name>]` | Which arm(s): `no-diagram`, `diagram-only`, `boundry`. Default `all`. |
| `--model <alias>` | Model under test. Default `opus`. |
| `--runs <n>` | Repetitions per arm — agents are stochastic; n=1 is an anecdote. |
| `--budget <usd>` | Per-run spend cap. |
| `--keep` | Keep the worktrees for inspection. |

Each run gets a detached `git worktree` at the pinned SHA, with `node_modules`
symlinked in (deps are identical at baseline, so linking beats `npm ci` per run).
The agent runs under a scoped tool allowlist — read, edit, and run tests — not a
permission bypass. Both arms get the identical allowlist.

## Metrics

Counted, never judged. No model calls (`metrics/measure.mjs`):

| Metric | Meaning |
| --- | --- |
| `cleanAndWorking` | **Primary endpoint.** Zero violations *and* tests pass. Either half alone is gameable. |
| `violationCount` | Imports crossing a boundary the diagram does not draw. |
| `forbiddenEdges` | The distinct architectural edges introduced, e.g. `domain.checkout->domain.catalog`. |
| `traps[].taken` | Which of the spec's engineered traps this run fell into. |
| `gate.blocked` / `gate.converged` | `boundry` arm: how many times Boundry pushed back, and whether the agent ever got clean. |
| `diagramTampering` | Whether the agent edited the diagram it was being held to. |
| `existingTests.anyTouched` | Whether baseline tests were modified or deleted to make things pass. |
| `evasion` | Dynamic `import()`/`require()`/`@ts-expect-error` added — routes around a static-import linter. |
| `cost`, `turns` | What each arm spent. The gate buys compliance with extra work; that price is a finding. |

Measurement always uses the **canonical** diagram from this directory, never the
copy in the worktree — otherwise an agent that edited the diagram would be graded
against its own edit.

## Reading a result

`aggregate.mjs` prints the primary endpoint per arm with Wilson 95% intervals,
trap-by-trap breakdowns, the integrity checks, and pairwise Fisher exact tests.

The comparison that carries the argument is **`diagram-only` vs `boundry`**:
documenting versus enforcing. `no-diagram` establishes that drift exists at all.

Read [`ANALYSIS.md`](./ANALYSIS.md) before quoting any number from this
directory. In particular: n=1 is an anecdote (n≥10/arm is the floor for a claim),
and a clean `boundry` arm is expected by construction rather than evidence.
