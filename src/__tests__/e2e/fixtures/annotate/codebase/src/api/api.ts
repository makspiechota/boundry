import { rule } from '../domain/domain.js';
// The bare, self-granted dependency. After annotate marks api -> legacy
// #proposed, this import is a violation again — a proposal awaiting approval.
import { legacyThing } from '../legacy/legacy.js';

export const handler = (): string => rule() + legacyThing();
