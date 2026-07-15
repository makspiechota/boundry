import { LikeC4 } from 'likec4';
import { readFileSync, writeFileSync } from 'node:fs';
import type { VisualizerPort } from '../../core/ports/ports.js';
import type { BoundaryModel, Module, AllowedEdge } from '../../core/model/boundary-model.js';

interface TextRange {
  start: number;
  end: number;
}

function findDescendant(node: any, predicate: (n: any) => boolean): any {
  const seen = new Set<any>();
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object' || seen.has(n)) continue;
    seen.add(n);
    if (Array.isArray(n)) {
      stack.push(...n);
      continue;
    }
    if (predicate(n)) return n;
    for (const key of Object.keys(n)) {
      if (!key.startsWith('$')) stack.push(n[key]);
    }
  }
  return undefined;
}

function isProposedTag(node: any, text: string): boolean {
  return (
    node.$type === 'TagRef' &&
    node.$cstNode &&
    text.slice(node.$cstNode.offset, node.$cstNode.end) === '#proposed'
  );
}

/**
 * For a relationship carrying a `#proposed` marker, the range of source to
 * remove: the whole relationship body (the proposal decoration) plus the
 * whitespace before it, or the bare inline tag when there is no body.
 */
function proposedRemovalRange(relation: any, text: string): TextRange | undefined {
  const body = findDescendant(relation, (n) => n.$type === 'RelationBody' && n.$cstNode);
  if (body) {
    let start = body.$cstNode.offset;
    while (start > 0 && /\s/.test(text[start - 1])) start--;
    return { start, end: body.$cstNode.end };
  }
  const tag = findDescendant(relation, (n) => isProposedTag(n, text));
  if (tag) {
    let start = tag.$cstNode.offset;
    while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
    return { start, end: tag.$cstNode.end };
  }
  return undefined;
}

function collectProposedRanges(root: any, text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const seen = new Set<any>();
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (
      node.$type === 'Relation' &&
      node.$cstNode &&
      findDescendant(node, (n) => isProposedTag(n, text))
    ) {
      const range = proposedRemovalRange(node, text);
      if (range) ranges.push(range);
    }
    for (const key of Object.keys(node)) {
      if (!key.startsWith('$')) walk(node[key]);
    }
  };
  walk(root);
  return ranges;
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
    const folderIds = new Set<string>();
    for (const el of model.elements()) {
      const meta = el.getMetadata('folder');
      const folder = Array.isArray(meta) ? meta[0] : meta;
      if (folder) {
        const id = String(el.id);
        modules.push({ id, title: el.title, folder });
        folderIds.add(id);
      }
    }

    const allowed: AllowedEdge[] = [];
    for (const rel of model.relationships()) {
      // A `#proposed` edge is an intent, not yet approved — it is NOT enforced
      // as allowed until the marker is stripped (see `approve`).
      if (rel.tags.some((tag) => String(tag) === 'proposed')) continue;
      const from = String(rel.source.id);
      const to = String(rel.target.id);
      if (from !== to && folderIds.has(from) && folderIds.has(to)) {
        allowed.push({ from, to });
      }
    }

    return { modules, allowed };
  }

  /**
   * Deterministically strip `#proposed` markers from the diagram source,
   * promoting intent edges to approved. Source-preserving; never an LLM edit —
   * it locates each marked relationship in the LikeC4 CST and splices out its
   * proposal decoration, leaving all other formatting intact.
   */
  async approve(): Promise<void> {
    const likec4: any = await LikeC4.fromWorkspace(this.workspaceDir);
    for (const doc of likec4.LangiumDocuments.all) {
      const filePath: string = doc.uri.fsPath;
      const text: string = doc.textDocument?.getText?.() ?? readFileSync(filePath, 'utf8');
      const ranges = collectProposedRanges(doc.parseResult?.value, text);
      if (ranges.length === 0) continue;

      let next = text;
      for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) {
        next = next.slice(0, start) + next.slice(end);
      }
      writeFileSync(filePath, next);
    }
  }
}
