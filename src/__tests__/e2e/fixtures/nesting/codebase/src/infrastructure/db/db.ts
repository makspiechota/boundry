// Allowed: infrastructure.db -> application.ports is drawn.
import { ports } from '../../application/ports/ports.js';

export const db = `db(${ports})`;
