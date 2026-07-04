"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
//create operation for inventory
router.post('/', async (req, res) => {
    try {
        const newItem = await db_1.prisma.inventory.create({
            data: {
                goldIn: req.body.goldIn || 0.00,
                goldOut: req.body.goldOut || 0.00,
                scraps: req.body.scraps || 0.00,
                totalGold: req.body.totalGold || 0.00,
                unit: req.body.unit || 'grams'
            }
        });
        res.json(newItem);
    }
    catch (error) {
        console.error('Error creating inventory item:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for inventory
router.get('/', async (req, res) => {
    try {
        const allItems = await db_1.prisma.inventory.findMany();
        res.json(allItems);
    }
    catch (error) {
        console.error('Error fetching inventory items:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for inventory
router.put('/:referenceId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.referenceId)
            ? req.params.referenceId[0]
            : req.params.referenceId;
        const updatedItem = await db_1.prisma.inventory.update({
            where: { referenceId: targetId },
            data: {
                goldIn: req.body.goldIn,
                goldOut: req.body.goldOut,
                scraps: req.body.scraps,
                totalGold: req.body.totalGold,
                unit: req.body.unit
            }
        });
        res.json(updatedItem);
    }
    catch (error) {
        console.error('Error updating inventory item:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// DELETE http://localhost:3000/inventory/:referenceId
router.delete('/:referenceId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.referenceId)
            ? req.params.referenceId[0]
            : req.params.referenceId;
        await db_1.prisma.inventory.delete({
            where: { referenceId: targetId }
        });
        res.json({ message: 'Inventory item successfully deleted' });
    }
    catch (error) {
        console.error('Error deleting inventory item:', error);
        res.status(500).json({ error: 'Failed to delete inventory item' });
    }
});
exports.default = router;
