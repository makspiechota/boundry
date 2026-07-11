import type { Money } from '../../../domain/value-objects/money.js';

export interface PricingPort {
  quote(sku: string): Promise<Money>;
}
