import type { OrderRepository } from '../../application/ports/repositories/repositoryA/order-repository.js';
import { Order } from '../../domain/aggregates/order.js';

// Driven adapter: implements the port and rehydrates aggregates.
export class InMemoryOrderRepository implements OrderRepository {
  private readonly store = new Map<string, Order>();

  async load(id: string): Promise<Order> {
    const order = this.store.get(id);
    if (!order) throw new Error(`order ${id} not found`);
    return order;
  }

  async save(order: Order): Promise<void> {
    this.store.set(order.id, order);
  }
}
