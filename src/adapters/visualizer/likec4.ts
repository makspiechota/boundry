import { LikeC4 } from 'likec4';
import type { VisualizerPort } from '../../core/ports/ports.js';
import type { BoundaryModel, Module, AllowedEdge } from '../../core/model/boundary-model.js';

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
      const from = String(rel.source.id);
      const to = String(rel.target.id);
      if (from !== to && folderIds.has(from) && folderIds.has(to)) {
        allowed.push({ from, to });
      }
    }

    return { modules, allowed };
  }
}
