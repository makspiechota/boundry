import { total, type Story } from '../domain/model.js';

export const ingest = (stories: Story[]): number => total(stories);
