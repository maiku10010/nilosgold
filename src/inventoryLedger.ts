import { Prisma } from '@prisma/client';
import { friendlyId } from './friendlyId';

export async function recalculateInventory(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.inventory.findMany({ where: { deletedAt: null }, orderBy: [{ updatedAt: 'asc' }, { referenceId: 'asc' }] });
  const balances = new Map<string, number>();
  for (const row of rows) {
    const gold = row.category === 'GOLD';
    const key = gold ? 'GOLD:grams' : `${row.category}:${row.unit}:${row.itemName.trim().toLowerCase()}`;
    const factor = gold && row.unit === 'troy oz' ? 31.1034768 : 1;
    const balance = (balances.get(key) ?? 0) + (Number(row.quantityIn) - Number(row.quantityOut) - Number(row.quantityLoss)) * factor;
    if (balance < -0.000001) throw Object.assign(new Error(`Insufficient ${row.category.toLowerCase()} stock for ${row.itemName} (${row.unit}).`), { statusCode: 409 });
    const next = Math.max(0, balance); balances.set(key, next);
    const displayBalance = next / factor;
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
