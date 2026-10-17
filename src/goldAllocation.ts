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
  goldSourceId: unknown; goldUsed: Prisma.Decimal; goldScrap: Prisma.Decimal;
  goldCostPerG: number; jobCostId: string; universalReferenceId: string | null;
}) {
  if (typeof input.goldSourceId !== 'string' || !input.goldSourceId) {
    throw Object.assign(new Error('Choose a gold source.'), { statusCode: 400, field: 'goldSourceId' });
  }
  const source = await tx.inventory.findFirst({ where: { referenceId: input.goldSourceId, category: 'GOLD', deletedAt: null, quantityIn: { gt: 0 } } });
  if (!source || source.goldKarat == null) throw Object.assign(new Error('Choose an active gold source with a recorded karat.'), { statusCode: 400, field: 'goldSourceId' });
  const rows = await tx.inventory.findMany({ where: { category: 'GOLD', goldKarat: source.goldKarat, deletedAt: null } });
  const available = rows.filter(row => row.jobCostId !== input.jobCostId).reduce((sum, row) =>
    sum.plus(new Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(row.unit === 'troy oz' ? '31.1034768' : '1')), new Prisma.Decimal(0));
  const required = input.goldUsed.plus(input.goldScrap);
  const name = goldSourceName(source.goldKarat);
  if (required.greaterThan(available)) {
    throw Object.assign(new Error(`Insufficient ${name}: used + scrap is ${required.toString()} g; available is ${Prisma.Decimal.max(0, available).toString()} g.`), { statusCode: 409, field: 'goldUsed' });
  }
  const movements = await tx.inventory.findMany({ where: { jobCostId: input.jobCostId, category: 'GOLD' } });
  const current = movements[0];
  // Retain one allocation per job; old/deleted allocations must not deduct twice.
  if (movements.length > 1) await tx.inventory.updateMany({ where: { referenceId: { in: movements.slice(1).map(row => row.referenceId) } }, data: { deletedAt: new Date() } });
  const data = {
    itemName: source.itemName, goldKarat: source.goldKarat, unit: 'grams', category: 'GOLD' as const,
    quantityIn: new Prisma.Decimal(0), quantityOut: input.goldUsed, quantityLoss: input.goldScrap,
    unitPrice: input.goldCostPerG, deletedAt: required.isZero() ? new Date() : null,
  };
  if (current) await tx.inventory.update({ where: { referenceId: current.referenceId }, data });
  else if (!required.isZero()) await tx.inventory.create({ data: {
    ...data, referenceId: friendlyId(), universalReferenceId: input.universalReferenceId, jobCostId: input.jobCostId,
  } });
  await tx.job_Cost.update({ where: { jobCostId: input.jobCostId }, data: { goldKarat: source.goldKarat } });
  return source.goldKarat;
}
