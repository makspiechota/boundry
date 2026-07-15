// Intra-module import — both files belong to `appSecret`. This must NEVER be a
// violation, even though `appSecret` lives inside the `application` folder.
import { b } from './b.js';

export const a = `a(${b})`;
