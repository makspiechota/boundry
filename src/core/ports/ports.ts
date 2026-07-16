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
