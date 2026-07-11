import type { OrderRepository } from '../ports/repositories/repositoryA/order-repository.js';
import type { PricingPort } from '../ports/service-a-port/pricing-port.js';
import type { EventBusPort } from '../ports/event-bus-port/event-bus-port.js';
import { OrderPlacedIntegrationEvent } from '../events/order-placed-integration-event.js';

// Write side. Reaches aggregates ONLY through the repository port — the Order
// type is inferred from `orders.load`, never imported from the domain.
export class PlaceOrderHandler {
  constructor(
    private readonly orders: OrderRepository,
    private readonly pricing: PricingPort,
    private readonly bus: EventBusPort,
  ) {}

  async handle(orderId: string): Promise<void> {
    await this.pricing.quote(orderId);
    const order = await this.orders.load(orderId);
    order.place();
    await this.orders.save(order);
    const integrationEvents = order
      .pullEvents()
      .map((event) => new OrderPlacedIntegrationEvent(event));
    void integrationEvents;
    await this.bus.publish(order.pullEvents());
  }
}
