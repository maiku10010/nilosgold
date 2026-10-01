import { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isNonNegativeNumber, isPositiveNumber, isValidNonFutureDate } from '../validation';
import { receiptEmail, sendSystemEmail } from '../services/email';

const router = Router();
const serviceTypes = ['Custom', 'Repair', 'Resize', 'Cleaning'];
const saleIncludes = { client: true, job: { include: { inquiry: true } } } as const;

// Sales are opened when a pending inquiry is approved for costing. A new
// finished sale can only be completed through this transition endpoint.
router.post('/', (_req: Request, res: Response) => {
  res.status(409).json({ error: 'Create Daily Sales by finishing an approved job costing.' });
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const sales = await prisma.sales.findMany({ where: { deletedAt: null }, include: saleIncludes, orderBy: { salesDate: 'desc' } });
    res.json(sales);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Daily Sales could not be loaded.' });
  }
});

router.post('/:invoiceId/finish', async (req: Request, res: Response) => {
  try {
    const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
    const suppliedInvoice = typeof req.body.invoiceId === 'string' ? req.body.invoiceId : '';
    const clientName = typeof req.body.clientName === 'string' ? req.body.clientName.trim() : '';
    if (!suppliedInvoice || !clientName || suppliedInvoice !== invoiceId) {
      return res.status(400).json({ error: 'Confirm the exact client name and invoice number to finish this sale.' });
    }

    const sale = await prisma.$transaction(async (tx) => {
      const current = await tx.sales.findUnique({ where: { invoiceId }, include: { client: true, job: { include: { inquiry: true } } } });
      if (!current) throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
      if (current.deletedAt) throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
      if (current.client.clientName.trim().toLocaleLowerCase() !== clientName.toLocaleLowerCase()) {
        throw Object.assign(new Error('The client name and invoice number do not match.'), { statusCode: 409 });
      }
      if (current.status !== 'PENDING' || !current.job || current.job.deletedAt || !['APPROVED', 'READY_FOR_PICKUP'].includes(current.job.status)) {
        throw Object.assign(new Error('Only an approved job costing can be moved to Daily Sales.'), { statusCode: 409 });
      }

      const finished = await tx.sales.update({
        where: { invoiceId },
        data: { status: 'FINISHED', salesDate: new Date() },
      });
      await tx.job_Cost.update({ where: { jobCostId: current.job.jobCostId }, data: { status: 'FINISHED' } });
      if (current.job.inquiryId) {
        await tx.inquiries.update({ where: { inquiryId: current.job.inquiryId }, data: { status: 'FINISHED' } });
      }

      const otherSales = await tx.sales.findMany({
        where: { clientId: current.clientId, invoiceId: { not: invoiceId }, deletedAt: null },
        select: { price: true, downpayment: true },
      });
      const balance = otherSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.downpayment)), 0)
        + Math.max(0, Number(finished.price) - Number(finished.downpayment));
      await tx.client.update({ where: { clientId: current.clientId }, data: { balance } });

      return tx.sales.findUniqueOrThrow({ where: { invoiceId }, include: saleIncludes });
    });
    let notification: { sent: boolean; reason?: string } = { sent: false, reason: 'Customer email is missing.' };
    if (sale.receiptSentAt) notification = { sent: true, reason: 'Receipt email was already sent.' };
    else {
      notification = await sendSystemEmail(sale.client.email, `Official Receipt · ${sale.invoiceId}`, receiptEmail(sale), `official-receipt-${sale.invoiceId}`);
      if (notification.sent) {
        await prisma.sales.update({ where: { invoiceId: sale.invoiceId }, data: { receiptSentAt: new Date() } });
        sale.receiptSentAt = new Date();
      }
    }
    res.json({ ...sale, notification });
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error finishing sale:', error);
    res.status(500).json({ error: 'Sale could not be finished.' });
  }
});

router.put('/:invoiceId', async (req: Request, res: Response) => {
  try {
    const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
    const date = req.body.salesDate ?? req.body.date;
    const downpayment = Number(req.body.downpayment ?? 0);
    const price = Number(req.body.price);
    if (!isPositiveNumber(price) || !isNonNegativeNumber(downpayment) || downpayment > price) {
      return res.status(400).json({ error: 'Enter a valid price and a downpayment no greater than the total price.' });
    }
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Sale date must be a valid date no later than today.' });
    if (!serviceTypes.includes(req.body.serviceType)) return res.status(400).json({ error: 'Choose a valid service type.' });
    if (typeof req.body.clientName !== 'string' || req.body.invoiceId !== invoiceId) {
      return res.status(400).json({ error: 'The client name and invoice number are required to update a sale.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: { client: true } });
      if (!current) throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
      if (current.status === 'PENDING') throw Object.assign(new Error('Edit this invoice from its approved job costing.'), { statusCode: 409 });
      if (current.client.clientName.trim().toLocaleLowerCase() !== req.body.clientName.trim().toLocaleLowerCase()) {
        throw Object.assign(new Error('The client name and invoice number do not match.'), { statusCode: 409 });
      }

      await tx.sales.update({
        where: { invoiceId },
        data: {
          serviceType: req.body.serviceType,
          price,
          downpayment,
          ...(date ? { salesDate: new Date(`${date}T00:00:00`) } : {}),
          client: { update: {
            ...(typeof req.body.contactNum === 'string' ? { contactNum: req.body.contactNum.trim() } : {}),
          } },
        },
      });
      const outstandingSales = await tx.sales.findMany({
        where: { clientId: current.clientId, deletedAt: null },
        select: { price: true, downpayment: true },
      });
      const updatedAmounts = await tx.sales.findMany({ where: { clientId: current.clientId, deletedAt: null }, select: { price: true, downpayment: true } });
      await tx.client.update({ where: { clientId: current.clientId }, data: {
        clientName: req.body.clientName.trim(),
        balance: updatedAmounts.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.downpayment)), 0),
      } });
      return tx.sales.findUniqueOrThrow({ where: { invoiceId }, include: saleIncludes });
    });
    res.json(updated);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'Sale could not be updated.' });
  }
});

router.delete('/:invoiceId', async (req: Request, res: Response) => {
  try {
    const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
    await prisma.$transaction(async (tx) => {
      const sale = await tx.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: { job: true } });
      if (!sale) throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
      if (sale.job) {
        const inquiryId = sale.job.inquiryId;
        await tx.sales.update({ where: { invoiceId }, data: { deletedAt: new Date() } });
        await tx.job_Cost.update({ where: { jobCostId: sale.job.jobCostId }, data: { deletedAt: new Date(), inquiryId: null } });
        if (inquiryId) await tx.inquiries.update({ where: { inquiryId }, data: { status: 'PENDING' } });
      } else {
        await tx.sales.update({ where: { invoiceId }, data: { deletedAt: new Date() } });
      }
      const remainingSales = await tx.sales.findMany({ where: { clientId: sale.clientId, deletedAt: null }, select: { price: true, downpayment: true } });
      await tx.client.update({ where: { clientId: sale.clientId }, data: {
        balance: remainingSales.reduce((sum, item) => sum + Math.max(0, Number(item.price) - Number(item.downpayment)), 0),
      } });
    });
    res.json({ message: 'Sale deleted; its inquiry has been reopened when applicable.' });
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error deleting sale:', error);
    res.status(500).json({ error: 'Sale could not be deleted.' });
  }
});

export default router;
