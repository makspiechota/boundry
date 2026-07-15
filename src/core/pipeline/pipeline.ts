import type {
  VisualizerPort,
  EnforcerPort,
  EnforcerConfig,
  CheckResult,
} from "../ports/ports.js";
import type { AllowedEdge } from "../model/boundary-model.js";
import { newlyAllowedEdges } from "../model/boundary-model.js";

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
   * Edges this diagram grants that `base` did not — i.e. dependencies added
   * without a `#proposed` marker. Proposals are excluded from the allow-list,
   * so anything reported here bypassed the approval protocol.
   */
  async verify(base: VisualizerPort): Promise<AllowedEdge[]> {
    const [baseModel, headModel] = await Promise.all([base.read(), this.visualizer.read()]);
    return newlyAllowedEdges(baseModel, headModel);
  }

  /** Approve proposed edges: strip their `#proposed` markers from the diagram. */
  async approve(): Promise<void> {
    return this.visualizer.approve();
  }
}
