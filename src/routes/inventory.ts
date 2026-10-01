import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isNonNegativeNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';

const router = Router();

async function recalculateInventory(): Promise<void> {
  await prisma.$transaction(async tx => {
    const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
    let balance = 0;
    for (const row of rows) {
      balance = balance + Number(row.goldIn) - Number(row.goldOut) - Number(row.scraps);
      if (balance < -0.000001) throw new Error(`Inventory change would make gold stock negative at ${row.referenceId}.`);
      await tx.inventory.update({ where: { referenceId: row.referenceId }, data: { totalGold: Math.max(0, balance) } });
    }
  });
}

//create operation for inventory
router.post('/', async (req: Request, res: Response) => {
  try {
    const date = req.body.date;
    const goldIn = req.body.goldIn ?? 0;
    const goldOut = req.body.goldOut ?? 0;
    const scraps = req.body.scraps ?? 0;
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Inventory date must be a valid date no later than today.' });
    if (![goldIn, goldOut, scraps].every(isNonNegativeNumber) || Number(goldIn) + Number(goldOut) + Number(scraps) <= 0) return res.status(400).json({ error: 'Enter at least one non-negative gold movement.' });
    if (!['grams', 'troy oz'].includes(req.body.unit ?? 'grams')) return res.status(400).json({ error: 'Choose a supported weight unit.' });
    const latest = await prisma.inventory.findFirst({ where: { deletedAt: null }, orderBy: { updatedAt: 'desc' } });
    if (Number(goldOut) + Number(scraps) > Number(latest?.totalGold ?? 0) + Number(goldIn)) return res.status(400).json({ error: 'Gold out and scrap exceed the available balance.' });
    const totalGold = Number(latest?.totalGold ?? 0) + Number(goldIn) - Number(goldOut) - Number(scraps);
    const newItem = await prisma.inventory.create({
      data: {
        referenceId: friendlyId(),
        itemName: req.body.itemName || '',
        goldIn: Number(goldIn),
        goldOut: Number(goldOut),
        scraps: Number(scraps),
        totalGold,
        unit: req.body.unit || 'grams',
        ...(date ? { updatedAt: new Date(date) } : {})
      }
    });
    res.json(newItem);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for inventory
router.get('/', async (req: Request, res: Response) => {
  try {
    const allItems = await prisma.inventory.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: 'asc' } });
    res.json(allItems);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//update operation for inventory
router.put('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId)
      ? req.params.referenceId[0]
      : req.params.referenceId;
    const date = req.body.date;
    const goldIn = req.body.goldIn ?? 0;
    const goldOut = req.body.goldOut ?? 0;
    const scraps = req.body.scraps ?? 0;
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Inventory date must be a valid date no later than today.' });
    if (![goldIn, goldOut, scraps].every(isNonNegativeNumber) || Number(goldIn) + Number(goldOut) + Number(scraps) <= 0) return res.status(400).json({ error: 'Enter at least one non-negative gold movement.' });
    if (!isNonNegativeNumber(req.body.totalGold)) return res.status(400).json({ error: 'Inventory balance cannot be negative.' });
    if (!['grams', 'troy oz'].includes(req.body.unit ?? 'grams')) return res.status(400).json({ error: 'Choose a supported weight unit.' });
    const existing = await prisma.inventory.findFirst({ where: { referenceId: targetId, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
    const updatedItem = await prisma.inventory.update({
      where: { referenceId: targetId },
      data: {
        itemName: req.body.itemName,
        goldIn: req.body.goldIn,
        goldOut: req.body.goldOut,
        scraps: req.body.scraps,
        totalGold: req.body.totalGold,
        unit: req.body.unit,
        ...(date ? { updatedAt: new Date(date) } : {})
      }
    });
    await recalculateInventory();
    res.json(await prisma.inventory.findUnique({ where: { referenceId: updatedItem.referenceId } }));
  } catch (error) {
    console.error('Error updating inventory item:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// DELETE http://localhost:3000/inventory/:referenceId
router.delete('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId)
      ? req.params.referenceId[0]
      : req.params.referenceId;
    const deleted = await prisma.inventory.updateMany({ where: { referenceId: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!deleted.count) return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
    await recalculateInventory();
    res.json({ message: 'Inventory item successfully deleted' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

export default router;
