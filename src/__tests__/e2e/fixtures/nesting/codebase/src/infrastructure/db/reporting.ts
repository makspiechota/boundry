// Violation: infrastructure.db may import application.ports, but NOT
// application.service. Reaching one child of application does not grant the rest.
import { service } from '../../application/service/service.js';

export const reporting = `reporting(${service})`;
