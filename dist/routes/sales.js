"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
//create operation for sales
router.post('/', async (req, res) => {
    try {
        const newSales = await db_1.prisma.sales.create({
            data: {
                serviceType: req.body.serviceType,
                price: req.body.price,
                status: req.body.status,
                downpayment: req.body.downpayment || 0.00,
                salesDate: req.body.salesDate ? new Date(req.body.salesDate) : undefined,
                client: {
                    connect: { clientId: req.body.clientId }
                }
            }
        });
        res.json(newSales);
    }
    catch (error) {
        console.error('Error creating sales:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for sales
router.get('/', async (req, res) => {
    try {
        const allSales = await db_1.prisma.sales.findMany({
            include: { client: true }
        });
        res.json(allSales);
    }
    catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for sales
router.put('/:invoiceId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.invoiceId)
            ? req.params.invoiceId[0]
            : req.params.invoiceId;
        const updatedSales = await db_1.prisma.sales.update({
            where: { invoiceId: targetId },
            data: {
                serviceType: req.body.serviceType,
                price: req.body.price,
                status: req.body.status,
                downpayment: req.body.downpayment || 0.00,
                salesDate: req.body.salesDate ? new Date(req.body.salesDate) : undefined
            }
        });
        res.json(updatedSales);
    }
    catch (error) {
        console.error('Error updating sales:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//delete operation for sales
router.delete('/:invoiceId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.invoiceId)
            ? req.params.invoiceId[0]
            : req.params.invoiceId;
        await db_1.prisma.sales.delete({
            where: { invoiceId: targetId }
        });
        res.json({ message: 'Sale invoice successfully deleted' });
    }
    catch (error) {
        if (error.code === 'P2003') {
            return res.status(400).json({
                error: 'Cannot delete sale: Please delete the associated Job Costing record first.'
            });
        }
        console.error('Error deleting sale:', error);
        res.status(500).json({ error: 'Failed to delete sale' });
    }
});
exports.default = router;
