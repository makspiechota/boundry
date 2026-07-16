export type {
  BoundaryModel,
  Module,
  AllowedEdge,
} from './core/model/boundary-model.js';
export type {
  VisualizerPort,
  EnforcerPort,
  EnforcerConfig,
  CheckResult,
  Violation,
} from './core/ports/ports.js';
export { Pipeline, type VerifyResult } from './core/pipeline/pipeline.js';
export { LikeC4Visualizer } from './adapters/visualizer/likec4.js';
export { DepCruiserEnforcer } from './adapters/enforcer/depcruiser.js';
