import { LikeC4 } from 'likec4';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VisualizerPort, DiffView } from '../../core/ports/ports.js';
import type { BoundaryModel, Module, AllowedEdge } from '../../core/model/boundary-model.js';

interface TextRange {
  start: number;
  end: number;
}

/** The generated, derived file holding Boundry's per-layer diff views. */
const DIFF_FILE = 'boundry.diff.likec4';

/** A model-root scope (undefined) or the fqn of the element a view is scoped to. */
type Scope = string | undefined;

/** The generated view id for a scope — `boundry_diff_root` or `boundry_diff_<fqn>`. */
function scopeViewId(scope: Scope): string {
  return scope ? `boundry_diff_${scope.replace(/\./g, '_')}` : 'boundry_diff_root';
}

/**
 * The tightest layer that draws an edge between two elements: the deepest
 * element that contains both, i.e. the common prefix of their fqns (undefined =
 * the model root). An edge nested inside a box shows there, not at a wider scope
 * where the box has collapsed — which is exactly why each layer needs its own view.
 */
function commonScope(from: string, to: string): Scope {
  const a = from.split('.');
  const b = to.split('.');
  const shared: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) {
    shared.push(a[i]);
  }
  return shared.length ? shared.join('.') : undefined;
}

/** The layer that draws a box: its parent element (undefined = the model root). */
function parentScope(fqn: string): Scope {
  const parts = fqn.split('.');
  parts.pop();
  return parts.length ? parts.join('.') : undefined;
}

/**
 * Deterministic highlight rules for the marker tags actually in use. Referencing
 * an undeclared tag is a hard LikeC4 error, and a tag can only be *used* if it is
 * declared — so emitting rules only for seen tags is always safe.
 *
 * Boxes use a style-only `style element.tag` rule: a tagged box is coloured where
 * it already sits and never force-included into a wider view (which would drag a
 * nested proposal out of its collapsed parent, defeating the per-layer framing).
 * Edges use `include … where … with`, coloured and made *solid* so they stand out
 * against LikeC4's dashed default. Amber = addition, red = removal. Verified
 * against LikeC4 1.58.
 */
function highlightLines(usedTags: Set<string>): string[] {
  const lines: string[] = [];
  if (usedTags.has('proposed')) {
    lines.push('    style element.tag = #proposed { color amber }');
  }
  if (usedTags.has('proposal-delete')) {
    lines.push('    style element.tag = #proposal-delete { color red }');
  }
  if (usedTags.has('proposed')) {
    lines.push('    include * -> * where tag is #proposed with { color amber; line solid }');
  }
  if (usedTags.has('proposal-delete')) {
    lines.push('    include * -> * where tag is #proposal-delete with { color red; line solid }');
  }
  return lines;
}

/** One `view … { include * }` block, scoped with `of <element>` unless it is root. */
function renderDiffView(scope: Scope, highlight: string[]): string {
  const opener = scope
    ? `  view ${scopeViewId(scope)} of ${scope} {`
    : `  view ${scopeViewId(scope)} {`;
  const lines = [`    title 'Boundry diff · ${scope ?? 'root'}'`, '    include *', ...highlight];
  return `${opener}\n${lines.join('\n')}\n  }`;
}

/**
 * An exemption pattern has to be a usable regex before it reaches the linter. A
 * broken or empty one would otherwise be a silent hole: it exempts files from
 * every rule, so failing to compile it must be loud, never shrugged off.
 *
 * Note LikeC4 string literals process escapes, so `'\.d\.ts$'` arrives here as
 * `.d.ts$` — a regex where `.` is a wildcard. Patterns must be written
 * `'\\.d\\.ts$'` in the diagram. That silent widening is why an exemption that
 * matches nothing is reported at check time.
 */
function assertUsableRegex(pattern: string, elementId: string): string {
  if (pattern.trim() === '') {
    throw new Error(
      `element '${elementId}' declares an empty exemption pattern, which would exempt every file`,
    );
  }
  try {
    new RegExp(pattern);
  } catch (cause) {
    throw new Error(
      `element '${elementId}' declares an exemption pattern that is not a valid regex: ` +
        `'${pattern}' (${(cause as Error).message}). Remember LikeC4 eats backslashes — ` +
        'write \\\\. to mean a literal dot.',
    );
  }
  return pattern;
}

/**
 * Walk the AST through CONTAINMENT only — descending into a property solely when
 * the child names this node as its `$container`. That skips cross-references (a
 * relation's endpoint links to the element it names), so a node is never reached
 * through another's reference to it, and traversal never leaves this document.
 */
function walkContained(root: any, visit: (node: any) => void): void {
  const go = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue;
      const child = node[key];
      for (const kid of Array.isArray(child) ? child : [child]) {
        if (kid && typeof kid === 'object' && kid.$container === node) go(kid);
      }
    }
  };
  go(root);
}

