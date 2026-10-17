"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goldSourceName = void 0;
exports.goldWeight = goldWeight;
exports.goldMaterialCost = goldMaterialCost;
exports.syncGoldAllocation = syncGoldAllocation;
const client_1 = require("@prisma/client");
const friendlyId_1 = require("./friendlyId");
function goldWeight(value) {
    try {
        const weight = new client_1.Prisma.Decimal(String(value ?? 0));
        if (!weight.isFinite() || weight.isNegative() || weight.decimalPlaces() > 3)
            throw new Error();
        return weight;
    }
    catch {
        throw Object.assign(new Error('Enter a non-negative gold weight with at most 3 decimal places.'), { statusCode: 400, field: 'goldUsed' });
    }
}
const goldSourceName = (karat) => karat == null ? 'Gold (karat unspecified)' : `Gold · ${karat}K`;
exports.goldSourceName = goldSourceName;
function goldMaterialCost(used, scrap, rate) {
    return new client_1.Prisma.Decimal(used).plus(scrap).times(rate).toDecimalPlaces(2);
}
async function syncGoldAllocation(tx, input) {
    if (typeof input.goldSourceId !== 'string' || !input.goldSourceId) {
        throw Object.assign(new Error('Choose a gold source.'), { statusCode: 400, field: 'goldSourceId' });
    }
    const source = await tx.inventory.findFirst({ where: { referenceId: input.goldSourceId, category: 'GOLD', deletedAt: null, quantityIn: { gt: 0 } } });
    if (!source || source.goldKarat == null)
        throw Object.assign(new Error('Choose an active gold source with a recorded karat.'), { statusCode: 400, field: 'goldSourceId' });
    const rows = await tx.inventory.findMany({ where: { category: 'GOLD', goldKarat: source.goldKarat, deletedAt: null } });
    const available = rows.filter(row => row.jobCostId !== input.jobCostId).reduce((sum, row) => sum.plus(new client_1.Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(row.unit === 'troy oz' ? '31.1034768' : '1')), new client_1.Prisma.Decimal(0));
    const required = input.goldUsed.plus(input.goldScrap);
    const name = (0, exports.goldSourceName)(source.goldKarat);
    if (required.greaterThan(available)) {
        throw Object.assign(new Error(`Insufficient ${name}: used + scrap is ${required.toString()} g; available is ${client_1.Prisma.Decimal.max(0, available).toString()} g.`), { statusCode: 409, field: 'goldUsed' });
    }
    const movements = await tx.inventory.findMany({ where: { jobCostId: input.jobCostId, category: 'GOLD' } });
    const current = movements[0];
    // Retain one allocation per job; old/deleted allocations must not deduct twice.
    if (movements.length > 1)
        await tx.inventory.updateMany({ where: { referenceId: { in: movements.slice(1).map(row => row.referenceId) } }, data: { deletedAt: new Date() } });
    const data = {
        itemName: source.itemName, goldKarat: source.goldKarat, unit: 'grams', category: 'GOLD',
        quantityIn: new client_1.Prisma.Decimal(0), quantityOut: input.goldUsed, quantityLoss: input.goldScrap,
        unitPrice: input.goldCostPerG, deletedAt: required.isZero() ? new Date() : null,
    };
    if (current)
        await tx.inventory.update({ where: { referenceId: current.referenceId }, data });
    else if (!required.isZero())
        await tx.inventory.create({ data: {
                ...data, referenceId: (0, friendlyId_1.friendlyId)(), universalReferenceId: input.universalReferenceId, jobCostId: input.jobCostId,
            } });
    await tx.job_Cost.update({ where: { jobCostId: input.jobCostId }, data: { goldKarat: source.goldKarat } });
    return source.goldKarat;
}
