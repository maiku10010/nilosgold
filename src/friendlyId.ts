import { randomInt } from 'node:crypto';

/** Human-readable date-scoped identifier used for newly created records. */
export function friendlyId(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(now).map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}-T${randomInt(100, 1_000_000)}`;
}
