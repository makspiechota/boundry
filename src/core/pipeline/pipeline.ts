import type {
  VisualizerPort,
  EnforcerPort,
  EnforcerConfig,
  CheckResult,
} from "../ports/ports.js";

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
}
