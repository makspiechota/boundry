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
  /**
   * Ids of wildcard elements — diagram boxes tagged `#anything`. They map to no
   * folder and are not modules; they stand for "the rest of the code". A module
   * with an allowed edge to one is exempt from every boundary rule.
   *
   * This is the explicit way to say "deliberately unconstrained", for the
   * composition root that must wire everything together. It is a drawn,
   * reviewable grant — unlike opting out by staying unmapped, where the mere
   * ABSENCE of a box would hand out the same power silently.
   */
  wildcards: string[];
  /**
   * Optional code root declared fully governed. Every folder under it is
   * expected to be modelled, so importing territory no module claims is
   * forbidden rather than free. Omitted (the default) = unmapped folders are
   * ignored, which keeps a communication diagram usable as an enforcement one.
   */
  governRoot?: string;
}

/**
 * Modules holding an approved edge to a wildcard element, i.e. free to import
 * anything. A `#proposed` edge to a wildcard is excluded from `allowed` like any
 * other proposal, so the exemption only takes effect once a human approves it.
 */
export function unconstrainedModules(model: BoundaryModel): Set<string> {
  const wildcards = new Set(model.wildcards);
  return new Set(
    model.allowed.filter((edge) => wildcards.has(edge.to)).map((edge) => edge.from),
  );
}

const edgeKey = (edge: AllowedEdge): string => `${edge.from} -> ${edge.to}`;

/**
 * Edges allowed at `head` that were not allowed at `base`.
 *
 * A `#proposed` edge is deliberately excluded from a model's allow-list, so a
 * proposal never appears here. That makes this delta exactly the set of
 * dependencies granted WITHOUT going through a proposal — i.e. self-approvals.
 */
export function newlyAllowedEdges(
  base: BoundaryModel,
  head: BoundaryModel,
): AllowedEdge[] {
  const allowedAtBase = new Set(base.allowed.map(edgeKey));
  return head.allowed.filter((edge) => !allowedAtBase.has(edgeKey(edge)));
}
