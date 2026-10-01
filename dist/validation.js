"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidNonFutureDate = isValidNonFutureDate;
exports.isNonNegativeNumber = isNonNegativeNumber;
exports.isPositiveNumber = isPositiveNumber;
const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});
function isValidNonFutureDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        return false;
    const today = Object.fromEntries(dateParts.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    return value <= `${today.year}-${today.month}-${today.day}`;
}
function isNonNegativeNumber(value) {
    const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0;
}
function isPositiveNumber(value) {
    const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0;
}
