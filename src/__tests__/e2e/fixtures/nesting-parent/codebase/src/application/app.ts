// Allowed: application (this file lives directly in application) may import
// infrastructure via the top-level edge.
import { infra } from '../infrastructure/infra.js';

export const app = `app(${infra})`;
