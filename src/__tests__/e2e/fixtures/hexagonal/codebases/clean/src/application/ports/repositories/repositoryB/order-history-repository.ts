import type { Order } from '../../../../domain/aggregates/order.js';

export interface OrderHistoryRepository {
  history(customerId: string): Promise<Order[]>;
}
