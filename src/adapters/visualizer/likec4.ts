import { LikeC4 } from 'likec4';
import { readFileSync, writeFileSync } from 'node:fs';
import type { VisualizerPort } from '../../core/ports/ports.js';
import type { BoundaryModel, Module, AllowedEdge } from '../../core/model/boundary-model.js';

interface TextRange {
  start: number;
  end: number;
}

/** A `#proposed` marker in the source — on an element or a relationship alike. */
function isProposedTag(node: any, text: string): boolean {
  return (
    node.$type === 'TagRef' &&
    node.$cstNode &&
    text.slice(node.$cstNode.offset, node.$cstNode.end) === '#proposed'
  );
}

/**
 * The source to remove for one marker. A marker alone on its line takes the
 * whole line (so approving leaves no blank gap); an inline one takes just the
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
    if (isProposedTag(node, text)) {
      ranges.push(proposedRemovalRange(node, text));
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
    let governRoot: string | undefined;
    for (const el of model.elements()) {
      // Opt-in: any element may declare the code root as fully governed. It
      // needs no `folder` of its own — it is a declaration, not a module.
      const rootMeta = el.getMetadata('governRoot');
      const declaredRoot = Array.isArray(rootMeta) ? rootMeta[0] : rootMeta;
      if (declaredRoot && !governRoot) governRoot = declaredRoot;

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

    return { modules, allowed, governRoot };
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
