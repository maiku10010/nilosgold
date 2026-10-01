import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';

const router = Router();

//create operation for inventory
router.post('/', async (req: Request, res: Response) => {
  try {
    const newItem = await prisma.inventory.create({
      data: {
        goldIn: req.body.goldIn || 0.00,
        goldOut: req.body.goldOut || 0.00,
        scraps: req.body.scraps || 0.00,
        totalGold: req.body.totalGold || 0.00,
        unit: req.body.unit || 'grams'
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
    const allItems = await prisma.inventory.findMany();
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
    const updatedItem = await prisma.inventory.update({
      where: { referenceId: targetId },
      data: {
        goldIn: req.body.goldIn,
        goldOut: req.body.goldOut,
        scraps: req.body.scraps,
        totalGold: req.body.totalGold,
        unit: req.body.unit
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
