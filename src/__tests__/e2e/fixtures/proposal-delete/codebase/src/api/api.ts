import { rule } from '../domain/domain.js';
// Uses the api -> legacy edge that is proposed for deletion. Legal while the
// deletion is only proposed; a violation once it is approved and removed.
import { legacyThing } from '../legacy/legacy.js';

export const handler = (): string => rule() + legacyThing();
