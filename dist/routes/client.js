"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
//create operation for client
router.post('/', async (req, res) => {
    try {
        const newClient = await db_1.prisma.client.create({
            data: {
                clientName: req.body.clientName,
                contactNum: req.body.contactNum,
                balance: req.body.balance
            }
        });
        res.json(newClient);
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
            include: { sales: true, inquiries: true }
        });
        res.json(allClients);
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
        const updatedClient = await db_1.prisma.client.update({
            where: { clientId: targetId },
            data: {
                clientName: req.body.clientName,
                contactNum: req.body.contactNum,
                balance: req.body.balance
            }
        });
        res.json(updatedClient);
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
        await db_1.prisma.client.delete({
            where: { clientId: targetId }
        });
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
