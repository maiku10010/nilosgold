import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { friendlyId } from '../friendlyId';
import { isNonNegativeNumber, isPositiveNumber } from '../validation';
import { readyEmail, sendSystemEmail } from '../services/email';
import { recalculateInventory } from '../inventoryLedger';

const router = Router();
const serviceTypes = ['Custom', 'Repair', 'Resize', 'Cleaning'];
const includeJob = {
  employee: { select: { empId: true, empName: true, empRole: true } },
  inquiry: true,
  sales: { include: { client: true } },
} as const;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { inquiryId, clientName, contactNum, empId, serviceType, itemName, deadline, deliveryDate } = req.body;
    const requestedDeadline = deadline ?? deliveryDate;
    if (itemName !== undefined && itemName !== null && (typeof itemName !== 'string' || itemName.trim().length > 120)) return res.status(400).json({ error: 'Item name must be 120 characters or fewer.' });
    if (requestedDeadline !== undefined && requestedDeadline !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDeadline)) || Number.isNaN(new Date(`${requestedDeadline}T00:00:00Z`).getTime()))) return res.status(400).json({ error: 'Enter a valid delivery date.' });
    const goldUsed = Number(req.body.goldUsed);
    const goldScrap = Number(req.body.goldScrap ?? 0);
    const goldCostPerG = Number(Number(req.body.goldCostPerG).toFixed(2));
    const stoneCost = Number(req.body.stoneCost ?? 0);
    const laborCost = Number(req.body.laborCost);
    const sellingPrice = Number(req.body.sellingPrice);

    if (typeof inquiryId !== 'string' || !inquiryId || typeof clientName !== 'string' || !clientName.trim()) {
      return res.status(400).json({ error: 'Choose a pending inquiry and confirm the client name.' });
    }
    if (!serviceTypes.includes(serviceType)) return res.status(400).json({ error: 'Choose a valid service type.' });
    if (![goldUsed, goldScrap, stoneCost, laborCost].every(isNonNegativeNumber) || !isPositiveNumber(goldCostPerG) || !isPositiveNumber(sellingPrice)) {
      return res.status(400).json({ error: 'Enter non-negative costs, a gold price per gram, and a selling price greater than zero.' });
    }

    const jobCost = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.inquiries.findFirst({ where: { inquiryId, deletedAt: null }, include: { jobCost: true, client: true } });
      if (!inquiry) throw Object.assign(new Error('Inquiry not found or already archived.'), { statusCode: 404 });
      if (inquiry.status !== 'PENDING' || (inquiry.jobCost && !inquiry.jobCost.deletedAt)) throw Object.assign(new Error('Only pending inquiries can be sent to job costing.'), { statusCode: 409 });
      // A soft-deleted costing must release the inquiry's unique one-to-one link
      // so the customer can be costed again while retaining the old record.
      if (inquiry.jobCost?.deletedAt) await tx.job_Cost.update({ where: { jobCostId: inquiry.jobCost.jobCostId }, data: { inquiryId: null } });
      if (inquiry.customerName.trim().toLocaleLowerCase() !== clientName.trim().toLocaleLowerCase()) {
        throw Object.assign(new Error('The client name must match the selected inquiry.'), { statusCode: 400 });
      }

      const employee = empId
        ? await tx.employee.findFirst({ where: { empId, deletedAt: null }, select: { empId: true } })
        : await tx.employee.findFirst({ where: { deletedAt: null }, select: { empId: true } });
      if (!employee) throw Object.assign(new Error('Assign an existing employee before approving job costing.'), { statusCode: 409 });

      let client = inquiry.client;
      const normalizedContact = typeof contactNum === 'string' && contactNum.trim() ? contactNum.trim() : null;
      if (!client) {
        client = await tx.client.findFirst({
            where: { clientName: { equals: inquiry.customerName, mode: 'insensitive' }, contactNum: normalizedContact, deletedAt: null },
        });
      }
      if (client && inquiry.email && client.email !== inquiry.email) {
        client = await tx.client.update({ where: { clientId: client.clientId }, data: { email: inquiry.email } });
      }
      if (!client) {
        client = await tx.client.create({
          data: {
            clientId: friendlyId(),
            clientName: inquiry.customerName.trim(),
            contactNum: normalizedContact,
            email: inquiry.email,
            balance: 0,
          },
        });
      }

      const createdJob = await tx.job_Cost.create({
        data: {
          jobCostId: friendlyId(),
          universalReferenceId: inquiry.universalReferenceId ?? inquiry.inquiryId,
          itemName: typeof itemName === 'string' && itemName.trim() ? itemName.trim() : null,
          ...(requestedDeadline ? { deadline: new Date(`${requestedDeadline}T00:00:00Z`) } : {}),
          goldUsed,
          goldScrap,
          goldCostPerG: Number(Number(goldCostPerG).toFixed(2)),
          stoneCost,
          laborCost,
          status: 'PENDING',
          employee: { connect: { empId: employee.empId } },
          inquiry: { connect: { inquiryId } },
        },
      });
      if (goldUsed + goldScrap > 0) {
        await tx.inventory.create({ data: {
          referenceId: friendlyId(), universalReferenceId: createdJob.universalReferenceId, itemName: createdJob.itemName || 'Job costing gold', unit: 'grams', category: 'GOLD',
          quantityOut: goldUsed, quantityLoss: goldScrap, goldOut: goldUsed, scraps: goldScrap,
          unitPrice: goldCostPerG, jobCostId: createdJob.jobCostId,
        } });
        await recalculateInventory(tx);
      }
      const sale = await tx.sales.create({
        data: {
          invoiceId: friendlyId(),
          universalReferenceId: createdJob.universalReferenceId,
          serviceType,
          price: sellingPrice,
          downpayment: 0,
          status: 'PENDING',
          client: { connect: { clientId: client.clientId } },
          job: { connect: { jobCostId: createdJob.jobCostId } },
        },
      });
      await tx.inquiries.update({
        where: { inquiryId },
        data: { status: 'APPROVED', client: { connect: { clientId: client.clientId } } },
      });

      return tx.job_Cost.findUniqueOrThrow({ where: { jobCostId: createdJob.jobCostId }, include: includeJob });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(201).json(jobCost);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 0);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error creating job costing:', error);
    res.status(500).json({ error: 'Job costing could not be saved.' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const jobCosts = await prisma.job_Cost.findMany({ where: { deletedAt: null }, include: includeJob, orderBy: { jobDate: 'desc' } });
    res.json(jobCosts);
  } catch (error) {
    console.error('Error fetching job costing:', error);
    res.status(500).json({ error: 'Job costing could not be loaded.' });
  }
});

