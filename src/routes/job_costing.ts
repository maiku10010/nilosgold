import { calculateLaborCost, parseStoneCost } from '../lib/jobCostingSchema';
import { stripDisallowedFields, validateServiceFields, getInquiryServiceType, ServiceType } from '../lib/serviceRules';
import { roundTwo } from '../rounding';
import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { friendlyId } from '../friendlyId';
import { isNonNegativeNumber, isPositiveNumber, isTodayOrFutureDate } from '../validation';
import { readyEmail, sendSystemEmail } from '../services/email';
import { validateInventoryLedger } from '../inventoryLedger';
import { withSaleTotals } from '../accounting';
import { goldWeight, syncGoldAllocation, releaseGoldAllocation, reverseJobInventory } from '../goldAllocation';

const router = Router();
const includeJob = {
  employee: { select: { empId: true, empName: true, empRole: true } },
  client: true,
  inquiry: true,
  sales: { include: { client: true, payments: true } },
} as const;
const withJobSaleTotals = <T extends { sales: any }>(job: T) => job.sales ? { ...job, sales: withSaleTotals(job.sales) } : job;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { inquiryId, clientName, contactNum, empId, serviceType: requestedServiceType, itemName, deadline, deliveryDate } = req.body;
    const requestedPayload = requestedServiceType === undefined ? undefined : stripDisallowedFields(requestedServiceType, req.body);
    if (requestedPayload) validateServiceFields(requestedServiceType, req.body);
    const requestedDeadline = deadline ?? deliveryDate;
    if (itemName !== undefined && itemName !== null && (typeof itemName !== 'string' || itemName.trim().length > 120)) return res.status(400).json({ error: 'Item name must be 120 characters or fewer.' });
    if (requestedDeadline !== undefined && requestedDeadline !== null && !isTodayOrFutureDate(requestedDeadline)) return res.status(400).json({ error: 'Delivery date must be today or later.' });
    if (typeof inquiryId !== 'string' || !inquiryId || typeof clientName !== 'string' || !clientName.trim()) {
      return res.status(400).json({ error: 'Choose a pending inquiry and confirm the client name.' });
    }
    const jobCost = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.inquiries.findFirst({ where: { inquiryId, deletedAt: null }, include: { jobCost: true, client: true } });
      if (!inquiry) throw Object.assign(new Error('Inquiry not found or already archived.'), { statusCode: 404 });
      if (inquiry.status !== 'PENDING' || (inquiry.jobCost && !inquiry.jobCost.deletedAt)) throw Object.assign(new Error('Only pending inquiries can be sent to job costing.'), { statusCode: 409 });
      const originalServiceType = getInquiryServiceType(inquiry);
      if (!originalServiceType) throw Object.assign(new Error('Update the inquiry with a valid service type before costing it.'), { statusCode: 400 });
      const serviceType = requestedServiceType ?? originalServiceType;
      const payload = requestedPayload ?? stripDisallowedFields(serviceType, req.body);
      const rules = validateServiceFields(serviceType, req.body);
      const goldUsed = goldWeight(payload.goldUsed);
      const goldScrap = goldWeight(payload.goldScrap ?? 0);
      const goldCostPerG = roundTwo(payload.goldCostPerG ?? 0);
      const stoneCost = parseStoneCost(payload.stoneCost);
      const laborCost = calculateLaborCost(inquiry.quotedPrice);
      const laborCharge = roundTwo(payload.laborCharge ?? 0);
      const otherCost = roundTwo(payload.otherCost ?? 0);
      const sellingPrice = roundTwo(payload.sellingPrice);

      if (![stoneCost ?? 0, laborCost, laborCharge, otherCost, goldCostPerG].every(isNonNegativeNumber) || (rules.gold && payload.goldSourceId !== 'CUSTOMER_GOLD' && (serviceType === 'Custom' || !!payload.goldSourceId) && !isPositiveNumber(goldCostPerG)) || !isPositiveNumber(sellingPrice)) {
        throw Object.assign(new Error('Enter non-negative costs, a gold price per gram, and a selling price greater than zero.'), { statusCode: 400 });
      }
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
          },
        });
      }

      const createdJob = await tx.job_Cost.create({
        data: {
          jobCostId: friendlyId(),
          serviceType,
          universalReferenceId: inquiry.universalReferenceId ?? inquiry.inquiryId,
          itemName: typeof itemName === 'string' && itemName.trim() ? itemName.trim() : null,
          ...(requestedDeadline ? { deadline: new Date(`${requestedDeadline}T00:00:00Z`) } : {}),
          goldUsed: rules.gold ? goldUsed : null,
          goldScrap: rules.scrap ? goldScrap : null,
          goldCostPerG: rules.gold ? goldCostPerG : null,
          stoneCost: rules.stone ? stoneCost : null,
          laborCost: rules.labor ? laborCost : null,
          laborCharge: rules.labor ? laborCharge : null,
          otherCost,
          status: 'PENDING',
          employee: { connect: { empId: employee.empId } },
          client: { connect: { clientId: client.clientId } },
          inquiry: { connect: { inquiryId } },
        },
      });
      if (rules.gold) await syncGoldAllocation(tx, { serviceType, goldSourceId: payload.goldSourceId, goldUsed, goldScrap, goldCostPerG, jobCostId: createdJob.jobCostId, universalReferenceId: createdJob.universalReferenceId });
      await validateInventoryLedger(tx);
      const sale = await tx.sales.create({
        data: {
          invoiceId: friendlyId(),
          universalReferenceId: createdJob.universalReferenceId,
          serviceType,
          price: sellingPrice,
          status: 'PENDING',
          client: { connect: { clientId: client.clientId } },
          job: { connect: { jobCostId: createdJob.jobCostId } },
        },
      });
      await tx.inquiries.update({
        where: { inquiryId },
        data: { status: 'APPROVED', client: { connect: { clientId: client.clientId } } },
      });

      if (serviceType !== originalServiceType) await tx.systemLog.create({ data: {
        actorEmpId: req.user?.empId ?? null, actorName: req.user?.empName ?? 'System', actorRole: req.user?.empRole ?? 'System',
        action: 'PUT', entityType: 'JOB_COST', entityId: createdJob.jobCostId,
        details: { reason: 'Service type changed from inquiry', inquiryId, before: { serviceType: originalServiceType }, after: { serviceType } },
      } });

      return withJobSaleTotals(await tx.job_Cost.findUniqueOrThrow({ where: { jobCostId: createdJob.jobCostId }, include: includeJob }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.locals.auditRecordId = jobCost.jobCostId;
    res.status(201).json(jobCost);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 0);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message, field: (error as { field?: string }).field });
    console.error('Error creating job costing:', error);
    res.status(500).json({ error: 'Job costing could not be saved.' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const jobCosts = await prisma.job_Cost.findMany({ where: { deletedAt: null }, include: includeJob, orderBy: { jobDate: 'desc' } });
    res.json(jobCosts.map(withJobSaleTotals));
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
      return withJobSaleTotals(await tx.job_Cost.findUniqueOrThrow({ where: { jobCostId }, include: includeJob }));
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
    const requestedDeadline = req.body.deadline ?? req.body.deliveryDate;
    if (req.body.itemName !== undefined && req.body.itemName !== null && (typeof req.body.itemName !== 'string' || req.body.itemName.trim().length > 120)) return res.status(400).json({ error: 'Item name must be 120 characters or fewer.' });
    if (requestedDeadline !== undefined && requestedDeadline !== null && requestedDeadline !== '' && !isTodayOrFutureDate(requestedDeadline)) return res.status(400).json({ error: 'Delivery date must be today or later.' });
    if (typeof req.body.invoiceId !== 'string' || typeof req.body.clientName !== 'string') {
      return res.status(400).json({ error: 'The invoice number and client name are required to update job costing.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.job_Cost.findFirst({ where: { jobCostId, deletedAt: null }, include: { inquiry: true, sales: { include: { client: true } } } });
      if (!existing) throw Object.assign(new Error('Job costing record not found.'), { statusCode: 404 });
      if (!existing.sales) throw Object.assign(new Error('This costing has no linked invoice.'), { statusCode: 409 });
      const payload = stripDisallowedFields(existing.serviceType as ServiceType, req.body);
      const rules = validateServiceFields(existing.serviceType, req.body);
      const goldUsed = goldWeight(payload.goldUsed);
      const goldScrap = goldWeight(payload.goldScrap ?? 0);
      const goldCostPerG = roundTwo(payload.goldCostPerG ?? 0);
      const stoneCost = parseStoneCost(payload.stoneCost);
      const laborCost = calculateLaborCost(existing.inquiry?.quotedPrice ?? existing.sales.price);
      const laborCharge = roundTwo(payload.laborCharge ?? 0);
      const otherCost = roundTwo(payload.otherCost ?? 0);
      const sellingPrice = roundTwo(payload.sellingPrice);
      if (![stoneCost ?? 0, laborCost, laborCharge, otherCost].every(isNonNegativeNumber) || !isNonNegativeNumber(goldCostPerG) || !isPositiveNumber(sellingPrice)) {
        throw Object.assign(new Error('Enter non-negative costs, a gold price per gram, and a selling price greater than zero.'), { statusCode: 400 });
      }

      if (rules.gold && payload.goldSourceId !== 'CUSTOMER_GOLD' && (existing.serviceType === 'Custom' || !!payload.goldSourceId) && !isPositiveNumber(goldCostPerG)) throw Object.assign(new Error('Enter a gold price greater than zero.'), { statusCode: 400 });
      if (!rules.gold) await releaseGoldAllocation(tx, jobCostId);
      if (rules.gold) await syncGoldAllocation(tx, { serviceType: existing.serviceType, goldSourceId: payload.goldSourceId, goldUsed, goldScrap, goldCostPerG, jobCostId, universalReferenceId: existing.universalReferenceId });
      await validateInventoryLedger(tx);
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
          goldUsed: rules.gold ? goldUsed : null,
          goldScrap: rules.scrap ? goldScrap : null,
          goldCostPerG: rules.gold ? goldCostPerG : null,
          stoneCost: rules.stone ? stoneCost : null,
          laborCost: rules.labor ? laborCost : null,
          laborCharge: rules.labor ? laborCharge : null,
          otherCost,
          ...(req.body.itemName !== undefined ? { itemName: typeof req.body.itemName === 'string' && req.body.itemName.trim() ? req.body.itemName.trim() : null } : {}),
          ...(requestedDeadline !== undefined ? { deadline: requestedDeadline ? new Date(`${requestedDeadline}T00:00:00Z`) : null } : {}),
          ...(req.body.empId ? { empId: req.body.empId } : {}),
        },
      });
      await tx.sales.update({ where: { invoiceId: existing.sales.invoiceId }, data: { price: sellingPrice } });
      return withJobSaleTotals(await tx.job_Cost.findUniqueOrThrow({ where: { jobCostId }, include: includeJob }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json(updated);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 0);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message, field: (error as { field?: string }).field });
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
      }
      await tx.job_Cost.update({ where: { jobCostId }, data: { deletedAt: new Date(), inquiryId: null } });
      await reverseJobInventory(tx, jobCostId);
      await validateInventoryLedger(tx);
      if (job.inquiryId) await tx.inquiries.update({ where: { inquiryId: job.inquiryId }, data: { status: 'PENDING' } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ message: 'Job costing and its linked invoice were removed; the inquiry is pending again.' });
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || ((error as { code?: string })?.code === 'P2034' ? 409 : 0);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message, field: (error as { field?: string }).field });
    console.error('Error deleting job costing:', error);
    res.status(500).json({ error: 'Job costing could not be deleted.' });
  }
});

export default router;
