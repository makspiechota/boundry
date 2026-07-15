// Violation: `appSecret` does NOT inherit the parent's application ->
// infrastructure edge. A child must be permitted explicitly.
import { infra } from '../../infrastructure/infra.js';

export const secret = `secret(${infra})`;
