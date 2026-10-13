"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const validation_1 = require("../validation");
const email_1 = require("../services/email");
const friendlyId_1 = require("../friendlyId");
const inventoryLedger_1 = require("../inventoryLedger");
const router = (0, express_1.Router)();
const serviceTypes = ['Custom', 'Repair', 'Resize', 'Cleaning'];
const saleIncludes = { client: true, job: { include: { inquiry: true } } };
// Sales are opened when a pending inquiry is approved for costing. A new
// finished sale can only be completed through this transition endpoint.
router.post('/', (_req, res) => {
    res.status(409).json({ error: 'Create Daily Sales by finishing an approved job costing.' });
});
router.get('/', async (_req, res) => {
    try {
        const sales = await db_1.prisma.sales.findMany({ where: { deletedAt: null }, include: saleIncludes, orderBy: { salesDate: 'desc' } });
        res.json(sales);
    }
    catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ error: 'Daily Sales could not be loaded.' });
    }
});
router.post('/:invoiceId/finish', async (req, res) => {
    try {
        const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
        const suppliedInvoice = typeof req.body.invoiceId === 'string' ? req.body.invoiceId : '';
        const clientName = typeof req.body.clientName === 'string' ? req.body.clientName.trim() : '';
        if (!suppliedInvoice || !clientName || suppliedInvoice !== invoiceId) {
            return res.status(400).json({ error: 'Confirm the exact client name and invoice number to finish this sale.' });
        }
        const sale = await db_1.prisma.$transaction(async (tx) => {
            const current = await tx.sales.findUnique({ where: { invoiceId }, include: { client: true, job: { include: { inquiry: true } } } });
            if (!current)
                throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
            if (current.deletedAt)
                throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
            if (current.client.clientName.trim().toLocaleLowerCase() !== clientName.toLocaleLowerCase()) {
                throw Object.assign(new Error('The client name and invoice number do not match.'), { statusCode: 409 });
            }
            if (current.status !== 'PENDING' || !current.job || current.job.deletedAt || !['APPROVED', 'READY_FOR_PICKUP'].includes(current.job.status)) {
                throw Object.assign(new Error('Only an approved job costing can be moved to Daily Sales.'), { statusCode: 409 });
            }
            const materials = Array.isArray(req.body.materials) ? req.body.materials : [];
            if (materials.some((item) => !item || typeof item.referenceId !== 'string' || !(0, validation_1.isPositiveNumber)(item.quantity))) {
                throw Object.assign(new Error('Choose valid inventory items and positive quantities.'), { statusCode: 400 });
            }
            const deductions = new Map();
            for (const item of materials)
                deductions.set(item.referenceId, (deductions.get(item.referenceId) ?? 0) + Number(item.quantity));
            for (const [referenceId, quantity] of deductions) {
                const stock = await tx.inventory.findFirst({ where: { referenceId, deletedAt: null } });
                if (!stock || stock.category === 'GOLD' || stock.category === 'TOOLS')
                    throw Object.assign(new Error('Choose an active packaging or material inventory item.'), { statusCode: 400 });
                await tx.inventory.create({ data: {
                        referenceId: (0, friendlyId_1.friendlyId)(), universalReferenceId: current.job.universalReferenceId,
                        jobCostId: current.job.jobCostId, itemName: stock.itemName, category: stock.category, unit: stock.unit,
                        quantityOut: quantity, unitPrice: stock.unitPrice, updatedAt: new Date(),
                    } });
            }
            if (deductions.size)
                await (0, inventoryLedger_1.recalculateInventory)(tx);
            const finished = await tx.sales.update({
                where: { invoiceId },
                data: { status: 'FINISHED', salesDate: new Date() },
            });
            await tx.job_Cost.update({ where: { jobCostId: current.job.jobCostId }, data: { status: 'FINISHED' } });
            if (current.job.inquiryId) {
                await tx.inquiries.update({ where: { inquiryId: current.job.inquiryId }, data: { status: 'FINISHED' } });
            }
            const otherSales = await tx.sales.findMany({
                where: { clientId: current.clientId, invoiceId: { not: invoiceId }, deletedAt: null },
                select: { price: true, payment: true },
            });
            const balance = otherSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.payment)), 0)
                + Math.max(0, Number(finished.price) - Number(finished.payment));
            await tx.client.update({ where: { clientId: current.clientId }, data: { balance } });
            return tx.sales.findUniqueOrThrow({ where: { invoiceId }, include: saleIncludes });
        });
        res.json(sale);
    }
    catch (error) {
        const statusCode = Number(error?.statusCode);
        if (statusCode)
            return res.status(statusCode).json({ error: error.message });
        console.error('Error finishing sale:', error);
        res.status(500).json({ error: 'Sale could not be finished.' });
    }
});
router.post('/:invoiceId/receipt', async (req, res) => {
    try {
        const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
        if (req.body?.confirm !== true || req.body?.invoiceId !== invoiceId) {
            return res.status(400).json({ error: 'Confirm the exact invoice in Daily Sales before sending its receipt.' });
        }
        const sale = await db_1.prisma.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: saleIncludes });
        if (!sale || sale.status !== 'FINISHED')
            return res.status(404).json({ error: 'Finished sale not found.' });
        if (sale.receiptSentAt)
            return res.json({ ...sale, notification: { sent: true, alreadySent: true } });
        if (req.body.email !== undefined && req.body.email !== sale.client.email?.trim()) {
            return res.status(409).json({ error: 'The customer email changed. Refresh Daily Sales and confirm the current address before sending.' });
        }
        const notification = await (0, email_1.sendSystemEmail)(sale.client.email, `Official Receipt · ${sale.invoiceId}`, (0, email_1.receiptEmail)(sale), `official-receipt-${sale.invoiceId}`);
        if (!notification.sent)
            return res.json({ ...sale, notification });
        // Concurrent provider replays must not replace the first recorded timestamp.
        try {
            await db_1.prisma.sales.updateMany({ where: { invoiceId, receiptSentAt: null }, data: { receiptSentAt: new Date() } });
            const updated = await db_1.prisma.sales.findUniqueOrThrow({ where: { invoiceId }, include: saleIncludes });
            return res.json({ ...updated, notification });
        }
        catch (error) {
            console.error('Receipt accepted but timestamp could not be saved:', error);
            return res.status(503).json({ error: 'The email provider accepted this receipt, but its saved sent status could not be confirmed. Ask an administrator to check the provider before sending again.' });
        }
    }
    catch (error) {
        console.error('Error sending receipt:', error);
        res.status(500).json({ error: 'Receipt could not be sent.' });
    }
});
router.put('/:invoiceId', async (req, res) => {
    try {
        const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
        const date = req.body.salesDate ?? req.body.date;
        const payment = Number(req.body.payment ?? 0);
        const price = Number(req.body.price);
        if (!(0, validation_1.isPositiveNumber)(price) || !(0, validation_1.isNonNegativeNumber)(payment) || payment > price) {
            return res.status(400).json({ error: 'Payment must be zero or greater and no greater than the total price.' });
        }
        if (req.body.contactNum !== undefined && !(0, validation_1.isValidPHContact)(req.body.contactNum))
            return res.status(400).json({ error: 'Enter a valid Philippine contact number (09XXXXXXXXX or +639XXXXXXXXX).' });
        if (req.body.email !== undefined && req.body.email !== null && req.body.email !== '' && !(0, validation_1.isValidEmail)(req.body.email))
            return res.status(400).json({ error: 'Enter a valid email address.' });
        if (date !== undefined && !(0, validation_1.isValidNonFutureDate)(date))
            return res.status(400).json({ error: 'Sale date must be a valid date no later than today.' });
        if (!serviceTypes.includes(req.body.serviceType))
            return res.status(400).json({ error: 'Choose a valid service type.' });
        if (typeof req.body.clientName !== 'string' || req.body.invoiceId !== invoiceId) {
            return res.status(400).json({ error: 'The client name and invoice number are required to update a sale.' });
        }
        const updated = await db_1.prisma.$transaction(async (tx) => {
            const current = await tx.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: { client: true } });
            if (!current)
                throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
            if (current.status === 'PENDING')
                throw Object.assign(new Error('Edit this invoice from its approved job costing.'), { statusCode: 409 });
            if (current.client.clientName.trim().toLocaleLowerCase() !== req.body.clientName.trim().toLocaleLowerCase()) {
                throw Object.assign(new Error('The client name and invoice number do not match.'), { statusCode: 409 });
            }
            await tx.sales.update({
                where: { invoiceId },
                data: {
                    serviceType: req.body.serviceType,
                    price,
                    payment,
                    ...(date ? { salesDate: new Date(`${date}T00:00:00`) } : {}),
                    client: { update: {
                            ...(typeof req.body.contactNum === 'string' ? { contactNum: req.body.contactNum.trim() } : {}),
                            ...(req.body.email !== undefined ? { email: typeof req.body.email === 'string' ? req.body.email.trim() || null : null } : {}),
                        } },
                },
            });
            const outstandingSales = await tx.sales.findMany({
                where: { clientId: current.clientId, deletedAt: null },
                select: { price: true, payment: true },
            });
            const updatedAmounts = await tx.sales.findMany({ where: { clientId: current.clientId, deletedAt: null }, select: { price: true, payment: true } });
            await tx.client.update({ where: { clientId: current.clientId }, data: {
                    clientName: req.body.clientName.trim(),
                    balance: updatedAmounts.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.payment)), 0),
                } });
            return tx.sales.findUniqueOrThrow({ where: { invoiceId }, include: saleIncludes });
        });
        res.json(updated);
    }
    catch (error) {
        const statusCode = Number(error?.statusCode);
        if (statusCode)
            return res.status(statusCode).json({ error: error.message });
        console.error('Error updating sale:', error);
        res.status(500).json({ error: 'Sale could not be updated.' });
    }
});
router.delete('/:invoiceId', async (req, res) => {
    try {
        const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
        await db_1.prisma.$transaction(async (tx) => {
            const sale = await tx.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: { job: true } });
            if (!sale)
                throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
            if (sale.job) {
                const inquiryId = sale.job.inquiryId;
                await tx.sales.update({ where: { invoiceId }, data: { deletedAt: new Date() } });
                await tx.job_Cost.update({ where: { jobCostId: sale.job.jobCostId }, data: { deletedAt: new Date(), inquiryId: null } });
                await tx.inventory.updateMany({ where: { jobCostId: sale.job.jobCostId, deletedAt: null }, data: { deletedAt: new Date() } });
                await (0, inventoryLedger_1.recalculateInventory)(tx);
                if (inquiryId)
                    await tx.inquiries.update({ where: { inquiryId }, data: { status: 'PENDING' } });
            }
            else {
                await tx.sales.update({ where: { invoiceId }, data: { deletedAt: new Date() } });
            }
            const remainingSales = await tx.sales.findMany({ where: { clientId: sale.clientId, deletedAt: null }, select: { price: true, payment: true } });
            await tx.client.update({ where: { clientId: sale.clientId }, data: {
                    balance: remainingSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.payment)), 0),
                } });
        });
        res.json({ message: 'Sale deleted; its inquiry has been reopened when applicable.' });
    }
    catch (error) {
        const statusCode = Number(error?.statusCode);
        if (statusCode)
            return res.status(statusCode).json({ error: error.message });
        console.error('Error deleting sale:', error);
        res.status(500).json({ error: 'Sale could not be deleted.' });
    }
});
exports.default = router;
