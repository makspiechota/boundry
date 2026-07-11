import type { OrderPlaced } from '../../../domain/events/order-placed.js';

export interface EventBusPort {
  publish(events: OrderPlaced[]): Promise<void>;
}
