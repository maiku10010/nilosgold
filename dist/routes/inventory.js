"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const db_1 = require("../db");
const validation_1 = require("../validation");
const friendlyId_1 = require("../friendlyId");
const inventoryLedger_1 = require("../inventoryLedger");
const router = (0, express_1.Router)();
const categories = ['GOLD', 'SILVER', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS'];
const unitsByCategory = {
    GOLD: ['grams', 'troy oz'], SILVER: ['grams'], GEMSTONES: ['carats', 'pieces'],
    BOXES: ['boxes', 'pieces'], PACKAGING: ['pieces', 'boxes'], FINDINGS: ['pieces', 'grams'], TOOLS: ['pieces'],
};
function parseMovement(body, existing) {
    const category = String(body.category ?? existing?.category ?? 'GOLD').trim().toUpperCase();
    const itemName = String(body.itemName ?? existing?.itemName ?? '').trim();
    const unit = String(body.unit ?? existing?.unit ?? (category === 'GEMSTONES' ? 'carats' : category === 'BOXES' ? 'boxes' : category === 'TOOLS' || category === 'PACKAGING' || category === 'FINDINGS' ? 'pieces' : 'grams'));
    const quantityIn = body.quantityIn ?? body.goldIn ?? 0;
    const quantityOut = body.quantityOut ?? body.goldOut ?? 0;
    const quantityLoss = body.quantityLoss ?? body.scraps ?? body.scrap ?? 0;
    const unitPrice = body.unitPrice ?? 0;
    if (!categories.includes(category))
        return 'Choose a supported inventory category.';
    if (!unitsByCategory[category]?.includes(unit))
        return `Choose a supported unit for ${category.toLowerCase()}.`;
    if (!itemName)
        return 'Enter an item description.';
    if (![quantityIn, quantityOut, quantityLoss].every(validation_1.isNonNegativeNumber) || Number(quantityIn) + Number(quantityOut) + Number(quantityLoss) <= 0)
        return 'Enter a positive quantity for at least one movement.';
    if (!(0, validation_1.isNonNegativeNumber)(unitPrice))
        return 'Enter a valid non-negative unit price.';
    if (body.date !== undefined && !(0, validation_1.isValidNonFutureDate)(body.date))
        return 'Inventory date must be a valid date no later than today.';
    return { category, itemName, unit, quantityIn: Number(quantityIn), quantityOut: Number(quantityOut), quantityLoss: Number(quantityLoss), unitPrice: Number(unitPrice), ...(body.date ? { date: new Date(body.date) } : {}) };
}
router.post('/', async (req, res) => {
    try {
        const parsed = parseMovement(req.body);
        if (typeof parsed === 'string')
            return res.status(400).json({ error: parsed });
        const saved = await db_1.prisma.$transaction(async (tx) => {
            const created = await tx.inventory.create({ data: {
                    referenceId: (0, friendlyId_1.friendlyId)(), universalReferenceId: (0, friendlyId_1.friendlyId)(), itemName: parsed.itemName, unit: parsed.unit, category: parsed.category,
                    quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
                    unitPrice: parsed.unitPrice,
                    goldIn: parsed.category === 'GOLD' ? parsed.quantityIn : 0,
                    goldOut: parsed.category === 'GOLD' ? parsed.quantityOut : 0,
                    scraps: parsed.category === 'GOLD' ? parsed.quantityLoss : 0,
                    updatedAt: parsed.date ?? new Date(),
                } });
            await (0, inventoryLedger_1.syncInventoryExpense)(tx, { ...created, unitPrice: parsed.unitPrice });
            await (0, inventoryLedger_1.recalculateInventory)(tx);
            return tx.inventory.findUnique({ where: { referenceId: created.referenceId } });
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        res.status(201).json(saved);
    }
    catch (error) {
        console.error('Error creating inventory item:', error);
        const status = Number(error?.statusCode) || (error?.code === 'P2034' ? 409 : 400);
        res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be saved.' });
    }
});
router.get('/', async (req, res) => {
    try {
        const category = typeof req.query.category === 'string' ? req.query.category.toUpperCase() : undefined;
        if (category && !categories.includes(category))
            return res.status(400).json({ error: 'Choose a supported inventory category.' });
        const rows = await db_1.prisma.inventory.findMany({ where: { deletedAt: null, ...(category ? { category } : {}) }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
        res.json(rows);
    }
    catch (error) {
        console.error('Error fetching inventory items:', error);
        res.status(500).json({ error: 'Inventory could not be loaded.' });
    }
});
router.put('/:referenceId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
        const existing = await db_1.prisma.inventory.findFirst({ where: { referenceId: targetId, deletedAt: null } });
        if (!existing)
            return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
        const parsed = parseMovement(req.body, existing);
        if (typeof parsed === 'string')
            return res.status(400).json({ error: parsed });
        const saved = await db_1.prisma.$transaction(async (tx) => {
            await tx.inventory.update({ where: { referenceId: targetId }, data: {
                    itemName: parsed.itemName, unit: parsed.unit, category: parsed.category,
                    quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
                    unitPrice: parsed.unitPrice,
                    goldIn: parsed.category === 'GOLD' ? parsed.quantityIn : 0,
                    goldOut: parsed.category === 'GOLD' ? parsed.quantityOut : 0,
                    scraps: parsed.category === 'GOLD' ? parsed.quantityLoss : 0,
                    updatedAt: parsed.date ?? new Date(),
                } });
            await (0, inventoryLedger_1.syncInventoryExpense)(tx, { referenceId: targetId, category: parsed.category, itemName: parsed.itemName, unit: parsed.unit, quantityIn: parsed.quantityIn, unitPrice: parsed.unitPrice, updatedAt: parsed.date ?? new Date() });
            await (0, inventoryLedger_1.recalculateInventory)(tx);
            return tx.inventory.findUnique({ where: { referenceId: targetId } });
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        res.json(saved);
    }
    catch (error) {
        console.error('Error updating inventory item:', error);
        const status = Number(error?.statusCode) || (error?.code === 'P2034' ? 409 : 400);
        res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be updated.' });
    }
});
router.delete('/:referenceId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
        const deleted = await db_1.prisma.$transaction(async (tx) => {
            const result = await tx.inventory.updateMany({ where: { referenceId: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
            if (!result.count)
                return 0;
            const movement = await tx.inventory.findUnique({ where: { referenceId: targetId } });
            if (movement)
                await (0, inventoryLedger_1.syncInventoryExpense)(tx, { ...movement, unitPrice: movement.unitPrice, deletedAt: new Date() });
            await (0, inventoryLedger_1.recalculateInventory)(tx);
            return result.count;
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        if (!deleted)
            return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
        res.json({ message: 'Inventory item successfully deleted' });
    }
    catch (error) {
        console.error('Error deleting inventory item:', error);
        const status = Number(error?.statusCode) || (error?.code === 'P2034' ? 409 : 400);
        res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be deleted.' });
    }
});
exports.default = router;
