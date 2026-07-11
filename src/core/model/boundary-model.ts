/**
 * The single, source-agnostic representation everything in Boundry compiles
 * from. A visualizer adapter produces it; an enforcer adapter renders it.
 */

/** A unit of architecture that maps to a folder of source code. */
export interface Module {
  /** Stable id, taken from the diagram element. */
  id: string;
  /** Human-readable name for messages. */
  title: string;
  /** Source path prefix the module owns, e.g. "src/core". */
  folder: string;
}

/** A permitted dependency: modules in `from` may import modules in `to`. */
export interface AllowedEdge {
  from: string;
  to: string;
}

export interface BoundaryModel {
  modules: Module[];
  allowed: AllowedEdge[];
}
