import type { AllowedEdge, BoundaryModel } from '../model/boundary-model.js';

/** A driven port: turns some diagram source into the boundary model. */
export interface VisualizerPort {
  read(): Promise<BoundaryModel>;
  /**
   * Deterministically strip `#proposed` markers from the diagram source,
   * promoting intent edges to approved. Source-preserving; never an LLM edit.
   */
  approve(): Promise<void>;
  /**
   * Deterministically mark the given edges and elements `#proposed` in the
   * source. The inverse of `approve` for additions: it rewrites an undeclared
   * change into an explicit, colourable proposal. Idempotent — anything already
   * marked is left alone. Source-preserving; never an LLM edit.
   */
  propose(edges: AllowedEdge[], moduleIds: string[]): Promise<void>;
  /**
   * Paint intrinsic `style { color … }` on every edge/box carrying a marker, so a
   * proposal is highlighted on every LikeC4 surface — base views and the
   * relationships panel, not only the generated diff views. Amber for `#proposed`,
   * red for `#proposal-delete`. Idempotent; `approve` strips it back out.
   * Source-preserving; never an LLM edit.
   */
  styleMarkers(): Promise<void>;
  /**
   * (Re)generate the review views for the diagram's pending changes — edges and
   * boxes tagged `#proposed` or `#proposal-delete`. By default a single
   * `boundry_diff` landing view draws every change at once, uncollapsed and
   * uniformly highlighted. With `perLayer`, one focused `view … of <scope>` is
   * emitted per layer that draws a change instead. A derived artifact: overwritten
   * each run, and removed when nothing is proposed. Returns one entry per view.
   */
  emitDiffViews(perLayer?: boolean): Promise<DiffView[]>;
}

/**
 * One emitted diff view. For the default single view there is one entry
 * (`boundry_diff`) counting every pending change; in `perLayer` mode there is one
 * per layer, each scoped to an element and counting the changes that fall in it.
 */
export interface DiffView {
  /** The generated view id — `boundry_diff`, or `boundry_diff_<scope>` per layer. */
  id: string;
  /** perLayer only: the scope element's fqn, or undefined for the model root. */
  scope?: string;
  /** How many pending `#proposed` / `#proposal-delete` changes this view holds. */
  changes: number;
}

/** A generated linter config artifact. */
export interface EnforcerConfig {
  filename: string;
  content: string;
}

/** A single boundary violation found by an enforcer. */
export interface Violation {
  from: string;
  to: string;
  rule: string;
}

export interface CheckResult {
  ok: boolean;
  violations: Violation[];
  /** Non-fatal problems, e.g. a mapped folder that matched no source files. */
  warnings: string[];
}

/**
 * A driven port: renders the boundary model into a target linter's native
 * config, and runs that linter against source.
 */
export interface EnforcerPort {
  render(model: BoundaryModel): EnforcerConfig;
  check(model: BoundaryModel, sources: string[]): Promise<CheckResult>;
}
