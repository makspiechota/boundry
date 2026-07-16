import type {
  VisualizerPort,
  EnforcerPort,
  EnforcerConfig,
  CheckResult,
} from "../ports/ports.js";
import type { AllowedEdge } from "../model/boundary-model.js";
import {
  newlyAllowedEdges,
  newlyExemptedImporters,
} from "../model/boundary-model.js";

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

  /** Approve proposed edges: strip their `#proposed` markers from the diagram. */
  async approve(): Promise<void> {
    return this.visualizer.approve();
  }
}
