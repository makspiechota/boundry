import { order } from './domain/d.js';
import { save } from './infra/i.js';

export const wire = (): void => save(order);
