import { PlaceOrderHandler } from '../commands/place-order.js';
import { GetOrderHistoryHandler } from '../queries/get-order-history.js';

// The only public entry point. Orchestrates the command and query sides.
export class OrderService {
  constructor(
    private readonly placeOrder: PlaceOrderHandler,
    private readonly getHistory: GetOrderHistoryHandler,
  ) {}

  place(orderId: string): Promise<void> {
    return this.placeOrder.handle(orderId);
  }

  history(customerId: string): Promise<number> {
    return this.getHistory.handle(customerId);
  }
}
