"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paidTotal = paidTotal;
exports.withSaleTotals = withSaleTotals;
exports.clientBalance = clientBalance;
exports.setSalePaidTotal = setSalePaidTotal;
const friendlyId_1 = require("./friendlyId");
function paidTotal(payments) {
    return payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
}
function withSaleTotals(sale) {
    const payment = paidTotal(sale.payments);
    return { ...sale, payment, outstanding: sale.price == null ? null : Math.max(0, Number(sale.price) - payment) };
}
function clientBalance(sales) {
    return sales.reduce((sum, sale) => sum + (sale.price == null ? 0 : Math.max(0, Number(sale.price) - paidTotal(sale.payments))), 0);
}
async function setSalePaidTotal(tx, invoiceId, target) {
    const payments = await tx.salePayment.findMany({ where: { invoiceId }, orderBy: [{ paidAt: 'desc' }, { paymentNumber: 'desc' }] });
    let difference = target - paidTotal(payments);
    if (Math.abs(difference) < 0.005)
        return;
    if (difference > 0) {
        await tx.salePayment.create({ data: { paymentId: (0, friendlyId_1.friendlyId)(), invoiceId, amount: difference, paidAt: new Date(), method: 'Adjustment' } });
        return;
    }
    let reduction = -difference;
    for (const payment of payments) {
        if (reduction <= 0)
            break;
        const amount = Number(payment.amount);
        if (amount <= reduction + 0.005) {
            await tx.salePayment.delete({ where: { paymentId: payment.paymentId } });
            reduction -= amount;
        }
        else {
            await tx.salePayment.update({ where: { paymentId: payment.paymentId }, data: { amount: amount - reduction } });
            reduction = 0;
        }
    }
}
