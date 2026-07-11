import type { Order } from '../../../../domain/aggregates/order.js';

// Repository port: the only sanctioned path to aggregates.
export interface OrderRepository {
  load(id: string): Promise<Order>;
  save(order: Order): Promise<void>;
}
