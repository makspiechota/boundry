// Violation (CQRS rule #1): the command reaches the aggregate directly instead
// of going through a repository port.
import { Order } from '../../domain/aggregates/order.js';

export class PlaceOrderHandler {
  handle(orderId: string): Order {
    return new Order(orderId);
  }
}
