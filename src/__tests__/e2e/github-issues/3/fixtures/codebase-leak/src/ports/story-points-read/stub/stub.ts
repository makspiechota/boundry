// Allowed: stub -> store is drawn.
import { inMemoryStore } from '../../in-memory-store.js';

export const readStub = (): string | undefined => inMemoryStore.get('x');
