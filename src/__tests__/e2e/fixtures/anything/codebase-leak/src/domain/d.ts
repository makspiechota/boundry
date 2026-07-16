// The domain reaching into infrastructure — still forbidden. The composition
// root's `#anything` exemption is its own, and must not leak to other modules.
import { save } from '../infra/i.js';

export const placed = (): string => save({ id: 'o-1' });
