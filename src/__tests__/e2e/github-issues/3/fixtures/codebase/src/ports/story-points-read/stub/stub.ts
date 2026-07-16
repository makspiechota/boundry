// A descendant of ports/ importing the in-memory-store file that lives in its
// ancestor folder. In a folder-only model this collapses to a descendant →
// ancestor edge, which LikeC4 rejects. With the store mapped as a file leaf,
// the edge is stub → store — a legal sibling-to-sibling edge.
import { inMemoryStore } from '../../in-memory-store.js';

export const readStub = (): string | undefined => inMemoryStore.get('x');
