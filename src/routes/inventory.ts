import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { isNonNegativeNumber, isPositiveNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';
import { calculateInventoryBalances, validateInventoryLedger } from '../inventoryLedger';

const router = Router();
const categories = ['GOLD', 'SILVER', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS'] as const;
const unitsByCategory: Record<string, string[]> = {
  GOLD: ['grams', 'troy oz'], SILVER: ['grams'], GEMSTONES: ['carats', 'pieces'],
  BOXES: ['boxes', 'pieces'], PACKAGING: ['pieces', 'boxes'], FINDINGS: ['pieces', 'grams'], TOOLS: ['pieces'],
};
type Movement = { category: typeof categories[number]; itemName: string; unit: string; quantityIn: number; quantityOut: number; quantityLoss: number; unitPrice: number; date?: Date };
function parseMovement(body: any, existing?: { category: string; itemName: string; unit: string }): Movement | string {
  const category = String(body.category ?? existing?.category ?? 'GOLD').trim().toUpperCase();
  const itemName = String(body.itemName ?? existing?.itemName ?? '').trim();
  const unit = String(body.unit ?? existing?.unit ?? (category === 'GEMSTONES' ? 'carats' : category === 'BOXES' ? 'boxes' : category === 'TOOLS' || category === 'PACKAGING' || category === 'FINDINGS' ? 'pieces' : 'grams'));
  const quantityIn = body.quantityIn ?? body.goldIn ?? 0;
  const quantityOut = body.quantityOut ?? body.goldOut ?? 0;
  const quantityLoss = body.quantityLoss ?? body.scraps ?? body.scrap ?? 0;
  const unitPrice = body.unitPrice ?? 0;
  if (!categories.includes(category as typeof categories[number])) return 'Choose a supported inventory category.';
  if (!unitsByCategory[category]?.includes(unit)) return `Choose a supported unit for ${category.toLowerCase()}.`;
  if (!itemName) return 'Enter an item description.';
  if (![quantityIn, quantityOut, quantityLoss].every(isNonNegativeNumber) || Number(quantityIn) + Number(quantityOut) + Number(quantityLoss) <= 0) return 'Enter a positive quantity for at least one movement.';
  if (!isPositiveNumber(unitPrice)) return 'Unit price must be greater than zero.';
  if (body.date !== undefined && !isValidNonFutureDate(body.date)) return 'Inventory date must be a valid date no later than today.';
  return { category: category as Movement['category'], itemName, unit, quantityIn: Number(quantityIn), quantityOut: Number(quantityOut), quantityLoss: Number(quantityLoss), unitPrice: Number(unitPrice), ...(body.date ? { date: new Date(body.date) } : {}) };
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = parseMovement(req.body);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    const saved = await prisma.$transaction(async tx => {
      const created = await tx.inventory.create({ data: {
        referenceId: friendlyId(), universalReferenceId: friendlyId(), itemName: parsed.itemName, unit: parsed.unit, category: parsed.category,
        quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
        unitPrice: parsed.unitPrice,
        updatedAt: parsed.date ?? new Date(),
      } });
      await validateInventoryLedger(tx);
      const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
      const balances = calculateInventoryBalances(rows);
      const saved = rows.find(row => row.referenceId === created.referenceId)!;
      const balance = balances.get(created.referenceId) ?? 0;
      return { ...saved, balance, totalGold: saved.category === 'GOLD' ? balance : 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    const status = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 400);
    res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be saved.' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category.toUpperCase() as typeof categories[number] : undefined;
    if (category && !categories.includes(category as typeof categories[number])) return res.status(400).json({ error: 'Choose a supported inventory category.' });
    const rows = await prisma.inventory.findMany({ where: { deletedAt: null, ...(category ? { category } : {}) }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
    const balances = calculateInventoryBalances(rows);
    res.json(rows.map(row => ({ ...row, balance: balances.get(row.referenceId) ?? 0, totalGold: row.category === 'GOLD' ? balances.get(row.referenceId) ?? 0 : 0 })));
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
        unitPrice: parsed.unitPrice,
        updatedAt: parsed.date ?? new Date(),
      } });
      await validateInventoryLedger(tx);
      const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
      const balances = calculateInventoryBalances(rows);
      const saved = rows.find(row => row.referenceId === targetId)!;
      const balance = balances.get(targetId) ?? 0;
      return { ...saved, balance, totalGold: saved.category === 'GOLD' ? balance : 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json(saved);
  } catch (error) { console.error('Error updating inventory item:', error); const status = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 400); res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be updated.' }); }
});

router.delete('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const deleted = await prisma.$transaction(async tx => {
      const result = await tx.inventory.updateMany({ where: { referenceId: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!result.count) return 0;
      await validateInventoryLedger(tx);
      return result.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!deleted) return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
    res.json({ message: 'Inventory item successfully deleted' });
  } catch (error) { console.error('Error deleting inventory item:', error); const status = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 400); res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be deleted.' }); }
});

export default router;
