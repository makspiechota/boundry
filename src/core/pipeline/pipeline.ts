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
   * What this diagram grants that the accepted `lock` did not — dependencies
   * added without a `#proposed` marker, and importer exemptions added. Proposals
   * are excluded from the allow-list, so anything reported here bypassed the
   * approval protocol.
   *
   * The baseline is the lock — the accepted state `approve` records — not a git
   * ref. The lock exists precisely to decouple "accepted" from "committed", so
   * verify reads from it, exactly as `annotate` does; the two can never disagree
   * about what "accepted" means. It also catches a committed-but-unapproved bare
   * edge, which re-deriving a baseline from a git ref would silently absorb.
   */
  async verify(lock: string): Promise<VerifyResult> {
    const base = parseModel(lock);
    const head = await this.visualizer.read();
    return {
      edges: newlyAllowedEdges(base, head),
      exemptions: newlyExemptedImporters(base, head),
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
   * explicit `#proposed` proposal in the source, then paints intrinsic styling on
   * every marker so the proposal is highlighted on every LikeC4 surface. Turns
   * silent drift into a reviewable, colourable proposal without trusting git for
   * the baseline.
   */
  async annotate(lock: string): Promise<AnnotateResult> {
    const accepted = parseModel(lock);
    const head = await this.visualizer.read();
    const edges = newlyAllowedEdges(accepted, head);
    const modules = newlyAddedModules(accepted, head);
    await this.visualizer.propose(edges, modules.map((m) => m.id));
    await this.visualizer.styleMarkers();
    return { edges, modules };
  }

  /**
   * (Re)generate the review views for the diagram's pending changes. By default a
   * single `boundry_diff` landing view draws every `#proposed` / `#proposal-delete`
   * change at once; with `perLayer`, one focused view per layer that draws a change.
   * Reads the diagram's own markers, so it composes with `annotate` (annotate marks
   * drift, this frames it).
   */
  async diffViews(perLayer = false): Promise<DiffView[]> {
    return this.visualizer.emitDiffViews(perLayer);
  }
}
