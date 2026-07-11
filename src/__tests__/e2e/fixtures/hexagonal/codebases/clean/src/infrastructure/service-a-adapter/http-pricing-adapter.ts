import type { PricingPort } from '../../application/ports/service-a-port/pricing-port.js';
import { Money } from '../../domain/value-objects/money.js';

// Driven adapter: implements the port; constructs the value object it returns.
export class HttpPricingAdapter implements PricingPort {
  async quote(_sku: string): Promise<Money> {
    return new Money(1000, 'USD');
  }
}
