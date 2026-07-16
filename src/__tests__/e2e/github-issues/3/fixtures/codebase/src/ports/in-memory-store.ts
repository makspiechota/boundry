// A guarded FILE living directly in ports/, beside the story-points-read
// sub-folder. Its own leaf module — not the ports folder.
export interface Store {
  get(id: string): string | undefined;
}

export const inMemoryStore: Store = {
  get: () => undefined,
};
