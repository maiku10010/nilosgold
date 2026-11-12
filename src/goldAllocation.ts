import { Prisma } from '@prisma/client';
import { friendlyId } from './friendlyId';

export function goldWeight(value: unknown): Prisma.Decimal {
  try {
    const weight = new Prisma.Decimal(String(value ?? 0));
    if (!weight.isFinite() || weight.isNegative() || weight.decimalPlaces() > 3) throw new Error();
    return weight;
  } catch {
    throw Object.assign(new Error('Enter a non-negative gold weight with at most 3 decimal places.'), { statusCode: 400, field: 'goldUsed' });
  }
}

export const goldSourceName = (karat: number | null) => karat == null ? 'Gold (karat unspecified)' : `Gold · ${karat}K`;

export function goldMaterialCost(used: Prisma.Decimal | string | number, scrap: Prisma.Decimal | string | number, rate: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(used).plus(scrap).times(rate).toDecimalPlaces(2);
}

export async function syncGoldAllocation(tx: Prisma.TransactionClient, input: {
  serviceType?: string; goldSourceId: unknown; goldUsed: Prisma.Decimal; goldScrap: Prisma.Decimal;
  goldCostPerG: number; jobCostId: string; universalReferenceId: string | null;
}) {
  if (input.goldSourceId === 'CUSTOMER_GOLD') {
    await releaseGoldAllocation(tx, input.jobCostId);
    await tx.job_Cost.update({ where: { jobCostId: input.jobCostId }, data: { customerGold: true } });
    return null;
  }
  if (input.serviceType && input.serviceType !== 'Custom' && (input.goldSourceId == null || input.goldSourceId === '')) {
    await releaseGoldAllocation(tx, input.jobCostId);
    return null;
  }
  if (typeof input.goldSourceId !== 'string' || !input.goldSourceId) {
    throw Object.assign(new Error('Choose a gold source.'), { statusCode: 400, field: 'goldSourceId' });
  }
  const source = await tx.inventory.findFirst({ where: { referenceId: input.goldSourceId, category: 'GOLD', deletedAt: null, quantityIn: { gt: 0 } } });
  if (!source || source.goldKarat == null) throw Object.assign(new Error('Choose an active gold source with a recorded karat.'), { statusCode: 400, field: 'goldSourceId' });
  const rows = await tx.inventory.findMany({ where: { category: 'GOLD', goldKarat: source.goldKarat, deletedAt: null } });
  const available = rows.filter(row => row.jobCostId !== input.jobCostId).reduce((sum, row) =>
    sum.plus(new Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(row.unit === 'troy oz' ? '31.1034768' : '1')), new Prisma.Decimal(0));
  const required = input.goldUsed;
  const name = goldSourceName(source.goldKarat);
  if (required.greaterThan(available)) {
    throw Object.assign(new Error(`Insufficient ${name}: gold used is ${required.toString()} g; available is ${Prisma.Decimal.max(0, available).toString()} g.`), { statusCode: 409, field: 'goldUsed' });
  }
  const movements = await tx.inventory.findMany({ where: { jobCostId: input.jobCostId, category: 'GOLD' } });
  const current = movements[0];
  // Retain one allocation per job; old/deleted allocations must not deduct twice.
  if (movements.length > 1) await tx.inventory.updateMany({ where: { referenceId: { in: movements.slice(1).map(row => row.referenceId) } }, data: { deletedAt: new Date() } });
  const data = {
    itemName: source.itemName, goldKarat: source.goldKarat, unit: 'grams', category: 'GOLD' as const,
    quantityIn: new Prisma.Decimal(0), quantityOut: input.goldUsed, quantityLoss: new Prisma.Decimal(0),
    unitPrice: input.goldCostPerG, deletedAt: required.isZero() ? new Date() : null,
  };
  if (current) await tx.inventory.update({ where: { referenceId: current.referenceId }, data });
  else if (!required.isZero()) await tx.inventory.create({ data: {
    ...data, referenceId: friendlyId(), universalReferenceId: input.universalReferenceId, jobCostId: input.jobCostId,
  } });
  // Recovered scrap is a separate stock pool, never usable gold stock.
  await syncScrapRecovery(tx, input.jobCostId, source.goldKarat, input.goldScrap);
  await tx.job_Cost.update({ where: { jobCostId: input.jobCostId }, data: { goldKarat: source.goldKarat, customerGold: false } });
  return source.goldKarat;
}

type ScrapSnapshot = { category: string; goldKarat?: number | null; quantityIn: Prisma.Decimal | string | number; quantityOut: Prisma.Decimal | string | number; quantityLoss: Prisma.Decimal | string | number; deletedAt?: unknown };

function scrapBalances(rows: ScrapSnapshot[]) {
  const totals = new Map<number | null, Prisma.Decimal>();
  for (const row of rows) {
    if (row.category !== 'SCRAP' || row.deletedAt) continue;
    const karat = row.goldKarat ?? null;
    totals.set(karat, (totals.get(karat) ?? new Prisma.Decimal(0)).plus(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss));
  }
  return totals;
}

async function correctScrapBalances(tx: Prisma.TransactionClient, jobCostId: string, targets: Map<number | null, Prisma.Decimal>) {
  const current = scrapBalances(await tx.inventory.findMany({ where: { jobCostId, category: 'SCRAP', deletedAt: null } }));
  for (const karat of new Set([...current.keys(), ...targets.keys()])) {
    const delta = (targets.get(karat) ?? new Prisma.Decimal(0)).minus(current.get(karat) ?? 0);
    if (delta.isZero()) continue;
    // Append corrections: the original recovery and its source purity remain reviewable.
    await tx.inventory.create({ data: {
      referenceId: friendlyId(), jobCostId, universalReferenceId: jobCostId,
      itemName: 'Scrap gold', category: 'SCRAP', unit: 'grams', goldKarat: karat,
      quantityIn: delta.isPositive() ? delta : new Prisma.Decimal(0),
      quantityOut: delta.isNegative() ? delta.abs() : new Prisma.Decimal(0),
      quantityLoss: new Prisma.Decimal(0), unitPrice: 0,
    } });
  }
}

export async function syncScrapRecovery(tx: Prisma.TransactionClient, jobCostId: string, karat: number | null, quantity: Prisma.Decimal) {
  await correctScrapBalances(tx, jobCostId, new Map([[karat, quantity]]));
}

export async function restoreScrapRecovery(tx: Prisma.TransactionClient, jobCostId: string, snapshot: ScrapSnapshot[]) {
  await correctScrapBalances(tx, jobCostId, scrapBalances(snapshot));
}

/** Reverse recovered scrap while retaining its history; archive the other job deductions. */
export async function reverseJobInventory(tx: Prisma.TransactionClient, jobCostId: string) {
  await syncScrapRecovery(tx, jobCostId, null, new Prisma.Decimal(0));
  await tx.inventory.updateMany({ where: { jobCostId, category: { not: 'SCRAP' }, deletedAt: null }, data: { deletedAt: new Date() } });
}

export async function releaseGoldAllocation(tx: Prisma.TransactionClient, jobCostId: string) {
  await syncScrapRecovery(tx, jobCostId, null, new Prisma.Decimal(0));
  await tx.inventory.updateMany({ where: { jobCostId, category: 'GOLD' }, data: { deletedAt: new Date() } });
  await tx.job_Cost.update({ where: { jobCostId }, data: { goldKarat: null, customerGold: false } });
}
