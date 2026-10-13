const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isValidNonFutureDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = Object.fromEntries(dateParts.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return value <= `${today.year}-${today.month}-${today.day}`;
}

export function isTodayOrFutureDate(value: unknown, now = new Date()): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = Object.fromEntries(dateParts.formatToParts(now).map(({ type, value }) => [type, value]));
  return value >= `${today.year}-${today.month}-${today.day}`;
}

export function isNonNegativeNumber(value: unknown): boolean {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0;
}

export function isPositiveNumber(value: unknown): boolean {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0;
}

export const PH_CONTACT_PATTERN = /^09\d{9}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidPHContact(value: unknown): boolean {
  return typeof value === 'string' && PH_CONTACT_PATTERN.test(value);
}
export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}
