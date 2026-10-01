"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendlyId = friendlyId;
const node_crypto_1 = require("node:crypto");
/** Human-readable date-scoped identifier used for newly created records. */
function friendlyId(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}-T${(0, node_crypto_1.randomInt)(100, 1_000_000)}`;
}
