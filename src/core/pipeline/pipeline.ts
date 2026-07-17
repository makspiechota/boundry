import type {
  VisualizerPort,
  EnforcerPort,
  EnforcerConfig,
  CheckResult,
  DiffView,
} from "../ports/ports.js";
import type { AllowedEdge, Module } from "../model/boundary-model.js";
import {
  newlyAddedModules,
  newlyAllowedEdges,
  newlyExemptedImporters,
  parseModel,
  serializeModel,
} from "../model/boundary-model.js";

/** What the annotator turned into explicit `#proposed` proposals. */
export interface AnnotateResult {
  edges: AllowedEdge[];
  modules: Module[];
}

/**
 * What a diagram grants that the approved base did not. Both kinds of grant are
 * reported, because both let code cross a boundary that was previously closed.
 *
 * This lives with the pipeline rather than the ports: no driven port deals in
 * it, it is what `verify` returns.
 */
export interface VerifyResult {
  /** Dependencies added without going through a `#proposed` proposal. */
  edges: AllowedEdge[];
  /** Importer exemptions added, lifting files out of every rule. */
  exemptions: string[];
}

/**
 * The SDK's public surface. Orchestrates the two driven ports and stays blind
 * to any concrete diagram source or linter — swap adapters, this is untouched.
 */
export class Pipeline {
  constructor(
    private readonly visualizer: VisualizerPort,
    private readonly enforcer: EnforcerPort
  ) {}

  /** Diagram -> boundary model -> generated linter config. */
  async generate(): Promise<EnforcerConfig> {
    const model = await this.visualizer.read();
    return this.enforcer.render(model);
  }

  /** Diagram -> boundary model -> run the linter over `sources`. */
  async check(sources: string[]): Promise<CheckResult> {
    const model = await this.visualizer.read();
    return this.enforcer.check(model, sources);
  }

  /**
   * What this diagram grants that `base` did not — dependencies added without a
   * `#proposed` marker, and importer exemptions added. Proposals are excluded
   * from the allow-list, so anything reported here bypassed the approval
   * protocol.
   */
  async verify(base: VisualizerPort): Promise<VerifyResult> {
    const [baseModel, headModel] = await Promise.all([base.read(), this.visualizer.read()]);
    return {
      edges: newlyAllowedEdges(baseModel, headModel),
      exemptions: newlyExemptedImporters(baseModel, headModel),
    };
  }

  /**
   * Enact the diagram's pending proposals (strip `#proposed`, remove
   * `#proposal-delete`), then return the resulting accepted model as a lock
   * string. The caller persists it: that lock — written by approve, not inferred
   * from git — is the baseline change detection compares against.
   */
  async approve(): Promise<string> {
    await this.visualizer.approve();
    const accepted = await this.visualizer.read();
    return serializeModel(accepted);
  }

  /**
   * Compare the diagram against a previously accepted lock and rewrite every
   * undeclared addition — a bare new edge (a self-grant) or box — into an
   * explicit `#proposed` proposal in the source. Turns silent drift into a
   * reviewable, colourable proposal without trusting git for the baseline.
   */
  async annotate(lock: string): Promise<AnnotateResult> {
    const accepted = parseModel(lock);
    const head = await this.visualizer.read();
    const edges = newlyAllowedEdges(accepted, head);
    const modules = newlyAddedModules(accepted, head);
    await this.visualizer.propose(edges, modules.map((m) => m.id));
    return { edges, modules };
  }

  /**
   * (Re)generate a focused diff view per layer that holds a pending change, so a
   * reviewer sees each proposal in the scope where it is actually drawn — a
   * proposal nested in a box is invisible once that box collapses at a wider
   * view. Reads the diagram's own `#proposed` / `#proposal-delete` markers, so it
   * composes with `annotate` (annotate marks drift, this frames it).
   */
  async diffViews(): Promise<DiffView[]> {
    return this.visualizer.emitDiffViews();
  }
}