router.post('/:jobCostId/approve', async (req: Request, res: Response) => {
  const jobCostId = Array.isArray(req.params.jobCostId) ? req.params.jobCostId[0] : req.params.jobCostId;
  try {
    const approved = await prisma.$transaction(async tx => {
      const current = await tx.job_Cost.findFirst({ where: { jobCostId, deletedAt: null }, include: { sales: true } });
      if (!current) throw Object.assign(new Error('Job costing record not found.'), { statusCode: 404 });
      if (current.status !== 'PENDING' || !current.sales || current.sales.deletedAt) throw Object.assign(new Error('Only a pending costing with an active invoice can be approved.'), { statusCode: 409 });
      await tx.job_Cost.update({ where: { jobCostId }, data: { status: 'APPROVED' } });
      return tx.job_Cost.findUniqueOrThrow({ where: { jobCostId }, include: includeJob });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json(approved);
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status) return res.status(status).json({ error: (error as Error).message });
    console.error('Could not approve job costing:', error);
    res.status(500).json({ error: 'Job costing could not be approved.' });
  }
});

router.post('/:jobCostId/ready', async (req: Request, res: Response) => {
  const jobCostId = Array.isArray(req.params.jobCostId) ? req.params.jobCostId[0] : req.params.jobCostId;
  try {
    const job = await prisma.$transaction(async tx => {
      const current = await tx.job_Cost.findFirst({ where: { jobCostId, deletedAt: null }, include: { sales: { include: { client: true } } } });
      if (!current || !current.sales || current.sales.deletedAt) throw Object.assign(new Error('Active job costing and invoice were not found.'), { statusCode: 404 });
      if (!['APPROVED', 'IN_PROGRESS', 'READY_FOR_PICKUP'].includes(current.status)) throw Object.assign(new Error('Approve the job costing before marking it ready.'), { statusCode: 409 });
      if (current.status !== 'READY_FOR_PICKUP') await tx.job_Cost.update({ where: { jobCostId }, data: { status: 'READY_FOR_PICKUP' } });
      return tx.job_Cost.findUniqueOrThrow({ where: { jobCostId }, include: { sales: { include: { client: true } } } });
    });
    if (job.readyNotifiedAt) { res.json({ job, notification: { sent: true, reason: 'A pickup notification was already sent.' } }); return; }
    const result = await sendSystemEmail(job.sales?.client.email, `Your item is ready · ${job.sales?.invoiceId}`, readyEmail(job as any), `ready-for-pickup-${job.jobCostId}`);
    if (result.sent) await prisma.job_Cost.update({ where: { jobCostId }, data: { readyNotifiedAt: new Date() } });
    res.json({ job: await prisma.job_Cost.findUniqueOrThrow({ where: { jobCostId }, include: includeJob }), notification: result });
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status) return res.status(status).json({ error: (error as Error).message });
    console.error('Could not notify customer that the item is ready:', error);
    res.status(500).json({ error: 'Item is ready, but the notification could not be sent.' });
  }
});

