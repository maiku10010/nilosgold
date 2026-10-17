import { Prisma } from '@prisma/client';

type InventoryMovement = {
  referenceId: string;
  category: string;
  goldKarat?: number | null;
  itemName: string;
  unit: string;
  quantityIn: number | Prisma.Decimal;
  quantityOut: number | Prisma.Decimal;
  quantityLoss: number | Prisma.Decimal;
};

const movementKey = (row: InventoryMovement) => row.category === 'SCRAP' ? 'SCRAP:grams' : row.category === 'GOLD'
  ? `${row.category}:${row.goldKarat ?? 'unknown'}:grams`
  : `${row.category}:${row.unit}:${row.itemName.trim().toLowerCase()}`;
const movementFactor = (row: InventoryMovement) => new Prisma.Decimal(row.category === 'GOLD' && row.unit === 'troy oz' ? '31.1034768' : '1');

export function calculateInventoryBalances(rows: InventoryMovement[]): Map<string, number> {
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    const key = movementKey(row);
    const change = new Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(movementFactor(row));
    totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(change));
  }
  for (const [key, total] of totals) {
    if (total.isNegative()) {
      const row = rows.find(candidate => movementKey(candidate) === key)!;
      const product = row.category === 'GOLD' ? row.goldKarat ? `Gold · ${row.goldKarat}K` : 'Gold (karat unspecified)' : row.itemName;
      throw Object.assign(new Error(`Insufficient ${product} (${row.unit}).`), { statusCode: 409 });
    }
  }

  const running = new Map<string, Prisma.Decimal>();
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = movementKey(row);
    const factor = movementFactor(row);
    const balance = (running.get(key) ?? new Prisma.Decimal(0)).plus(new Prisma.Decimal(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss).times(factor));
    running.set(key, balance);
    result.set(row.referenceId, balance.div(factor).toNumber());
  }
  return result;
}

export async function validateInventoryLedger(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
  calculateInventoryBalances(rows);
}
