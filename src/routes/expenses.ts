import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isPositiveNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';
import { validateInventoryLedger } from '../inventoryLedger';

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
    res.locals.auditRecordId = newExpense.expenseId;
    res.json(newExpense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for expenses
router.get('/', async (req: Request, res: Response) => {
  try {
    const [allExpenses, purchases] = await Promise.all([
      prisma.expenses.findMany({ where: { deletedAt: null }, orderBy: { expDate: 'desc' } }),
      prisma.inventory.findMany({ where: { deletedAt: null, quantityIn: { gt: 0 } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const inventoryExpenses = purchases.map(row => ({
      expenseId: `inventory-${row.referenceId}`, category: `Inventory · ${row.category}`,
      amount: Number(row.quantityIn) * Number(row.unitPrice),
      description: `Purchase: ${row.itemName} (${row.quantityIn} ${row.unit}) at ${Number(row.unitPrice).toFixed(2)} per ${row.unit}`,
      expDate: row.updatedAt, source: 'inventory' as const,
    }));
    res.json([...allExpenses, ...inventoryExpenses].sort((a, b) => new Date(b.expDate).getTime() - new Date(a.expDate).getTime()));
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
    if (targetId.startsWith('inventory-')) return res.status(409).json({ error: 'Update inventory purchases from the Inventory page.' });
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
    if (targetId.startsWith('inventory-')) {
      const referenceId = targetId.slice('inventory-'.length);
      const deleted = await prisma.$transaction(async tx => {
        const result = await tx.inventory.updateMany({ where: { referenceId, deletedAt: null }, data: { deletedAt: new Date() } });
        if (result.count) await validateInventoryLedger(tx);
        return result.count;
      });
      if (!deleted) return res.status(404).json({ error: 'Inventory purchase not found or already archived.' });
      return res.json({ message: 'Inventory purchase archived.' });
    }
    const deleted = await prisma.$transaction(async tx => {
      const expense = await tx.expenses.findFirst({ where: { expenseId: targetId, deletedAt: null } });
      if (!expense) return false;
      const deletedAt = new Date();
      await tx.expenses.update({ where: { expenseId: targetId }, data: { deletedAt } });
      return true;
    });
    if (!deleted) return res.status(404).json({ error: 'Expense not found or already archived.' });
    res.json({ message: 'Expense record successfully deleted' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
