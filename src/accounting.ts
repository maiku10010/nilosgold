import { Prisma } from '@prisma/client';
import { friendlyId } from './friendlyId';

export function paidTotal(payments: Array<{ amount: Prisma.Decimal | number }>): number {
  return payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
}

export function withSaleTotals<T extends { price: Prisma.Decimal | number; payments: Array<{ amount: Prisma.Decimal | number }> }>(sale: T) {
  const payment = paidTotal(sale.payments);
  return { ...sale, payment, outstanding: Math.max(0, Number(sale.price) - payment) };
}

export function clientBalance(sales: Array<{ price: Prisma.Decimal | number; payments: Array<{ amount: Prisma.Decimal | number }> }>): number {
  return sales.reduce((sum, sale) => sum + Math.max(0, Number(sale.price) - paidTotal(sale.payments)), 0);
}

export async function setSalePaidTotal(tx: Prisma.TransactionClient, invoiceId: string, target: number): Promise<void> {
  const payments = await tx.salePayment.findMany({ where: { invoiceId }, orderBy: [{ paidAt: 'desc' }, { paymentNumber: 'desc' }] });
  let difference = target - paidTotal(payments);
  if (Math.abs(difference) < 0.005) return;
  if (difference > 0) {
    await tx.salePayment.create({ data: { paymentId: friendlyId(), invoiceId, amount: difference, paidAt: new Date(), method: 'Adjustment' } });
    return;
  }
  let reduction = -difference;
  for (const payment of payments) {
    if (reduction <= 0) break;
    const amount = Number(payment.amount);
    if (amount <= reduction + 0.005) {
      await tx.salePayment.delete({ where: { paymentId: payment.paymentId } });
      reduction -= amount;
    } else {
      await tx.salePayment.update({ where: { paymentId: payment.paymentId }, data: { amount: amount - reduction } });
      reduction = 0;
    }
  }
}
