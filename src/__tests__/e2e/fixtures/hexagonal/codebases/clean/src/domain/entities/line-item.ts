import { Money } from '../value-objects/money.js';

// Entity: may import value objects, never aggregates.
export class LineItem {
  constructor(
    public readonly sku: string,
    public readonly price: Money,
  ) {}
}
