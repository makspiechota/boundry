import { order } from '../domain/d.js';

export const save = (o: typeof order): string => o.id;
