import { LikeC4 } from 'likec4';
import { readFileSync, writeFileSync } from 'node:fs';
import type { VisualizerPort } from '../../core/ports/ports.js';
import type { BoundaryModel, Module, AllowedEdge } from '../../core/model/boundary-model.js';

interface TextRange {
  start: number;
  end: number;
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
