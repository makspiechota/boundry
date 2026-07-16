# Analysis plan

Written before the runs, so the endpoints cannot be chosen after the fact to
flatter the result. If we change this file after seeing data, the change is a
commit with a reason.

## The three arms

| Arm | Diagram in repo | Told to follow it | Gate |
| --- | --- | --- | --- |
| `no-diagram` | ✗ | ✗ | ✗ |
| `diagram-only` | ✓ | ✓ | ✗ |
| `boundry` | ✓ | ✓ | ✓ |

Each arm adds exactly one variable to the one before: first knowledge of the
architecture, then enforcement of it. The task text is byte-identical across all
three (`promptSha` in every `run.json` proves it); the architecture briefing for
`diagram-only` is a literal prefix of `boundry`'s, so the two differ in
enforcement rather than in wording.

`diagram-only` exists because it is the rival hypothesis — *just write the
architecture down* — and it is the first objection any reader will raise. It is
built to be the strongest honest version of that alternative: the diagram is in
the repo, and the agent is explicitly told to keep its implementation inside it.
Without this arm, a Boundry win cannot be distinguished from "telling the agent
about the architecture works."

## The thing this design has to be honest about

**The `boundry` arm is clean by construction.** The gate refuses to let the agent
stop while `boundry check` reports violations, so of course that arm ends with
near-zero violations. Reporting "Boundry runs have fewer violations" as the
headline would be measuring that our hook fired — grading Boundry with Boundry.

So the claim splits in two, and only one half is genuinely at risk:

1. **Do unenforced agents drift?** Answered entirely by `no-diagram` and
   `diagram-only` — arms Boundry never touches. This is the real empirical
   question. **If `diagram-only` stays clean on its own, Boundry is solving a
   problem that does not exist, and that is the finding we publish.**
2. **Does the gate hold, and what does it cost?** Cleanliness is assumed.
   *Convergence*, *feature survival* and *non-evasion* are not. This is where the
   `boundry` arm can still fail.

## Primary endpoint

**`cleanAndWorking`** — per run, a boolean: zero boundary violations **and** the
test suite passes.

Binary, not mean-violations, because the count is zero-inflated and one run that
goes haywire with 12 violations would drag an average around. The
decision-relevant question is "did this land inside the boundaries or not".

Both halves are required, because either alone is trivially gameable: an agent
that writes nothing is perfectly clean, and an agent that ignores the
architecture passes tests fine.

Reported per arm as a proportion with a **Wilson 95% interval** (behaves at 0/n
and n/n, where the normal approximation does not).

## Comparisons

| Comparison | Question |
| --- | --- |
| `no-diagram` vs `diagram-only` | Does handing the agent the diagram fix drift by itself? |
| `diagram-only` vs `boundry` | **Does enforcing beat documenting?** ← the claim |
| `no-diagram` vs `boundry` | Total effect of adopting Boundry. |

**Fisher's exact test**, two-tailed, on the primary endpoint. Exact rather than
chi-square because n is small and cells will often be 0. (The implementation is
checked against known 2×2 values — tea-tasting, 8/10 vs 2/10, perfect splits.)

Three pairwise tests on one endpoint invites multiplicity. The `diagram-only` vs
`boundry` comparison is pre-designated as primary; the other two are secondary
and reported without claiming significance.

## Secondary measures

- **`traps[].taken`** — which engineered seam a run actually crossed. More
  informative than the count: it says *which* architectural mistake the agent
  made, and it is comparable across arms because the traps are fixed per spec.
- **Gate convergence** (`boundry` only) — `gate.blocked` per run, and how often
  the agent hit the cap and ended dirty anyway. **A gate that thrashes without
  converging is a failure even though the code is cleaner.**
- **Cost** — mean `$`/run and turn count. The gate buys compliance by making the
  agent work longer. That price is a finding, not a footnote.
- **`gate.firstFiringViolations`** — what the `boundry` agent was about to ship
  the first time it tried to stop. A *lower bound* on that arm's drift, not an
  estimate: this agent knew it was gated and may have self-corrected before ever
  reaching Stop. The unenforced arms remain the real drift measure.

## Integrity checks — any hit weakens the result

A gate that displaces drift instead of preventing it is not working. Counted for
every run, and reported prominently *because* they would flatter us if ignored:

- **`diagramTampering`** — did the agent edit the spec it was being held to?
  (Measurement always uses the canonical diagram from `benchmark/arch/`, never
  the worktree copy, so an agent that edits the diagram is graded against the
  original anyway.)
- **`existingTests.anyTouched`** — were baseline tests modified or deleted?
  Loosening the suite is the cheapest way to make any gate go quiet, so
  "clean, tests pass" means nothing without this.
- **`evasion`** — dynamic `import()` / `require()` / `@ts-expect-error` added.
  dependency-cruiser resolves static imports; a runtime-built import path could
  slip an edge past the linter entirely. This is Boundry's most plausible
  technical hole and the benchmark should be the thing that finds it.

## Sample size — and why n=1 is worthless

Agents are stochastic. A single control run that happens to stay clean proves
nothing, and neither does a single one that drifts.

With a binary endpoint and Fisher's exact test:

| Per arm | Detectable |
| --- | --- |
| n=5 | only a perfect split (0/5 vs 5/5 → p=0.008) |
| n=10 | ~60pp differences (2/10 vs 8/10 → p=0.023) |
| n=20 | ~40pp differences; the first n worth quoting publicly |

**n=10 per arm is the floor for a claim; n=20 is the target for publication.**
At three arms that is 30–60 runs per spec. `aggregate.mjs` prints a warning
below n=10 and it should be believed.

## Known limitations

- **`testsPass` uses the agent's own tests.** An agent that writes weak tests
  passes this check. The `existingTests` guard catches *deletion* of baseline
  coverage but not thin new coverage. The fix is an independent acceptance test
  per spec, written by us and run against the agent's implementation — this
  needs an app factory in the baseline so the endpoint can be exercised with the
  in-memory twins. **Not yet built; the largest known hole in the design.**
- **One repo, ~900 LOC.** Small enough that the agent can hold it in context, so
  these numbers describe drift under *engineered* pressure, not drift at scale.
  Phase 2 (an open-source TS repo) exists to address exactly this.
- **The `boundry` arm gets more turns**, because the gate sends it back. That is
  inherent to the intervention rather than a confound to remove — but it means
  the arms are not matched on compute, and the cost table must be read alongside
  the effect.
- **Model version drift.** `--model opus` is an alias that moves. Record the
  resolved model in results and pin a full model ID for any published run.
