// Allowed: application.service -> infrastructure.db is drawn.
import { db } from '../../infrastructure/db/db.js';

export const service = `service(${db})`;
