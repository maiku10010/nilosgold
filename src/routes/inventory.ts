import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isNonNegativeNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';

const router = Router();

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
    const latest = await prisma.inventory.findFirst({ orderBy: { updatedAt: 'desc' } });
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
    const allItems = await prisma.inventory.findMany({ orderBy: { updatedAt: 'asc' } });
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
    res.json(updatedItem);
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
    await prisma.inventory.delete({
      where: { referenceId: targetId }
    });
    res.json({ message: 'Inventory item successfully deleted' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

export default router;
