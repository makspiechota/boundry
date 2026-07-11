// Value object: imports nothing else in the domain (pure leaf).
export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: string,
  ) {}

  add(other: Money): Money {
    return new Money(this.amount + other.amount, this.currency);
  }
}
