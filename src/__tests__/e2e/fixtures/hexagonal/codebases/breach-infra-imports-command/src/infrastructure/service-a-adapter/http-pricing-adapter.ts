// Violation (encapsulation): infrastructure bypasses the public service and
// imports a private command handler directly. Only application/service is public.
import { PlaceOrderHandler } from '../../application/commands/place-order.js';

export class HttpPricingAdapter {
  constructor(private readonly placeOrder: PlaceOrderHandler) {}

  run(orderId: string): void {
    this.placeOrder.handle(orderId);
  }
}
