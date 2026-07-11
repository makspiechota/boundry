import type { User } from '../domain/user.js';

// Allowed: infrastructure depends on the domain (infra -> domain is drawn).
export class UserRepository {
  find(id: string): User {
    return { id, name: 'Ada' };
  }
}
