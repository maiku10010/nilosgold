"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const validation_1 = require("../validation");
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
        const sales = await db_1.prisma.sales.findMany({ include: saleIncludes, orderBy: { salesDate: 'desc' } });
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
            if (current.client.clientName.trim().toLocaleLowerCase() !== clientName.toLocaleLowerCase()) {
                throw Object.assign(new Error('The client name and invoice number do not match.'), { statusCode: 409 });
            }
            if (current.status !== 'PENDING' || !current.job || current.job.status !== 'APPROVED') {
                throw Object.assign(new Error('Only an approved job costing can be moved to Daily Sales.'), { statusCode: 409 });
            }
            const finished = await tx.sales.update({
                where: { invoiceId },
                data: { status: 'FINISHED', salesDate: new Date() },
            });
            await tx.job_Cost.update({ where: { jobCostId: current.job.jobCostId }, data: { status: 'FINISHED' } });
            if (current.job.inquiryId) {
                await tx.inquiries.update({ where: { inquiryId: current.job.inquiryId }, data: { status: 'FINISHED' } });
            }
            const otherSales = await tx.sales.findMany({
                where: { clientId: current.clientId, invoiceId: { not: invoiceId } },
                select: { price: true, downpayment: true },
            });
            const balance = otherSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.downpayment)), 0)
                + Math.max(0, Number(finished.price) - Number(finished.downpayment));
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
router.put('/:invoiceId', async (req, res) => {
    try {
        const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
        const date = req.body.salesDate ?? req.body.date;
        const downpayment = Number(req.body.downpayment ?? 0);
        const price = Number(req.body.price);
        if (!(0, validation_1.isPositiveNumber)(price) || !(0, validation_1.isNonNegativeNumber)(downpayment) || downpayment > price) {
            return res.status(400).json({ error: 'Enter a valid price and a downpayment no greater than the total price.' });
        }
        if (date !== undefined && !(0, validation_1.isValidNonFutureDate)(date))
            return res.status(400).json({ error: 'Sale date must be a valid date no later than today.' });
        if (!serviceTypes.includes(req.body.serviceType))
            return res.status(400).json({ error: 'Choose a valid service type.' });
        if (typeof req.body.clientName !== 'string' || req.body.invoiceId !== invoiceId) {
            return res.status(400).json({ error: 'The client name and invoice number are required to update a sale.' });
        }
        const updated = await db_1.prisma.$transaction(async (tx) => {
            const current = await tx.sales.findUnique({ where: { invoiceId }, include: { client: true } });
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
                    downpayment,
                    ...(date ? { salesDate: new Date(`${date}T00:00:00`) } : {}),
                    client: { update: {
                            ...(typeof req.body.contactNum === 'string' ? { contactNum: req.body.contactNum.trim() } : {}),
                        } },
                },
            });
            const outstandingSales = await tx.sales.findMany({
                where: { clientId: current.clientId },
                select: { price: true, downpayment: true },
            });
            await tx.client.update({ where: { clientId: current.clientId }, data: {
                    clientName: req.body.clientName.trim(),
                    balance: outstandingSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.downpayment)), 0),
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
            const sale = await tx.sales.findUnique({ where: { invoiceId }, include: { job: true } });
            if (!sale)
                throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
            if (sale.job) {
                const inquiryId = sale.job.inquiryId;
                await tx.sales.delete({ where: { invoiceId } });
                await tx.job_Cost.delete({ where: { jobCostId: sale.job.jobCostId } });
                if (inquiryId)
                    await tx.inquiries.update({ where: { inquiryId }, data: { status: 'PENDING' } });
            }
            else {
                await tx.sales.delete({ where: { invoiceId } });
            }
            const remainingSales = await tx.sales.findMany({ where: { clientId: sale.clientId }, select: { price: true, downpayment: true } });
            await tx.client.update({ where: { clientId: sale.clientId }, data: {
                    balance: remainingSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.downpayment)), 0),
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
