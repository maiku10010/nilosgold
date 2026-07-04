"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
//create operation for job_cost
router.post('/', async (req, res) => {
    try {
        const newJobCost = await db_1.prisma.job_Cost.create({
            data: {
                goldUsed: req.body.goldUsed,
                laborCost: req.body.laborCost,
                invoiceId: req.body.invoiceId,
                empId: req.body.empId,
            }
        });
        res.json(newJobCost);
    }
    catch (error) {
        console.error('Error creating job cost:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for job_cost
router.get('/', async (req, res) => {
    try {
        const allJobCosts = await db_1.prisma.job_Cost.findMany({
            include: { employee: true, sale: true }
        });
        res.json(allJobCosts);
    }
    catch (error) {
        console.error('Error fetching job costs:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for job_cost
router.put('/:jobCostId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.jobCostId)
            ? req.params.jobCostId[0]
            : req.params.jobCostId;
        const updatedJobCost = await db_1.prisma.job_Cost.update({
            where: { jobCostId: targetId },
            data: {
                goldUsed: req.body.goldUsed,
                laborCost: req.body.laborCost,
                invoiceId: req.body.invoiceId,
                empId: req.body.empId
            }
        });
        res.json(updatedJobCost);
    }
    catch (error) {
        console.error('Error updating job cost:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// DELETE http://localhost:3000/job_costing/:jobCostId
router.delete('/:jobCostId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.jobCostId)
            ? req.params.jobCostId[0]
            : req.params.jobCostId;
        await db_1.prisma.job_Cost.delete({
            where: { jobCostId: targetId }
        });
        res.json({ message: 'Job cost breakdown successfully deleted' });
    }
    catch (error) {
        console.error('Error deleting job cost:', error);
        res.status(500).json({ error: 'Failed to delete job cost' });
    }
});
exports.default = router;