router.put('/:jobCostId', async (req: Request, res: Response) => {
  try {
    const jobCostId = Array.isArray(req.params.jobCostId) ? req.params.jobCostId[0] : req.params.jobCostId;
    const goldUsed = Number(req.body.goldUsed);
    const goldScrap = Number(req.body.goldScrap ?? 0);
    const goldCostPerG = Number(Number(req.body.goldCostPerG).toFixed(2));
    const stoneCost = Number(req.body.stoneCost ?? 0);
    const laborCost = Number(req.body.laborCost);
    const sellingPrice = Number(req.body.sellingPrice);
    const requestedDeadline = req.body.deadline ?? req.body.deliveryDate;
    if (req.body.itemName !== undefined && req.body.itemName !== null && (typeof req.body.itemName !== 'string' || req.body.itemName.trim().length > 120)) return res.status(400).json({ error: 'Item name must be 120 characters or fewer.' });
    if (requestedDeadline !== undefined && requestedDeadline !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDeadline)) || Number.isNaN(new Date(`${requestedDeadline}T00:00:00Z`).getTime()))) return res.status(400).json({ error: 'Enter a valid delivery date.' });
    if (![goldUsed, goldScrap, stoneCost, laborCost].every(isNonNegativeNumber) || !isPositiveNumber(goldCostPerG) || !isPositiveNumber(sellingPrice)) {
      return res.status(400).json({ error: 'Enter non-negative costs, a gold price per gram, and a selling price greater than zero.' });
    }
    if (typeof req.body.invoiceId !== 'string' || typeof req.body.clientName !== 'string') {
      return res.status(400).json({ error: 'The invoice number and client name are required to update job costing.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.job_Cost.findFirst({ where: { jobCostId, deletedAt: null }, include: { sales: { include: { client: true } } } });
      if (!existing) throw Object.assign(new Error('Job costing record not found.'), { statusCode: 404 });
      if (!existing.sales) throw Object.assign(new Error('This costing has no linked invoice.'), { statusCode: 409 });
      const movement = await tx.inventory.findFirst({ where: { jobCostId, category: 'GOLD' } });
      if ((goldUsed + goldScrap > 0) || movement) {
        if (movement) await tx.inventory.update({ where: { referenceId: movement.referenceId }, data: {
          itemName: typeof req.body.itemName === 'string' && req.body.itemName.trim() ? req.body.itemName.trim() : existing.itemName || 'Job costing gold', unit: 'grams', category: 'GOLD', quantityIn: 0,
          quantityOut: goldUsed, quantityLoss: goldScrap, goldIn: 0, goldOut: goldUsed, scraps: goldScrap,
          unitPrice: goldCostPerG, updatedAt: new Date(), deletedAt: goldUsed + goldScrap > 0 ? null : new Date(),
        } });
        else await tx.inventory.create({ data: {
          referenceId: friendlyId(), universalReferenceId: existing.universalReferenceId, itemName: typeof req.body.itemName === 'string' && req.body.itemName.trim() ? req.body.itemName.trim() : existing.itemName || 'Job costing gold', unit: 'grams', category: 'GOLD',
          quantityOut: goldUsed, quantityLoss: goldScrap, goldOut: goldUsed, scraps: goldScrap,
          unitPrice: goldCostPerG, jobCostId,
        } });
        await recalculateInventory(tx);
      }
      const namesMatch = existing.sales.client.clientName.trim().toLocaleLowerCase() === req.body.clientName.trim().toLocaleLowerCase();
      if (existing.sales.invoiceId !== req.body.invoiceId || !namesMatch) {
        throw Object.assign(new Error('The client name and invoice number must match this costing.'), { statusCode: 409 });
      }
      if (req.body.empId && req.body.empId !== existing.empId) {
        const employee = await tx.employee.findFirst({ where: { empId: req.body.empId, deletedAt: null }, select: { empId: true } });
        if (!employee) throw Object.assign(new Error('Choose an existing employee.'), { statusCode: 400 });
      }

      await tx.job_Cost.update({
        where: { jobCostId },
        data: {
          goldUsed,
          goldScrap,
          goldCostPerG,
          stoneCost,
          laborCost,
          ...(req.body.itemName !== undefined ? { itemName: typeof req.body.itemName === 'string' && req.body.itemName.trim() ? req.body.itemName.trim() : null } : {}),
          ...(requestedDeadline !== undefined ? { deadline: requestedDeadline ? new Date(`${requestedDeadline}T00:00:00Z`) : null } : {}),
          ...(req.body.empId ? { empId: req.body.empId } : {}),
        },
      });
      await tx.sales.update({ where: { invoiceId: existing.sales.invoiceId }, data: { price: sellingPrice } });
      if (existing.sales.status === 'FINISHED') {
        const otherSales = await tx.sales.findMany({
          where: { clientId: existing.sales.clientId, invoiceId: { not: existing.sales.invoiceId } },
          select: { price: true, downpayment: true },
        });
        await tx.client.update({
          where: { clientId: existing.sales.clientId },
          data: { balance: otherSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.price) - Number(sale.downpayment)), Math.max(0, sellingPrice - Number(existing.sales.downpayment))) },
        });
      }
      return tx.job_Cost.findUniqueOrThrow({ where: { jobCostId }, include: includeJob });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json(updated);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 0);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error updating job costing:', error);
    res.status(500).json({ error: 'Job costing could not be updated.' });
  }
});

