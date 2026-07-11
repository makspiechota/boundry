// Forbidden: the domain reaches into infrastructure. The diagram only draws
// infra -> domain, so this domain -> infra edge must be caught.
import { Database } from '../infra/database.js';

export class Order {
  constructor(private readonly db: Database) {}

  total(): number {
    return this.db.query('select 1').length;
  }
}