/**
 * The fully-qualified id of an element AST node — its own name and every
 * enclosing element's, joined by '.'. Matches the id the computed model assigns,
 * for nested elements as well as flat ones.
 */
function fqnOf(astElement: any): string | undefined {
  if (!astElement) return undefined;
  const parts: string[] = [];
  for (let n = astElement; n; n = n.$container) {
    if (n.$type === 'Element' && n.name) parts.unshift(n.name);
  }
  return parts.length ? parts.join('.') : undefined;
}

/** The element an `a -> b` endpoint (FqnRef) resolves to, or undefined. */
function endpointElement(fqnRef: any): any {
  return fqnRef?.value?.ref;
}

/** The literal source text of a TagRef node, or undefined if it is not one. */
function tagRefText(node: any, text: string): string | undefined {
  if (node.$type !== 'TagRef' || !node.$cstNode) return undefined;
  return text.slice(node.$cstNode.offset, node.$cstNode.end);
}

/**
 * The source to remove for a `#proposed` marker. A marker alone on its line takes
 * the whole line (so approving leaves no blank gap); an inline one takes just the
 * token and the space before it. The `tag proposed` declaration in the
 * specification is untouched — the vocabulary stays for the next proposal.
 */
function proposedRemovalRange(tag: any, text: string): TextRange {
  const { offset, end } = tag.$cstNode;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const beforeOnLine = text.slice(lineStart, offset);
  const afterOnLine = text.slice(end, lineEnd === -1 ? text.length : lineEnd);

  if (beforeOnLine.trim() === '' && afterOnLine.trim() === '') {
    return { start: lineStart, end: lineEnd === -1 ? end : lineEnd + 1 };
  }

  let start = offset;
  while (start > lineStart && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  return { start, end };
}

/**
 * The nearest relationship or element the marker sits in, found via the AST
 * `$container` chain — the true syntactic parent. A plain object-graph walk would
 * follow the cross-reference from a relation's endpoint into the element it names
 * and mis-attribute an element's marker to a relation; `$container` never does.
 */
function enclosingStatement(tagRef: any): any {
  for (let n = tagRef.$container; n; n = n.$container) {
    if (n.$type === 'Relation' || n.$type === 'Element') return n;
  }
  return undefined;
}

/**
 * The whole-statement range for a `#proposal-delete` marker: the entire relation
 * or element block, from the start of its first line through its trailing
 * newline, so approving the deletion removes the edge/box and leaves no gap.
 */
function statementRemovalRange(statement: any, text: string): TextRange {
  const { offset, end } = statement.$cstNode;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const nl = text.indexOf('\n', end);
  return { start: lineStart, end: nl === -1 ? text.length : nl + 1 };
}

/**
 * Every source range to splice out to approve a diagram: a `#proposed` marker
 * strips to its token (the edge/box stays and becomes permanent); a
 * `#proposal-delete` marker takes its whole enclosing statement (the edge/box is
 * removed). Ranges are collected via a containment-only walk — descending solely
 * into true children (`child.$container === node`), never cross-references — so
 * one marker is never counted through another element's reference to it, and no
 * range ever escapes into a different document's text.
 */
function collectApprovalRanges(root: any, text: string): TextRange[] {
  const ranges: TextRange[] = [];
  walkContained(root, (node) => {
    const marker = tagRefText(node, text);
    if (marker === '#proposed') {
      ranges.push(proposedRemovalRange(node, text));
    } else if (marker === '#proposal-delete') {
      const statement = enclosingStatement(node);
      if (statement?.$cstNode) ranges.push(statementRemovalRange(statement, text));
    }
  });
  // A whole-statement removal can contain a `#proposed` token range inside it
  // (a box being deleted that also carried a proposed edge). Drop any range that
  // another wholly contains, so back-to-front splicing never double-cuts.
  return ranges.filter(
    (r) => !ranges.some((o) => o !== r && o.start <= r.start && o.end >= r.end && o.end - o.start > r.end - r.start),
  );
}

/**
 * First visualizer adapter. Reads a LikeC4 workspace and lifts it into the
 * boundary model: any element carrying a `folder` metadata key becomes a
 * module, and any relationship between two such elements becomes an allowed
 * edge.
 */
export class LikeC4Visualizer implements VisualizerPort {
  constructor(private readonly workspaceDir: string) {}

  async read(): Promise<BoundaryModel> {
    const likec4 = await LikeC4.fromWorkspace(this.workspaceDir);
    const model = await likec4.computedModel();

    const modules: Module[] = [];
    const moduleIds = new Set<string>();
    const wildcardIds = new Set<string>();
    const exemptImporters = new Set<string>();
    let governRoot: string | undefined;
    for (const el of model.elements()) {
      // Any element may exempt importers; the patterns union across the
      // diagram. LikeC4 forbids a repeated metadata key, so several patterns
      // means either a `|` alternation or one per element.
      const exemptMeta = el.getMetadata('exemptImporters');
      for (const raw of Array.isArray(exemptMeta) ? exemptMeta : exemptMeta ? [exemptMeta] : []) {
        exemptImporters.add(assertUsableRegex(raw, String(el.id)));
      }

      // Opt-in: any element may declare the code root as fully governed. It
      // needs no `folder` of its own — it is a declaration, not a module.
      const rootMeta = el.getMetadata('governRoot');
      const declaredRoot = Array.isArray(rootMeta) ? rootMeta[0] : rootMeta;
      if (declaredRoot && !governRoot) governRoot = declaredRoot;

      // A box tagged `#anything` is a wildcard, not a module: it maps to no
      // folder and stands for the rest of the code. An edge into it exempts the
      // source from every rule.
      if (el.tags.some((tag) => String(tag) === 'anything')) {
        wildcardIds.add(String(el.id));
        continue;
      }

      // An element maps to a folder (owns its subtree) or a single file (owns
      // exactly itself). A file leaf keeps a guarded contract sitting beside its
      // sibling sub-folders, so a deep nested diagram stays legal AND enforceable.
      const folderMeta = el.getMetadata('folder');
      const fileMeta = el.getMetadata('file');
      const folder = Array.isArray(folderMeta) ? folderMeta[0] : folderMeta;
      const file = Array.isArray(fileMeta) ? fileMeta[0] : fileMeta;
      if (folder && file) {
        throw new Error(
          `element '${String(el.id)}' declares both 'folder' and 'file' — a module maps to one path`,
        );
      }
      if (folder || file) {
        const id = String(el.id);
        modules.push({
          id,
          title: el.title,
          path: (folder ?? file)!,
          kind: folder ? 'folder' : 'file',
        });
        moduleIds.add(id);
      }
    }

    const allowed: AllowedEdge[] = [];
    for (const rel of model.relationships()) {
      // A `#proposed` edge is an intent, not yet approved — it is NOT enforced
      // as allowed until the marker is stripped (see `approve`).
      if (rel.tags.some((tag) => String(tag) === 'proposed')) continue;
      const from = String(rel.source.id);
      const to = String(rel.target.id);
      // An edge into a wildcard is kept like any other grant, so `verify` sees a
      // self-granted `#anything` exemption as the newly-allowed edge it is.
      const targetGoverned = moduleIds.has(to) || wildcardIds.has(to);
      if (from !== to && moduleIds.has(from) && targetGoverned) {
        allowed.push({ from, to });
      }
    }

    return {
      modules,
      allowed,
      governRoot,
      wildcards: [...wildcardIds],
      exemptImporters: [...exemptImporters],
    };
  }

  /**
   * Deterministically enact a diagram's pending proposals. Source-preserving,
   * never an LLM edit — it walks the LikeC4 CST and splices ranges directly:
   *   - `#proposed` markers are stripped, promoting their intent edges to
   *     approved (the edge/box stays, permanently allowed);
   *   - `#proposal-delete` markers take their whole edge or box with them, so
   *     approving a proposed removal actually removes it.
   * All other formatting is left intact.
   */
  async approve(): Promise<void> {
    const likec4: any = await LikeC4.fromWorkspace(this.workspaceDir);
    for (const doc of likec4.LangiumDocuments.all) {
      const filePath: string = doc.uri.fsPath;
      const text: string = doc.textDocument?.getText?.() ?? readFileSync(filePath, 'utf8');
      const ranges = collectApprovalRanges(doc.parseResult?.value, text);
      if (ranges.length === 0) continue;

      let next = text;
      for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) {
        next = next.slice(0, start) + next.slice(end);
      }
      writeFileSync(filePath, next);
    }
  }

  /**
   * Deterministically mark the given edges and elements `#proposed`. The inverse
   * of `approve` for additions: an undeclared new edge (a self-grant) or box is
   * rewritten into an explicit, colourable proposal. It locates each target's
   * relation/element in the CST by its resolved ids and injects the marker,
   * skipping anything already marked, so it is idempotent.
   */
  async propose(edges: AllowedEdge[], moduleIds: string[]): Promise<void> {
    if (edges.length === 0 && moduleIds.length === 0) return;
    const wantEdge = new Set(edges.map((e) => `${e.from} -> ${e.to}`));
    const wantModule = new Set(moduleIds);

    const likec4: any = await LikeC4.fromWorkspace(this.workspaceDir);
    for (const doc of likec4.LangiumDocuments.all) {
      const filePath: string = doc.uri.fsPath;
      if (!filePath.endsWith('.likec4')) continue;
      const text: string = doc.textDocument?.getText?.() ?? readFileSync(filePath, 'utf8');

      const inserts: { at: number; text: string }[] = [];
      walkContained(doc.parseResult?.value, (node) => {
        if (node.$type === 'Relation' && node.$cstNode) {
          const from = fqnOf(endpointElement(node.source));
          const to = fqnOf(endpointElement(node.target));
          if (from && to && wantEdge.has(`${from} -> ${to}`)) {
            const { offset, end } = node.$cstNode;
            if (!text.slice(offset, end).includes('#proposed')) {
              inserts.push({ at: end, text: ' #proposed' });
            }
          }
        } else if (node.$type === 'Element' && node.$cstNode) {
          const id = fqnOf(node);
          const body = node.body;
          if (id && wantModule.has(id) && body?.$cstNode) {
            const braceStart = body.$cstNode.offset;
            const bodyText = text.slice(braceStart, body.$cstNode.end);
            if (!bodyText.includes('#proposed')) {
              // Insert as the body's first line, matching the indentation of the
              // line that already follows the opening brace.
              const afterBrace = text.indexOf('{', braceStart) + 1;
              const nextLine = text.indexOf('\n', afterBrace) + 1;
              const indent = (text.slice(nextLine).match(/^[ \t]*/) ?? [''])[0];
              inserts.push({ at: afterBrace, text: `\n${indent}#proposed` });
            }
          }
        }
      });
      if (inserts.length === 0) continue;

      let next = text;
      for (const { at, text: fragment } of inserts.sort((a, b) => b.at - a.at)) {
        next = next.slice(0, at) + fragment + next.slice(at);
      }
      writeFileSync(filePath, next);
    }
  }

  /**
   * Generate a focused diff view for every layer that holds a pending change.
   * Walks the diagram's own `#proposed` / `#proposal-delete` markers (never the
   * lock — a `#proposal-delete` has no lock delta), buckets each change into the
   * tightest scope that draws it, and writes one `view … of <scope>` per bucket
   * to a derived `boundry.diff.likec4`. The file is overwritten each run and
   * removed when nothing is proposed, so it always reflects the current diagram.
   */
  async emitDiffViews(): Promise<DiffView[]> {
    const likec4: any = await LikeC4.fromWorkspace(this.workspaceDir);

    // scopeViewId -> { scope, changes } — deterministic key, so the same diagram
    // always yields the same set of views.
    const layers = new Map<string, { scope: Scope; changes: number }>();
    const record = (scope: Scope): void => {
      const key = scopeViewId(scope);
      const layer = layers.get(key) ?? { scope, changes: 0 };
      layer.changes += 1;
      layers.set(key, layer);
    };
    // Which marker tags actually appear — so the emitted highlight rules only ever
    // reference declared tags (an undeclared tag reference is a hard LikeC4 error).
    const usedTags = new Set<string>();

    for (const doc of likec4.LangiumDocuments.all) {
      const filePath: string = doc.uri.fsPath;
      if (!filePath.endsWith('.likec4') || filePath.endsWith(DIFF_FILE)) continue;
      const text: string = doc.textDocument?.getText?.() ?? readFileSync(filePath, 'utf8');
      walkContained(doc.parseResult?.value, (node) => {
        const marker = tagRefText(node, text);
        if (marker !== '#proposed' && marker !== '#proposal-delete') return;
        usedTags.add(marker.slice(1)); // drop the leading '#'
        const statement = enclosingStatement(node);
        if (statement?.$type === 'Relation') {
          const from = fqnOf(endpointElement(statement.source));
          const to = fqnOf(endpointElement(statement.target));
          if (from && to) record(commonScope(from, to));
        } else if (statement?.$type === 'Element') {
          const fqn = fqnOf(statement);
          if (fqn) record(parentScope(fqn));
        }
      });
    }

    const diffPath = join(this.workspaceDir, DIFF_FILE);
    if (layers.size === 0) {
      // Nothing proposed — clear any stale views so `serve` never renders a diff
      // that no longer exists (and never dangles a reference to an approved-away box).
      if (existsSync(diffPath)) rmSync(diffPath);
      return [];
    }

    // Root first, then by fqn, so the output is stable across runs.
    const ordered = [...layers.values()].sort((a, b) => {
      if (!a.scope) return -1;
      if (!b.scope) return 1;
      return a.scope.localeCompare(b.scope);
    });
    const highlight = highlightLines(usedTags);
    const body = ordered.map((layer) => renderDiffView(layer.scope, highlight)).join('\n');
    writeFileSync(
      diffPath,
      `// Generated by \`boundry diff\` — one focused view per layer with a pending\n` +
        `// change. Derived artifact: regenerate after approve; do not hand-edit.\n` +
        `views {\n${body}\n}\n`,
    );

    return ordered.map((layer) => ({
      id: scopeViewId(layer.scope),
      scope: layer.scope,
      changes: layer.changes,
    }));
  }
}
