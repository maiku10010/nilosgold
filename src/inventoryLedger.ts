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

const movementKey = (row: InventoryMovement) => row.category === 'GOLD'
  ? `GOLD:${row.goldKarat ?? 'unknown'}:grams`
  : `${row.category}:${row.unit}:${row.itemName.trim().toLowerCase()}`;
const movementFactor = (row: InventoryMovement) => row.category === 'GOLD' && row.unit === 'troy oz' ? 31.1034768 : 1;

export function calculateInventoryBalances(rows: InventoryMovement[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = movementKey(row);
    const change = (Number(row.quantityIn) - Number(row.quantityOut) - Number(row.quantityLoss)) * movementFactor(row);
    totals.set(key, (totals.get(key) ?? 0) + change);
  }
  for (const [key, total] of totals) {
    if (total < -0.000001) {
      const row = rows.find(candidate => movementKey(candidate) === key)!;
      const product = row.category === 'GOLD' && row.goldKarat ? `${row.goldKarat}K gold` : `${row.category.toLowerCase()} stock for ${row.itemName}`;
      throw Object.assign(new Error(`Insufficient ${product} (${row.unit}).`), { statusCode: 409 });
    }
  }

  const running = new Map<string, number>();
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = movementKey(row);
    const factor = movementFactor(row);
    const balance = (running.get(key) ?? 0) + (Number(row.quantityIn) - Number(row.quantityOut) - Number(row.quantityLoss)) * factor;
    running.set(key, balance);
    result.set(row.referenceId, balance / factor);
  }
  return result;
}

export async function validateInventoryLedger(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
  calculateInventoryBalances(rows);
}
