// The outside world may reach ONLY application/service. Every other import here
// is a violation: a private application module, infrastructure, and the domain.
import { OrderService } from '../application/service/order-service.js';
import { PlaceOrderHandler } from '../application/commands/place-order.js';
import { InMemoryOrderRepository } from '../infrastructure/repositories/in-memory-order-repository.js';
import { Order } from '../domain/aggregates/order.js';

export function bootstrap(): void {
  void OrderService;
  void PlaceOrderHandler;
  void InMemoryOrderRepository;
  void Order;
}
