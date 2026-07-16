export interface Store {
  get(id: string): string | undefined;
}

export const inMemoryStore: Store = {
  get: () => undefined,
};
