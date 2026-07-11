import { LineItem } from '../entities/line-item.js';
import { Money } from '../value-objects/money.js';
import { OrderPlaced } from '../events/order-placed.js';

// Aggregate root: composes entities, holds value objects, raises domain events.
export class Order {
  private readonly events: OrderPlaced[] = [];

  constructor(
    public readonly id: string,
    private readonly items: LineItem[] = [],
  ) {}

  total(): Money {
    return this.items.reduce(
      (sum, item) => sum.add(item.price),
      new Money(0, 'USD'),
    );
  }

  place(): void {
    this.events.push(new OrderPlaced(this.id, this.total()));
  }

  pullEvents(): OrderPlaced[] {
    return this.events.splice(0);
  }
}
