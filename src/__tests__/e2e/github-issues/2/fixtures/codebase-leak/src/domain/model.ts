// Production code reaching into another layer's test helper. The exemption is
// from-side only, so this is still a boundary violation.
import { fixture } from '../application/__tests__/helper.js';

export const total = (): number => fixture().points;
