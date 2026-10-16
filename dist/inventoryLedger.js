"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateInventoryBalances = calculateInventoryBalances;
exports.validateInventoryLedger = validateInventoryLedger;
const movementKey = (row) => row.category === 'GOLD'
    ? `GOLD:${row.goldKarat ?? 'unknown'}:grams`
    : `${row.category}:${row.unit}:${row.itemName.trim().toLowerCase()}`;
const movementFactor = (row) => row.category === 'GOLD' && row.unit === 'troy oz' ? 31.1034768 : 1;
function calculateInventoryBalances(rows) {
    const totals = new Map();
    for (const row of rows) {
        const key = movementKey(row);
        const change = (Number(row.quantityIn) - Number(row.quantityOut) - Number(row.quantityLoss)) * movementFactor(row);
        totals.set(key, (totals.get(key) ?? 0) + change);
    }
    for (const [key, total] of totals) {
        if (total < -0.000001) {
            const row = rows.find(candidate => movementKey(candidate) === key);
            const product = row.category === 'GOLD' && row.goldKarat ? `${row.goldKarat}K gold` : `${row.category.toLowerCase()} stock for ${row.itemName}`;
            throw Object.assign(new Error(`Insufficient ${product} (${row.unit}).`), { statusCode: 409 });
        }
    }
    const running = new Map();
    const result = new Map();
    for (const row of rows) {
        const key = movementKey(row);
        const factor = movementFactor(row);
        const balance = (running.get(key) ?? 0) + (Number(row.quantityIn) - Number(row.quantityOut) - Number(row.quantityLoss)) * factor;
        running.set(key, balance);
        result.set(row.referenceId, balance / factor);
    }
    return result;
}
async function validateInventoryLedger(tx) {
    const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
    calculateInventoryBalances(rows);
}