router.delete('/:jobCostId', async (req: Request, res: Response) => {
  try {
    const jobCostId = Array.isArray(req.params.jobCostId) ? req.params.jobCostId[0] : req.params.jobCostId;
    await prisma.$transaction(async (tx) => {
      const job = await tx.job_Cost.findFirst({ where: { jobCostId, deletedAt: null }, include: { inquiry: true, sales: true } });
      if (!job) throw Object.assign(new Error('Job costing record not found.'), { statusCode: 404 });
      if (job.sales) {
        const { clientId, invoiceId } = job.sales;
        await tx.sales.update({ where: { invoiceId }, data: { deletedAt: new Date() } });
        const remainingSales = await tx.sales.findMany({ where: { clientId, deletedAt: null }, select: { price: true, downpayment: true } });
        await tx.client.update({ where: { clientId }, data: {
          balance: remainingSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.price) - Number(sale.downpayment)), 0),
        } });
      }
      await tx.job_Cost.update({ where: { jobCostId }, data: { deletedAt: new Date(), inquiryId: null } });
      const movements = await tx.inventory.findMany({ where: { jobCostId, deletedAt: null } });
      if (movements.length) {
        await tx.inventory.updateMany({ where: { jobCostId, deletedAt: null }, data: { deletedAt: new Date() } });
        await recalculateInventory(tx);
      }
      if (job.inquiryId) await tx.inquiries.update({ where: { inquiryId: job.inquiryId }, data: { status: 'PENDING' } });
    });
    res.json({ message: 'Job costing and its linked invoice were removed; the inquiry is pending again.' });
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 0);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error deleting job costing:', error);
    res.status(500).json({ error: 'Job costing could not be deleted.' });
  }
});

export default router;
