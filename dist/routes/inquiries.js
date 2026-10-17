"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const friendlyId_1 = require("../friendlyId");
const validation_1 = require("../validation");
const router = (0, express_1.Router)();
router.post('/', async (req, res) => {
    try {
        const { customerName, contactInfo, email, details, category, quotedPrice, clientId, isFullyPaid } = req.body;
        const date = req.body.date;
        if (date !== undefined && !(0, validation_1.isValidNonFutureDate)(date))
            return res.status(400).json({ error: 'Inquiry date must be a valid date no later than today.' });
        if (typeof customerName !== 'string' || !customerName.trim() || typeof category !== 'string' || !category.trim() || !(0, validation_1.isNonNegativeNumber)(quotedPrice)) {
            return res.status(400).json({ error: 'Enter a customer, category, and valid quote.' });
        }
        if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))
            return res.status(400).json({ error: 'Enter a valid customer email address.' });
        if (contactInfo && !(0, validation_1.isValidPHContact)(contactInfo))
            return res.status(400).json({ error: 'Enter a valid Philippine contact number (11 digits starting with 09).' });
        if (isFullyPaid !== undefined && typeof isFullyPaid !== 'boolean')
            return res.status(400).json({ error: 'Fully Paid must be true or false.' });
        const inquiry = await db_1.prisma.inquiries.create({
            data: {
                inquiryId: (0, friendlyId_1.friendlyId)(),
                universalReferenceId: (0, friendlyId_1.friendlyId)(),
                customerName: customerName.trim(),
                contactInfo: typeof contactInfo === 'string' ? contactInfo.trim() : null,
                email: typeof email === 'string' && email.trim() ? email.trim() : null,
                details: typeof details === 'string' ? details.trim() : null,
                category: category.trim(),
                quotedPrice: Number(quotedPrice),
                isFullyPaid: isFullyPaid ?? false,
                status: 'PENDING',
                ...(date ? { inqDate: new Date(`${date}T00:00:00`) } : {}),
                ...(typeof clientId === 'string' && clientId ? { client: { connect: { clientId } } } : {}),
            },
            include: { client: true, jobCost: { include: { sales: true } } },
        });
        res.locals.auditRecordId = inquiry.inquiryId;
        res.status(201).json(inquiry);
    }
    catch (error) {
        console.error('Error creating inquiry:', error);
        res.status(500).json({ error: 'Inquiry could not be saved.' });
    }
});
router.get('/', async (_req, res) => {
    try {
        const inquiries = await db_1.prisma.inquiries.findMany({
            where: { deletedAt: null },
            include: { client: true, jobCost: { include: { sales: true } } },
            orderBy: { inqDate: 'desc' },
        });
        res.json(inquiries);
    }
    catch (error) {
        console.error('Error fetching inquiries:', error);
        res.status(500).json({ error: 'Inquiries could not be loaded.' });
    }
});
router.put('/:inquiryId', async (req, res) => {
    try {
        const inquiryId = Array.isArray(req.params.inquiryId) ? req.params.inquiryId[0] : req.params.inquiryId;
        const date = req.body.date;
        if (date !== undefined && !(0, validation_1.isValidNonFutureDate)(date))
            return res.status(400).json({ error: 'Inquiry date must be a valid date no later than today.' });
        if (typeof req.body.customerName !== 'string' || !req.body.customerName.trim() || typeof req.body.category !== 'string' || !req.body.category.trim() || !(0, validation_1.isNonNegativeNumber)(req.body.quotedPrice)) {
            return res.status(400).json({ error: 'Enter a customer, category, and valid quote.' });
        }
        if (req.body.email && !(0, validation_1.isValidEmail)(req.body.email))
            return res.status(400).json({ error: 'Enter a valid customer email address.' });
        if (req.body.contactInfo && !(0, validation_1.isValidPHContact)(req.body.contactInfo))
            return res.status(400).json({ error: 'Enter a valid Philippine contact number (11 digits starting with 09).' });
        if (req.body.isFullyPaid !== undefined && typeof req.body.isFullyPaid !== 'boolean')
            return res.status(400).json({ error: 'Fully Paid must be true or false.' });
        const existing = await db_1.prisma.inquiries.findFirst({ where: { inquiryId, deletedAt: null }, include: { jobCost: true } });
        if (!existing)
            return res.status(404).json({ error: 'Inquiry not found.' });
        if (existing.status !== 'PENDING' || (existing.jobCost && !existing.jobCost.deletedAt))
            return res.status(409).json({ error: 'Only pending inquiries without an active job costing can be edited.' });
        const inquiry = await db_1.prisma.inquiries.update({
            where: { inquiryId },
            data: {
                customerName: req.body.customerName.trim(),
                contactInfo: typeof req.body.contactInfo === 'string' ? req.body.contactInfo.trim() : null,
                email: typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim() : null,
                details: typeof req.body.details === 'string' ? req.body.details.trim() : null,
                category: req.body.category.trim(),
                quotedPrice: Number(req.body.quotedPrice),
                ...(req.body.isFullyPaid !== undefined ? { isFullyPaid: req.body.isFullyPaid } : {}),
                ...(date ? { inqDate: new Date(`${date}T00:00:00`) } : {}),
            },
            include: { client: true, jobCost: { include: { sales: true } } },
        });
        res.json(inquiry);
    }
    catch (error) {
        console.error('Error updating inquiry:', error);
        res.status(500).json({ error: 'Inquiry could not be updated.' });
    }
});
router.delete('/:inquiryId', async (req, res) => {
    try {
        const inquiryId = Array.isArray(req.params.inquiryId) ? req.params.inquiryId[0] : req.params.inquiryId;
        const existing = await db_1.prisma.inquiries.findFirst({ where: { inquiryId, deletedAt: null }, include: { jobCost: true } });
        if (!existing)
            return res.status(404).json({ error: 'Inquiry not found.' });
        if (existing.jobCost && !existing.jobCost.deletedAt)
            return res.status(409).json({ error: 'Delete the linked job costing before deleting this inquiry.' });
        await db_1.prisma.inquiries.update({ where: { inquiryId }, data: { deletedAt: new Date() } });
        res.json({ message: 'Inquiry deleted.' });
    }
    catch (error) {
        console.error('Error deleting inquiry:', error);
        res.status(500).json({ error: 'Inquiry could not be deleted.' });
    }
});
exports.default = router;
