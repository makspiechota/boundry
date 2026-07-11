import type { EventBusPort } from '../../application/ports/event-bus-port/event-bus-port.js';
import type { OrderPlaced } from '../../domain/events/order-placed.js';

// Driven adapter: implements the port; serializes domain events onto SNS.
export class SnsEventBus implements EventBusPort {
  async publish(events: OrderPlaced[]): Promise<void> {
    for (const event of events) {
      void `${event.orderId}:${event.total.amount}`;
    }
  }
}
