// Violation: a value object reaches "up" into an entity. Rule #4 forbids this —
// value objects may not import entities or aggregates.
import type { LineItem } from '../entities/line-item.js';

export class Money {
  constructor(
    public readonly amount: number,
    public readonly lineItem?: LineItem,
  ) {}
}
