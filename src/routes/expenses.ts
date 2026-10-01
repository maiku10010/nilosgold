import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isPositiveNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';

const router = Router();

//create operation for expenses
router.post('/', async (req: Request, res: Response) => {
  try {
    const date = req.body.expDate;
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Expense date must be a valid date no later than today.' });
    if (typeof req.body.category !== 'string' || !req.body.category.trim() || typeof req.body.description !== 'string' || !req.body.description.trim() || !isPositiveNumber(req.body.amount)) return res.status(400).json({ error: 'Enter a category, description, and an amount greater than zero.' });
    const newExpense = await prisma.expenses.create({
      data: {
        expenseId: friendlyId(),
        category: req.body.category.trim(),
        amount: Number(req.body.amount),
        description: req.body.description.trim(),
        ...(date ? { expDate: new Date(date) } : {})
      }
    });
    res.json(newExpense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for expenses
router.get('/', async (req: Request, res: Response) => {
  try {
    const allExpenses = await prisma.expenses.findMany({ where: { deletedAt: null }, orderBy: { expDate: 'desc' } });
    res.json(allExpenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//update operation for expenses
router.put('/:expenseId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.expenseId)
      ? req.params.expenseId[0]
      : req.params.expenseId;
    const date = req.body.expDate;
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Expense date must be a valid date no later than today.' });
    if (typeof req.body.category !== 'string' || !req.body.category.trim() || typeof req.body.description !== 'string' || !req.body.description.trim() || !isPositiveNumber(req.body.amount)) return res.status(400).json({ error: 'Enter a category, description, and an amount greater than zero.' });
    const existing = await prisma.expenses.findFirst({ where: { expenseId: targetId, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Expense not found or already archived.' });
    const updatedExpense = await prisma.expenses.update({
      where: { expenseId: targetId },
      data: {
        category: req.body.category.trim(),
        amount: Number(req.body.amount),
        description: req.body.description.trim(),
        ...(date ? { expDate: new Date(date) } : {})
      }
    });
    res.json(updatedExpense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// DELETE http://localhost:3000/expenses/:expenseId
router.delete('/:expenseId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.expenseId)
      ? req.params.expenseId[0]
      : req.params.expenseId;
    const deleted = await prisma.expenses.updateMany({ where: { expenseId: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!deleted.count) return res.status(404).json({ error: 'Expense not found or already archived.' });
    res.json({ message: 'Expense record successfully deleted' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
