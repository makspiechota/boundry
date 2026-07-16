// read (story-points-read) reaching into the store file, an edge nobody drew.
// stub's grant does not leak to its sibling — this is a violation, and it proves
// the file leaf is a first-class governed target under the default-deny model.
import { inMemoryStore } from '../in-memory-store.js';

export const read = (): string | undefined => inMemoryStore.get('y');
