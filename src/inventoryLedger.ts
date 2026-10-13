import { Prisma } from '@prisma/client';
import { friendlyId } from './friendlyId';

type InventoryMovement = {
  referenceId: string;
  category: string;
  itemName: string;
  unit: string;
  quantityIn: number | Prisma.Decimal;
  quantityOut: number | Prisma.Decimal;
  quantityLoss: number | Prisma.Decimal;
};

const movementKey = (row: InventoryMovement) => row.category === 'GOLD'
  ? 'GOLD:grams'
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
      throw Object.assign(new Error(`Insufficient ${row.category.toLowerCase()} stock for ${row.itemName} (${row.unit}).`), { statusCode: 409 });
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

export async function recalculateInventory(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
  const balances = calculateInventoryBalances(rows);
  for (const row of rows) {
    const gold = row.category === 'GOLD';
    const displayBalance = balances.get(row.referenceId) ?? 0;
    await tx.inventory.update({ where: { referenceId: row.referenceId }, data: { balance: displayBalance, totalGold: gold ? displayBalance : 0 } });
  }
}

export async function syncInventoryExpense(tx: Prisma.TransactionClient, movement: {
  referenceId: string; category: string; itemName: string; unit: string; quantityIn: number | Prisma.Decimal; unitPrice: number | Prisma.Decimal; updatedAt: Date; deletedAt?: Date | null;
}): Promise<void> {
  const existing = await tx.expenses.findUnique({ where: { inventoryReferenceId: movement.referenceId } });
  const amount = Number(movement.quantityIn) * Number(movement.unitPrice);
  if (movement.deletedAt || amount <= 0) {
    if (existing && !existing.deletedAt) await tx.expenses.update({ where: { expenseId: existing.expenseId }, data: { deletedAt: new Date() } });
    return;
  }
  const data = {
    category: `Inventory · ${movement.category}`,
    amount,
    description: `Purchase: ${movement.itemName} (${movement.quantityIn} ${movement.unit}) at ${Number(movement.unitPrice).toFixed(2)} per ${movement.unit}`,
    expDate: movement.updatedAt,
    deletedAt: null,
  };
  if (existing) await tx.expenses.update({ where: { expenseId: existing.expenseId }, data });
  else await tx.expenses.create({ data: { expenseId: friendlyId(), ...data, inventoryReferenceId: movement.referenceId } });
}
