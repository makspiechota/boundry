import { Money } from '../value-objects/money.js';

// Domain event: carries value objects.
export class OrderPlaced {
  constructor(
    public readonly orderId: string,
    public readonly total: Money,
  ) {}
}
