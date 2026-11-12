import { goldWeight } from '../goldAllocation';
import { requireAdmin } from '../auth';
import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { isNonNegativeNumber, isPositiveNumber, isValidNonFutureDate } from '../validation';
import { friendlyId } from '../friendlyId';
import { calculateInventoryBalances, validateInventoryLedger } from '../inventoryLedger';

const router = Router();
const scrapMetadata = (row: { category: string; jobCostId: string | null; goldKarat: number | null; quantityIn: Prisma.Decimal; quantityOut: Prisma.Decimal; quantityLoss: Prisma.Decimal }) => row.category === 'SCRAP' ? {
  jobId: row.jobCostId, sourceKarat: row.goldKarat,
  grams: row.quantityIn.minus(row.quantityOut).minus(row.quantityLoss).toString(),
} : {};
const categories = ['GOLD', 'SCRAP', 'SILVER', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS'] as const;
const unitsByCategory: Record<string, string[]> = {
  SCRAP: ['grams'], GOLD: ['grams', 'troy oz'], SILVER: ['grams'], GEMSTONES: ['carats', 'pieces'],
  BOXES: ['boxes', 'pieces'], PACKAGING: ['pieces', 'boxes'], FINDINGS: ['pieces', 'grams'], TOOLS: ['pieces'],
};
type Movement = { category: typeof categories[number]; itemName: string; unit: string; goldKarat: number | null; quantityIn: number | Prisma.Decimal; quantityOut: number | Prisma.Decimal; quantityLoss: number | Prisma.Decimal; unitPrice: number | null; date?: Date };
function parseMovement(body: any, existing?: { category: string; itemName: string; unit: string; goldKarat?: number | null; unitPrice?: Prisma.Decimal | null }): Movement | string {
  const category = String(body.category ?? existing?.category ?? 'GOLD').trim().toUpperCase();
  const itemName = String(body.itemName ?? existing?.itemName ?? '').trim();
  const unit = String(body.unit ?? existing?.unit ?? (category === 'GEMSTONES' ? 'carats' : category === 'BOXES' ? 'boxes' : category === 'TOOLS' || category === 'PACKAGING' || category === 'FINDINGS' ? 'pieces' : 'grams'));
  const quantityIn = body.quantityIn ?? body.goldIn ?? 0;
  const quantityOut = body.quantityOut ?? body.goldOut ?? 0;
  const quantityLoss = body.quantityLoss ?? body.scraps ?? body.scrap ?? 0;
  const unitPrice = body.unitPrice === undefined ? existing?.unitPrice === null ? null : existing?.unitPrice?.toString() : body.unitPrice;
  const goldKarat = body.goldKarat === undefined ? (existing?.goldKarat ?? null) : body.goldKarat === null || body.goldKarat === '' ? null : Number(body.goldKarat);
  if (!categories.includes(category as typeof categories[number])) return 'Choose a supported inventory category.';
  if (!unitsByCategory[category]?.includes(unit)) return `Choose a supported unit for ${category.toLowerCase()}.`;
  if (!itemName) return 'Enter an item description.';
  if (![quantityIn, quantityOut, quantityLoss].every(isNonNegativeNumber) || Number(quantityIn) + Number(quantityOut) + Number(quantityLoss) <= 0) return 'Enter a positive quantity for at least one movement.';
  if (unitPrice !== null && !isPositiveNumber(unitPrice)) return 'Unit price must be greater than zero, or leave it blank if unknown.';
  if (category === 'GOLD' && goldKarat === null && !existing) return 'Choose a gold karat from 10K to 24K.';
  if (['GOLD', 'SCRAP'].includes(category) && goldKarat !== null && (!Number.isInteger(goldKarat) || goldKarat < 10 || goldKarat > 24)) return 'Gold karat must be a whole number from 10K to 24K.';
  if (!['GOLD', 'SCRAP'].includes(category) && goldKarat !== null) return 'Karat can only be set for gold or scrap inventory.';
  if (body.date !== undefined && !isValidNonFutureDate(body.date)) return 'Inventory date must be a valid date no later than today.';
  return { category: category as Movement['category'], itemName, unit, goldKarat: ['GOLD', 'SCRAP'].includes(category) ? goldKarat : null, quantityIn: category === 'SCRAP' ? goldWeight(quantityIn) : Number(quantityIn), quantityOut: category === 'SCRAP' ? goldWeight(quantityOut) : Number(quantityOut), quantityLoss: category === 'SCRAP' ? goldWeight(quantityLoss) : Number(quantityLoss), unitPrice: unitPrice === null ? null : Number(unitPrice), ...(body.date ? { date: new Date(body.date) } : {}) };
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = parseMovement(req.body);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    const saved = await prisma.$transaction(async tx => {
      const created = await tx.inventory.create({ data: {
        referenceId: friendlyId(), universalReferenceId: friendlyId(), itemName: parsed.itemName, unit: parsed.unit, category: parsed.category, goldKarat: parsed.goldKarat,
        quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
        unitPrice: parsed.unitPrice,
        updatedAt: parsed.date ?? new Date(),
      } });
      await validateInventoryLedger(tx);
      const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
      const balances = calculateInventoryBalances(rows);
      const saved = rows.find(row => row.referenceId === created.referenceId)!;
      const balance = balances.get(created.referenceId) ?? 0;
      return { ...saved, ...scrapMetadata(saved), balance, totalGold: saved.category === 'GOLD' ? balance : 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.locals.auditRecordId = saved.referenceId;
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
    res.json(rows.map(row => ({ ...row, ...scrapMetadata(row), balance: balances.get(row.referenceId) ?? 0, totalGold: row.category === 'GOLD' ? balances.get(row.referenceId) ?? 0 : 0 })));
  } catch (error) { console.error('Error fetching inventory items:', error); res.status(500).json({ error: 'Inventory could not be loaded.' }); }
});

// Rename an entire stock group without changing quantities, prices or movement dates.
router.patch('/:referenceId/details', requireAdmin, async (req: Request, res: Response) => {
  const itemName = typeof req.body.itemName === 'string' ? req.body.itemName.trim() : '';
  if (!itemName || itemName.length > 120) return res.status(400).json({ error: 'Enter an item description with 120 characters or fewer.' });
  if (Object.keys(req.body).some(key => key !== 'itemName')) return res.status(400).json({ error: 'Only the item description can be changed here.' });
  try {
    const referenceId = String(req.params.referenceId);
    await prisma.$transaction(async tx => {
      const existing = await tx.inventory.findFirst({ where: { referenceId, deletedAt: null } });
      if (!existing) throw Object.assign(new Error('Inventory item was not found.'), { statusCode: 404 });
      const rows = await tx.inventory.findMany({ where: { deletedAt: null, category: existing.category } });
      const matches = (row: typeof existing) => existing.category === 'GOLD' ? row.goldKarat === existing.goldKarat
        : existing.category === 'SCRAP' || (row.unit === existing.unit && row.itemName.trim().toLowerCase() === existing.itemName.trim().toLowerCase());
      if (!['GOLD', 'SCRAP'].includes(existing.category) && rows.some(row => !matches(row) && row.unit === existing.unit && row.itemName.trim().toLowerCase() === itemName.toLowerCase()))
        throw Object.assign(new Error('Another item already has that description. Choose a different description.'), { statusCode: 409 });
      await tx.inventory.updateMany({ where: { referenceId: { in: rows.filter(matches).map(row => row.referenceId) } }, data: { itemName } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ referenceId, message: 'Item description updated. Stock quantities are unchanged.' });
  } catch (error) {
    console.error('Item details could not be updated:', error);
    res.status(Number((error as { statusCode?: number }).statusCode) || 500).json({ error: error instanceof Error ? error.message : 'Item details could not be updated.' });
  }
});

router.put('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const existing = await prisma.inventory.findFirst({ where: { referenceId: targetId, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Inventory entry not found or already archived.' });
    if (existing.jobCostId && ['GOLD', 'SCRAP'].includes(existing.category)) return res.status(409).json({ error: 'Edit the linked job costing to adjust this automatic movement.' });
    const parsed = parseMovement(req.body, existing);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    const saved = await prisma.$transaction(async tx => {
      await tx.inventory.update({ where: { referenceId: targetId }, data: {
        itemName: parsed.itemName, unit: parsed.unit, category: parsed.category, goldKarat: parsed.goldKarat,
        quantityIn: parsed.quantityIn, quantityOut: parsed.quantityOut, quantityLoss: parsed.quantityLoss,
        unitPrice: parsed.unitPrice,
        updatedAt: parsed.date ?? new Date(),
      } });
      await validateInventoryLedger(tx);
      const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
      const balances = calculateInventoryBalances(rows);
      const saved = rows.find(row => row.referenceId === targetId)!;
      const balance = balances.get(targetId) ?? 0;
      return { ...saved, ...scrapMetadata(saved), balance, totalGold: saved.category === 'GOLD' ? balance : 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json(saved);
  } catch (error) { console.error('Error updating inventory item:', error); const status = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 400); res.status(status).json({ error: error instanceof Error ? error.message : 'Inventory item could not be updated.' }); }
});

router.delete('/:referenceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const deleted = await prisma.$transaction(async tx => {
      const existing = await tx.inventory.findFirst({ where: { referenceId: targetId, deletedAt: null } });
      if (existing?.jobCostId && ['GOLD', 'SCRAP'].includes(existing.category)) throw Object.assign(new Error('Delete or edit the linked job costing to adjust this automatic movement.'), { statusCode: 409 });
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
