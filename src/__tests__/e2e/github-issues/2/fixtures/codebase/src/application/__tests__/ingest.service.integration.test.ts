// An integration test wiring a real adapter across a layer boundary. This is the
// test doing its job, not the architecture being broken.
import { ingest } from '../ingest.service.js';
import { repository } from '../../infrastructure/db.js';

export const run = (): number => ingest(repository.load());
