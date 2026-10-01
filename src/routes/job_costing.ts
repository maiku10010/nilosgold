import { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { friendlyId } from '../friendlyId';
import { isNonNegativeNumber, isPositiveNumber } from '../validation';

const router = Router();
const serviceTypes = ['Custom', 'Repair', 'Resize', 'Cleaning'];
const includeJob = {
  employee: { select: { empId: true, empName: true, empRole: true } },
  inquiry: true,
  sales: { include: { client: true } },
} as const;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { inquiryId, clientName, contactNum, empId, serviceType } = req.body;
    const goldUsed = Number(req.body.goldUsed);
    const goldCostPerG = Number(req.body.goldCostPerG);
    const stoneCost = Number(req.body.stoneCost ?? 0);
    const laborCost = Number(req.body.laborCost);
    const sellingPrice = Number(req.body.sellingPrice);

    if (typeof inquiryId !== 'string' || !inquiryId || typeof clientName !== 'string' || !clientName.trim()) {
      return res.status(400).json({ error: 'Choose a pending inquiry and confirm the client name.' });
    }
    if (!serviceTypes.includes(serviceType)) return res.status(400).json({ error: 'Choose a valid service type.' });
    if (![goldUsed, stoneCost, laborCost].every(isNonNegativeNumber) || !isPositiveNumber(goldCostPerG) || !isPositiveNumber(sellingPrice)) {
      return res.status(400).json({ error: 'Enter non-negative costs, a gold price per gram, and a selling price greater than zero.' });
    }

    const jobCost = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.inquiries.findUnique({ where: { inquiryId }, include: { jobCost: true, client: true } });
      if (!inquiry) throw Object.assign(new Error('Inquiry not found.'), { statusCode: 404 });
      if (inquiry.status !== 'PENDING' || inquiry.jobCost) throw Object.assign(new Error('Only pending inquiries can be sent to job costing.'), { statusCode: 409 });
      if (inquiry.customerName.trim().toLocaleLowerCase() !== clientName.trim().toLocaleLowerCase()) {
        throw Object.assign(new Error('The client name must match the selected inquiry.'), { statusCode: 400 });
      }

      const employee = empId
        ? await tx.employee.findUnique({ where: { empId }, select: { empId: true } })
        : await tx.employee.findFirst({ select: { empId: true } });
      if (!employee) throw Object.assign(new Error('Assign an existing employee before approving job costing.'), { statusCode: 409 });

      let client = inquiry.client;
      const normalizedContact = typeof contactNum === 'string' && contactNum.trim() ? contactNum.trim() : null;
      if (!client) {
        client = await tx.client.findFirst({
          where: { clientName: { equals: inquiry.customerName, mode: 'insensitive' }, contactNum: normalizedContact },
        });
      }
      if (!client) {
        client = await tx.client.create({
          data: {
            clientId: friendlyId(),
            clientName: inquiry.customerName.trim(),
            contactNum: normalizedContact,
            balance: 0,
          },
        });
      }

      const createdJob = await tx.job_Cost.create({
        data: {
          jobCostId: friendlyId(),
          goldUsed,
          goldCostPerG,
          stoneCost,
          laborCost,
          status: 'APPROVED',
          employee: { connect: { empId: employee.empId } },
          inquiry: { connect: { inquiryId } },
        },
      });
      const sale = await tx.sales.create({
        data: {
          invoiceId: friendlyId(),
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
    });

    res.status(201).json(jobCost);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error creating job costing:', error);
    res.status(500).json({ error: 'Job costing could not be saved.' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const jobCosts = await prisma.job_Cost.findMany({ include: includeJob, orderBy: { jobDate: 'desc' } });
    res.json(jobCosts);
  } catch (error) {
    console.error('Error fetching job costing:', error);
    res.status(500).json({ error: 'Job costing could not be loaded.' });
  }
});

router.put('/:jobCostId', async (req: Request, res: Response) => {
  try {
    const jobCostId = Array.isArray(req.params.jobCostId) ? req.params.jobCostId[0] : req.params.jobCostId;
    const goldUsed = Number(req.body.goldUsed);
    const goldCostPerG = Number(req.body.goldCostPerG);
    const stoneCost = Number(req.body.stoneCost ?? 0);
    const laborCost = Number(req.body.laborCost);
    const sellingPrice = Number(req.body.sellingPrice);
    if (![goldUsed, stoneCost, laborCost].every(isNonNegativeNumber) || !isPositiveNumber(goldCostPerG) || !isPositiveNumber(sellingPrice)) {
      return res.status(400).json({ error: 'Enter non-negative costs, a gold price per gram, and a selling price greater than zero.' });
    }
    if (typeof req.body.invoiceId !== 'string' || typeof req.body.clientName !== 'string') {
      return res.status(400).json({ error: 'The invoice number and client name are required to update job costing.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.job_Cost.findUnique({ where: { jobCostId }, include: { sales: { include: { client: true } } } });
      if (!existing) throw Object.assign(new Error('Job costing record not found.'), { statusCode: 404 });
      if (!existing.sales) throw Object.assign(new Error('This costing has no linked invoice.'), { statusCode: 409 });
      const namesMatch = existing.sales.client.clientName.trim().toLocaleLowerCase() === req.body.clientName.trim().toLocaleLowerCase();
      if (existing.sales.invoiceId !== req.body.invoiceId || !namesMatch) {
        throw Object.assign(new Error('The client name and invoice number must match this costing.'), { statusCode: 409 });
      }
      if (req.body.empId && req.body.empId !== existing.empId) {
        const employee = await tx.employee.findUnique({ where: { empId: req.body.empId }, select: { empId: true } });
        if (!employee) throw Object.assign(new Error('Choose an existing employee.'), { statusCode: 400 });
      }

      await tx.job_Cost.update({
        where: { jobCostId },
        data: {
          goldUsed,
          goldCostPerG,
          stoneCost,
          laborCost,
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
    });
    res.json(updated);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error updating job costing:', error);
    res.status(500).json({ error: 'Job costing could not be updated.' });
  }
});

router.delete('/:jobCostId', async (req: Request, res: Response) => {
  try {
    const jobCostId = Array.isArray(req.params.jobCostId) ? req.params.jobCostId[0] : req.params.jobCostId;
    await prisma.$transaction(async (tx) => {
      const job = await tx.job_Cost.findUnique({ where: { jobCostId }, include: { inquiry: true, sales: true } });
      if (!job) throw Object.assign(new Error('Job costing record not found.'), { statusCode: 404 });
      if (job.sales) {
        const { clientId, invoiceId } = job.sales;
        await tx.sales.delete({ where: { invoiceId } });
        const remainingSales = await tx.sales.findMany({ where: { clientId }, select: { price: true, downpayment: true } });
        await tx.client.update({ where: { clientId }, data: {
          balance: remainingSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.price) - Number(sale.downpayment)), 0),
        } });
      }
      await tx.job_Cost.delete({ where: { jobCostId } });
      if (job.inquiryId) await tx.inquiries.update({ where: { inquiryId: job.inquiryId }, data: { status: 'PENDING' } });
    });
    res.json({ message: 'Job costing and its linked invoice were removed; the inquiry is pending again.' });
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode);
    if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
    console.error('Error deleting job costing:', error);
    res.status(500).json({ error: 'Job costing could not be deleted.' });
  }
});

export default router;
