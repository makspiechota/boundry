import { OrderService } from '../application/service/order-service.js';

// The outside world may reach the application only through its public service.
export function bootstrap(service: OrderService): Promise<void> {
  return service.place('order-1');
}
