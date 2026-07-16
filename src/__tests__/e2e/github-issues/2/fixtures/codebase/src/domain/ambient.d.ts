// An ambient declaration reaching across a boundary to type a global. Generated
// or hand-written, it is not production code taking a dependency.
import type { StoryPointsRepository } from '../infrastructure/db.js';

declare global {
  var __repo: StoryPointsRepository;
}

export {};
