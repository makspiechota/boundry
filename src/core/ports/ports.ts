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
   * (Re)generate a focused diff view for every layer that holds a pending
   * change — an edge or box tagged `#proposed` or `#proposal-delete`. Each view
   * is scoped to the tightest element that contains the change (the model root
   * for a top-level one), because a proposal nested inside a box is invisible
   * once that box collapses at a wider scope. A derived artifact: overwritten
   * each run, and removed when nothing is proposed. Returns one entry per view.
   */
  emitDiffViews(): Promise<DiffView[]>;
}

/**
 * One emitted diff view: a single layer (element scope) that holds at least one
 * pending change, and how many changes fall in it.
 */
export interface DiffView {
  /** The generated view id, e.g. `boundry_diff_root` or `boundry_diff_billing`. */
  id: string;
  /** The scope element's fqn, or undefined for the model root. */
  scope?: string;
  /** How many pending `#proposed` / `#proposal-delete` changes this layer holds. */
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
