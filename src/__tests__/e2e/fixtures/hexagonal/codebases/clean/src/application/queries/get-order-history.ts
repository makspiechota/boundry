import type { OrderHistoryRepository } from '../ports/repositories/repositoryB/order-history-repository.js';

// Read side. Goes through a repository port only — never the write domain.
export class GetOrderHistoryHandler {
  constructor(private readonly history: OrderHistoryRepository) {}

  async handle(customerId: string): Promise<number> {
    const orders = await this.history.history(customerId);
    return orders.length;
  }
}
