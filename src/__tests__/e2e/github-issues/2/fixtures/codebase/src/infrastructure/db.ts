import type { Story } from '../domain/model.js';

export interface StoryPointsRepository {
  load(): Story[];
}

export const repository: StoryPointsRepository = {
  load: () => [],
};
