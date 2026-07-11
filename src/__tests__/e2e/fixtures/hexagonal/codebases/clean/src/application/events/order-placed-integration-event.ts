import type { OrderPlaced } from '../../domain/events/order-placed.js';

// Application-level event wrapping a domain event for publication.
export class OrderPlacedIntegrationEvent {
  constructor(public readonly domainEvent: OrderPlaced) {}
}
