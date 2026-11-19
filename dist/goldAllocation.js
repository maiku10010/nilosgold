"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goldSourceName = void 0;
exports.goldWeight = goldWeight;
exports.goldMaterialCost = goldMaterialCost;
exports.syncGoldAllocation = syncGoldAllocation;
exports.syncScrapRecovery = syncScrapRecovery;
exports.restoreScrapRecovery = restoreScrapRecovery;
exports.reverseJobInventory = reverseJobInventory;
exports.releaseGoldAllocation = releaseGoldAllocation;
exports.findJobMaterialSource = findJobMaterialSource;
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
        throw Object.assign(new Error('Enter a non-negative material weight with at most 3 decimal places.'), { statusCode: 400, field: 'goldUsed' });
    }
}
const goldSourceName = (karat) => karat == null ? 'Gold (karat unspecified)' : `Gold · ${karat}K`;
exports.goldSourceName = goldSourceName;
function goldMaterialCost(used, scrap, rate) {
    return new client_1.Prisma.Decimal(used).plus(scrap).times(rate).toDecimalPlaces(2);
}
async function syncGoldAllocation(tx, input) {
    if (input.goldSourceId === 'CUSTOMER_GOLD') {
        await releaseGoldAllocation(tx, input.jobCostId);
        await tx.job_Cost.update({ where: { jobCostId: input.jobCostId }, data: { customerGold: true } });
        return null;
    }
    if (input.serviceType && input.serviceType !== 'Custom' && (input.goldSourceId == null || input.goldSourceId === '')) {
        await releaseGoldAllocation(tx, input.jobCostId);
        return null;
    }
    if (typeof input.goldSourceId !== 'string' || !input.goldSourceId) {
        throw Object.assign(new Error('Choose a material source.'), { statusCode: 400, field: 'goldSourceId' });
    }
    const source = await tx.inventory.findFirst({ where: { referenceId: input.goldSourceId, category: { in: ['GOLD', 'SILVER'] }, deletedAt: null, quantityIn: { gt: 0 } } });
    if (!source || (source.category === 'GOLD' && source.goldKarat == null))
        throw Object.assign(new Error('Choose active silver stock or gold stock with a recorded karat.'), { statusCode: 400, field: 'goldSourceId' });
    const rows = await tx.inventory.findMany({ where: { category: source.category, ...(source.category === 'GOLD' ? { goldKarat: source.goldKarat } : { itemName: { equals: source.itemName.trim(), mode: 'insensitive' }, unit: 'grams' }), deletedAt: null } });
    const available = rows.filter(row => row.jobCostId !== input.jobCostId).reduce((sum, row) => sum.plus(new client_1.Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(row.unit === 'troy oz' ? '31.1034768' : '1')), new client_1.Prisma.Decimal(0));
    const required = input.goldUsed;
    const name = source.category === 'SILVER' ? source.itemName : (0, exports.goldSourceName)(source.goldKarat);
    if (required.greaterThan(available)) {
        throw Object.assign(new Error(`Insufficient ${name}: material used is ${required.toString()} g; available is ${client_1.Prisma.Decimal.max(0, available).toString()} g.`), { statusCode: 409, field: 'goldUsed' });
    }
    const movements = await tx.inventory.findMany({ where: { jobCostId: input.jobCostId, category: { in: ['GOLD', 'SILVER'] } } });
    const current = movements.find(row => new client_1.Prisma.Decimal(row.quantityIn).isZero());
    // Retain one allocation per job; old/deleted allocations must not deduct twice.
    if (movements.some(row => row !== current))
        await tx.inventory.updateMany({ where: { referenceId: { in: movements.filter(row => row !== current).map(row => row.referenceId) } }, data: { deletedAt: new Date() } });
    const data = {
        itemName: source.itemName, goldKarat: source.goldKarat, unit: 'grams', category: source.category,
        quantityIn: new client_1.Prisma.Decimal(0), quantityOut: input.goldUsed, quantityLoss: new client_1.Prisma.Decimal(0),
        unitPrice: input.goldCostPerG, deletedAt: required.isZero() && source.category === 'GOLD' ? new Date() : null,
    };
    if (current)
        await tx.inventory.update({ where: { referenceId: current.referenceId }, data });
    else if (!required.isZero() || source.category === 'SILVER')
        await tx.inventory.create({ data: {
                ...data, referenceId: (0, friendlyId_1.friendlyId)(), universalReferenceId: input.universalReferenceId, jobCostId: input.jobCostId,
            } });
    // Recovered scrap is a separate stock pool, never usable gold stock.
    await syncScrapRecovery(tx, input.jobCostId, source.goldKarat, source.category === 'SILVER' ? new client_1.Prisma.Decimal(0) : input.goldScrap);
    if (source.category === 'SILVER' && !input.goldScrap.isZero())
        await tx.inventory.create({ data: {
                referenceId: (0, friendlyId_1.friendlyId)(), jobCostId: input.jobCostId, universalReferenceId: input.universalReferenceId,
                itemName: `Scrap silver · ${source.itemName}`, category: 'SILVER', unit: 'grams', goldKarat: null,
                quantityIn: input.goldScrap, quantityOut: new client_1.Prisma.Decimal(0), quantityLoss: new client_1.Prisma.Decimal(0), unitPrice: 0,
            } });
    await tx.job_Cost.update({ where: { jobCostId: input.jobCostId }, data: { goldKarat: source.goldKarat, customerGold: false } });
    return source.goldKarat;
}
function scrapBalances(rows) {
    const totals = new Map();
    for (const row of rows) {
        if (row.category !== 'SCRAP' || row.deletedAt)
            continue;
        const karat = row.goldKarat ?? null;
        totals.set(karat, (totals.get(karat) ?? new client_1.Prisma.Decimal(0)).plus(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss));
    }
    return totals;
}
async function correctScrapBalances(tx, jobCostId, targets) {
    const current = scrapBalances(await tx.inventory.findMany({ where: { jobCostId, category: 'SCRAP', deletedAt: null } }));
    for (const karat of new Set([...current.keys(), ...targets.keys()])) {
        const delta = (targets.get(karat) ?? new client_1.Prisma.Decimal(0)).minus(current.get(karat) ?? 0);
        if (delta.isZero())
            continue;
        // Append corrections: the original recovery and its source purity remain reviewable.
        await tx.inventory.create({ data: {
                referenceId: (0, friendlyId_1.friendlyId)(), jobCostId, universalReferenceId: jobCostId,
                itemName: 'Scrap gold', category: 'SCRAP', unit: 'grams', goldKarat: karat,
                quantityIn: delta.isPositive() ? delta : new client_1.Prisma.Decimal(0),
                quantityOut: delta.isNegative() ? delta.abs() : new client_1.Prisma.Decimal(0),
                quantityLoss: new client_1.Prisma.Decimal(0), unitPrice: 0,
            } });
    }
}
async function syncScrapRecovery(tx, jobCostId, karat, quantity) {
    await correctScrapBalances(tx, jobCostId, new Map([[karat, quantity]]));
}
async function restoreScrapRecovery(tx, jobCostId, snapshot) {
    await correctScrapBalances(tx, jobCostId, scrapBalances(snapshot));
}
/** Reverse recovered scrap while retaining its history; archive the other job deductions. */
async function reverseJobInventory(tx, jobCostId) {
    await syncScrapRecovery(tx, jobCostId, null, new client_1.Prisma.Decimal(0));
    await tx.inventory.updateMany({ where: { jobCostId, category: { not: 'SCRAP' }, deletedAt: null }, data: { deletedAt: new Date() } });
}
async function releaseGoldAllocation(tx, jobCostId) {
    await syncScrapRecovery(tx, jobCostId, null, new client_1.Prisma.Decimal(0));
    await tx.inventory.updateMany({ where: { jobCostId, category: { in: ['GOLD', 'SILVER'] } }, data: { deletedAt: new Date() } });
    await tx.job_Cost.update({ where: { jobCostId }, data: { goldKarat: null, customerGold: false } });
}
/** Reconstruct the selected pool for approval edits, including zero-weight silver allocations. */
async function findJobMaterialSource(tx, job) {
    const movements = await tx.inventory.findMany({ where: { jobCostId: job.jobCostId, category: 'SILVER', deletedAt: null } });
    const silver = movements.find(row => new client_1.Prisma.Decimal(row.quantityIn).isZero());
    if (silver)
        return tx.inventory.findFirst({ where: { category: 'SILVER', itemName: { equals: silver.itemName.trim(), mode: 'insensitive' }, unit: 'grams', deletedAt: null, quantityIn: { gt: 0 } } });
    if (job.goldKarat == null)
        return null;
    return tx.inventory.findFirst({ where: { category: 'GOLD', goldKarat: job.goldKarat, deletedAt: null, quantityIn: { gt: 0 } } });
}
