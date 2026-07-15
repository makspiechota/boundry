# Architecture Integrity Benchmark

A controlled experiment measuring whether Boundry keeps agent-written code inside
the drawn architecture.

The same agent implements the same spec against the same repo, from the same
commit, twice:

| Arm | What it gets |
| --- | --- |
| **control** | The repo as it is. No diagram, no gate. |
| **treatment** | Same repo, same prompt — plus the drawn architecture and a Boundry gate that blocks the agent's turn while violations remain. |

The arms differ in exactly one variable: whether Boundry is in the loop. Same
model, same baseline commit, same task text, same tool allowlist.

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
node benchmark/runner/run.mjs --spec 01-order-history --arm both --model opus
```

| Flag | Meaning |
| --- | --- |
| `--spec <id>` | Spec to run (default `01-order-history`). |
| `--arm control\|treatment\|both` | Which arm(s). Default `both`. |
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
| `violationCount` | Imports crossing a boundary the diagram does not draw. |
| `forbiddenEdges` | The distinct architectural edges introduced, e.g. `domain.checkout->domain.catalog`. |
| `traps[].taken` | Which of the spec's engineered traps this run fell into. |
| `testsPass` | Whether the agent's own feature actually works — drift only counts if it does. |
| `diagramTampering` | Whether the agent edited the diagram it was being held to. |
| `gate.blocked` | Treatment only: how many times Boundry pushed the agent back. |
| `diff` | Files changed and lines added/removed. |

Measurement always uses the **canonical** diagram from this directory, never the
copy in the worktree — otherwise an agent that edited the diagram would be graded
against its own edit.

## Reading a result

The headline comparison is `traps[].taken` and `forbiddenEdges` between arms, on
runs where `testsPass` is true. A treatment run with `gate.blocked > 0` and a
clean final state is the core claim in miniature: the agent *did* reach for the
shortcut, and the gate turned it back.

Caveats worth keeping honest: n=1 proves nothing (agents are stochastic — use
`--runs`), and a treatment agent also *sees* the diagram, so the arms differ by
"Boundry in the loop", not by the gate alone.
