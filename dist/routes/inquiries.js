"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
//create operation for inquiries
router.post('/', async (req, res) => {
    try {
        const { customerName, contactInfo, details, category, quotedPrice, status, clientId } = req.body;
        const newInquiry = await db_1.prisma.inquiries.create({
            data: {
                customerName,
                contactInfo,
                details,
                category,
                quotedPrice,
                status: status || 'Pending',
                ...(clientId ? { client: { connect: { clientId } } } : {})
            }
        });
        res.json(newInquiry);
    }
    catch (error) {
        console.error('Error creating inquiry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for inquiries
router.get('/', async (req, res) => {
    try {
        const allInquiries = await db_1.prisma.inquiries.findMany({
            include: { client: true }
        });
        res.json(allInquiries);
    }
    catch (error) {
        console.error('Error fetching inquiries:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for inquiries
router.put('/:inquiryId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.inquiryId)
            ? req.params.inquiryId[0]
            : req.params.inquiryId;
        const updatedInquiry = await db_1.prisma.inquiries.update({
            where: { inquiryId: targetId },
            data: {
                customerName: req.body.customerName,
                contactInfo: req.body.contactInfo,
                details: req.body.details,
                category: req.body.category,
                quotedPrice: req.body.quotedPrice,
                status: req.body.status
            }
        });
        res.json(updatedInquiry);
    }
    catch (error) {
        console.error('Error updating inquiry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
