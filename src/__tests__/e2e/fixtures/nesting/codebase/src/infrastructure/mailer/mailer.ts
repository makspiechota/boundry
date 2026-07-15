// Violation: only infrastructure.db may import application.ports. Another
// infrastructure child (mailer) importing the same port is not permitted.
import { ports } from '../../application/ports/ports.js';

export const mailer = `mailer(${ports})`;
