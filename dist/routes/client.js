"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const friendlyId_1 = require("../friendlyId");
const validation_1 = require("../validation");
const accounting_1 = require("../accounting");
const router = (0, express_1.Router)();
//create operation for client
router.post('/', async (req, res) => {
    try {
        if (!(0, validation_1.isValidPHContact)(req.body.contactNum))
            return res.status(400).json({ error: 'Enter a valid Philippine contact number (11 digits starting with 09).' });
        if (req.body.email && !(0, validation_1.isValidEmail)(req.body.email))
            return res.status(400).json({ error: 'Enter a valid email address.' });
        const newClient = await db_1.prisma.client.create({
            data: {
                clientId: (0, friendlyId_1.friendlyId)(),
                clientName: req.body.clientName,
                contactNum: req.body.contactNum,
                email: req.body.email || null,
            }
        });
        res.json({ ...newClient, balance: 0 });
    }
    catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for client
router.get('/', async (req, res) => {
    try {
        const allClients = await db_1.prisma.client.findMany({
            where: { deletedAt: null },
            include: { sales: { where: { deletedAt: null }, include: { payments: true } }, inquiries: { where: { deletedAt: null } } }
        });
        res.json(allClients.map(client => ({ ...client, sales: client.sales.map(accounting_1.withSaleTotals), balance: (0, accounting_1.clientBalance)(client.sales) })));
    }
    catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for client 
router.put('/:clientId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.clientId)
            ? req.params.clientId[0]
            : req.params.clientId;
        if (!(0, validation_1.isValidPHContact)(req.body.contactNum))
            return res.status(400).json({ error: 'Enter a valid Philippine contact number (11 digits starting with 09).' });
        if (req.body.email && !(0, validation_1.isValidEmail)(req.body.email))
            return res.status(400).json({ error: 'Enter a valid email address.' });
        const updatedClient = await db_1.prisma.client.update({
            where: { clientId: targetId },
            data: {
                clientName: req.body.clientName,
                contactNum: req.body.contactNum,
                email: req.body.email ?? undefined,
            }
        });
        const sales = await db_1.prisma.sales.findMany({ where: { clientId: targetId, deletedAt: null }, include: { payments: true } });
        res.json({ ...updatedClient, balance: (0, accounting_1.clientBalance)(sales) });
    }
    catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//delete operation for client
router.delete('/:clientId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.clientId)
            ? req.params.clientId[0]
            : req.params.clientId;
        const deleted = await db_1.prisma.client.updateMany({
            where: { clientId: targetId, deletedAt: null }, data: { deletedAt: new Date() }
        });
        if (!deleted.count)
            return res.status(404).json({ error: 'Client not found or already archived.' });
        res.json({ message: 'Client successfully deleted' });
    }
    catch (error) {
        // P2003 triggers if the client still has connected sales records
        if (error.code === 'P2003') {
            return res.status(400).json({
                error: 'Cannot delete client: This client still has existing sales/invoices attached.'
            });
        }
        console.error('Error deleting client:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});
exports.default = router;
