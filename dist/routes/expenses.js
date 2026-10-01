"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const validation_1 = require("../validation");
const friendlyId_1 = require("../friendlyId");
const router = (0, express_1.Router)();
//create operation for expenses
router.post('/', async (req, res) => {
    try {
        const date = req.body.expDate;
        if (date !== undefined && !(0, validation_1.isValidNonFutureDate)(date))
            return res.status(400).json({ error: 'Expense date must be a valid date no later than today.' });
        if (typeof req.body.category !== 'string' || !req.body.category.trim() || typeof req.body.description !== 'string' || !req.body.description.trim() || !(0, validation_1.isPositiveNumber)(req.body.amount))
            return res.status(400).json({ error: 'Enter a category, description, and an amount greater than zero.' });
        const newExpense = await db_1.prisma.expenses.create({
            data: {
                expenseId: (0, friendlyId_1.friendlyId)(),
                category: req.body.category.trim(),
                amount: Number(req.body.amount),
                description: req.body.description.trim(),
                ...(date ? { expDate: new Date(date) } : {})
            }
        });
        res.json(newExpense);
    }
    catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for expenses
router.get('/', async (req, res) => {
    try {
        const allExpenses = await db_1.prisma.expenses.findMany();
        res.json(allExpenses);
    }
    catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for expenses
router.put('/:expenseId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.expenseId)
            ? req.params.expenseId[0]
            : req.params.expenseId;
        const date = req.body.expDate;
        if (date !== undefined && !(0, validation_1.isValidNonFutureDate)(date))
            return res.status(400).json({ error: 'Expense date must be a valid date no later than today.' });
        if (typeof req.body.category !== 'string' || !req.body.category.trim() || typeof req.body.description !== 'string' || !req.body.description.trim() || !(0, validation_1.isPositiveNumber)(req.body.amount))
            return res.status(400).json({ error: 'Enter a category, description, and an amount greater than zero.' });
        const updatedExpense = await db_1.prisma.expenses.update({
            where: { expenseId: targetId },
            data: {
                category: req.body.category.trim(),
                amount: Number(req.body.amount),
                description: req.body.description.trim(),
                ...(date ? { expDate: new Date(date) } : {})
            }
        });
        res.json(updatedExpense);
    }
    catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// DELETE http://localhost:3000/expenses/:expenseId
router.delete('/:expenseId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.expenseId)
            ? req.params.expenseId[0]
            : req.params.expenseId;
        await db_1.prisma.expenses.delete({
            where: { expenseId: targetId }
        });
        res.json({ message: 'Expense record successfully deleted' });
    }
    catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
});
exports.default = router;
