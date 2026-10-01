import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { isNonNegativeNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';

const router = Router();
const categories = ['GOLD', 'SILVER', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS'] as const;
const unitsByCategory: Record<string, string[]> = {
  GOLD: ['grams', 'troy oz'], SILVER: ['grams'], GEMSTONES: ['carats', 'pieces'],
  BOXES: ['boxes', 'pieces'], PACKAGING: ['pieces', 'boxes'], FINDINGS: ['pieces', 'grams'], TOOLS: ['pieces'],
};
type Movement = { category: string; itemName: string; unit: string; quantityIn: number; quantityOut: number; quantityLoss: number; date?: Date };
const stockKey = (row: { category: string; itemName: string; unit: string }) => row.category === 'GOLD'
  ? `GOLD\u0000${row.unit}` : `${row.category}\u0000${row.unit}\u0000${row.itemName.trim().toLocaleLowerCase()}`;

function parseMovement(body: any, existing?: { category: string; itemName: string; unit: string }): Movement | string {
  const category = String(body.category ?? existing?.category ?? 'GOLD').trim().toUpperCase();
  const itemName = String(body.itemName ?? existing?.itemName ?? '').trim();
  const unit = String(body.unit ?? existing?.unit ?? (category === 'GEMSTONES' ? 'carats' : category === 'BOXES' ? 'boxes' : category === 'TOOLS' || category === 'PACKAGING' || category === 'FINDINGS' ? 'pieces' : 'grams'));
  const quantityIn = body.quantityIn ?? body.goldIn ?? 0;
  const quantityOut = body.quantityOut ?? body.goldOut ?? 0;
  const quantityLoss = body.quantityLoss ?? body.scraps ?? body.scrap ?? 0;
  if (!categories.includes(category as typeof categories[number])) return 'Choose a supported inventory category.';
  if (!unitsByCategory[category]?.includes(unit)) return `Choose a supported unit for ${category.toLowerCase()}.`;
  if (!itemName) return 'Enter an item description.';
  if (![quantityIn, quantityOut, quantityLoss].every(isNonNegativeNumber) || Number(quantityIn) + Number(quantityOut) + Number(quantityLoss) <= 0) return 'Enter a positive quantity for at least one movement.';
  if (body.date !== undefined && !isValidNonFutureDate(body.date)) return 'Inventory date must be a valid date no later than today.';
  return { category, itemName, unit, quantityIn: Number(quantityIn), quantityOut: Number(quantityOut), quantityLoss: Number(quantityLoss), ...(body.date ? { date: new Date(body.date) } : {}) };
}

async function recalculateInventory(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
  const balances = new Map<string, number>();
  for (const row of rows) {
    const key = stockKey(row);
    const balance = (balances.get(key) ?? 0) + Number(row.quantityIn) - Number(row.quantityOut) - Number(row.quantityLoss);
    if (balance < -0.000001) throw new Error(`This movement would make ${row.category.toLowerCase()} stock negative at ${row.referenceId}.`);
    const nextBalance = Math.max(0, balance);
    balances.set(key, nextBalance);
    await tx.inventory.update({ where: { referenceId: row.referenceId }, data: { balance: nextBalance, totalGold: row.category === 'GOLD' ? nextBalance : 0 } });
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = parseMovement(req.body);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    const saved = await prisma.$transaction(async tx => {
      const created = await tx.inventory.create({ data: {
        referenceId: friendlyId(), itemName: parsed.itemName, unit: parsed.unit, category: parsed.category,
        quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
        goldIn: parsed.category === 'GOLD' ? parsed.quantityIn : 0,
        goldOut: parsed.category === 'GOLD' ? parsed.quantityOut : 0,
        scraps: parsed.category === 'GOLD' ? parsed.quantityLoss : 0,
        updatedAt: parsed.date ?? new Date(),
      } });
      await recalculateInventory(tx);
      return tx.inventory.findUnique({ where: { referenceId: created.referenceId } });
    });
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Inventory item could not be saved.' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category.toUpperCase() : undefined;
    if (category && !categories.includes(category as typeof categories[number])) return res.status(400).json({ error: 'Choose a supported inventory category.' });
    const rows = await prisma.inventory.findMany({ where: { deletedAt: null, ...(category ? { category } : {}) }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
    res.json(rows);
  } catch (error) { console.error('Error fetching inventory items:', error); res.status(500).json({ error: 'Inventory could not be loaded.' }); }
});

router.put('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const existing = await prisma.inventory.findFirst({ where: { referenceId: targetId, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
    const parsed = parseMovement(req.body, existing);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    const saved = await prisma.$transaction(async tx => {
      await tx.inventory.update({ where: { referenceId: targetId }, data: {
        itemName: parsed.itemName, unit: parsed.unit, category: parsed.category,
        quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
        goldIn: parsed.category === 'GOLD' ? parsed.quantityIn : 0,
        goldOut: parsed.category === 'GOLD' ? parsed.quantityOut : 0,
        scraps: parsed.category === 'GOLD' ? parsed.quantityLoss : 0,
        updatedAt: parsed.date ?? new Date(),
      } });
      await recalculateInventory(tx);
      return tx.inventory.findUnique({ where: { referenceId: targetId } });
    });
    res.json(saved);
  } catch (error) { console.error('Error updating inventory item:', error); res.status(400).json({ error: error instanceof Error ? error.message : 'Inventory item could not be updated.' }); }
});

router.delete('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const deleted = await prisma.$transaction(async tx => {
      const result = await tx.inventory.updateMany({ where: { referenceId: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!result.count) return 0;
      await recalculateInventory(tx);
      return result.count;
    });
    if (!deleted) return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
    res.json({ message: 'Inventory item successfully deleted' });
  } catch (error) { console.error('Error deleting inventory item:', error); res.status(400).json({ error: error instanceof Error ? error.message : 'Inventory item could not be deleted.' }); }
});

export default router;
