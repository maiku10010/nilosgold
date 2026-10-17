"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateInventoryBalances = calculateInventoryBalances;
exports.validateInventoryLedger = validateInventoryLedger;
const client_1 = require("@prisma/client");
const movementKey = (row) => row.category === 'SCRAP' ? 'SCRAP:grams' : row.category === 'GOLD'
    ? `${row.category}:${row.goldKarat ?? 'unknown'}:grams`
    : `${row.category}:${row.unit}:${row.itemName.trim().toLowerCase()}`;
const movementFactor = (row) => new client_1.Prisma.Decimal(row.category === 'GOLD' && row.unit === 'troy oz' ? '31.1034768' : '1');
function calculateInventoryBalances(rows) {
    const totals = new Map();
    for (const row of rows) {
        const key = movementKey(row);
        const change = new client_1.Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(movementFactor(row));
        totals.set(key, (totals.get(key) ?? new client_1.Prisma.Decimal(0)).plus(change));
    }
    for (const [key, total] of totals) {
        if (total.isNegative()) {
            const row = rows.find(candidate => movementKey(candidate) === key);
            const product = row.category === 'GOLD' ? row.goldKarat ? `Gold · ${row.goldKarat}K` : 'Gold (karat unspecified)' : row.itemName;
            throw Object.assign(new Error(`Insufficient ${product} (${row.unit}).`), { statusCode: 409 });
        }
    }
    const running = new Map();
    const result = new Map();
    for (const row of rows) {
        const key = movementKey(row);
        const factor = movementFactor(row);
        const balance = (running.get(key) ?? new client_1.Prisma.Decimal(0)).plus(new client_1.Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(factor));
        running.set(key, balance);
        result.set(row.referenceId, balance.div(factor).toNumber());
    }
    return result;
}
async function validateInventoryLedger(tx) {
    const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
    calculateInventoryBalances(rows);
}
