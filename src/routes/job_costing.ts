import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isNonNegativeNumber, isPositiveNumber } from '../validation';

const router = Router();

//create operation for job_cost
router.post('/', async (req: Request, res: Response) => {
  try {
    if (![req.body.goldUsed, req.body.stoneCost ?? 0, req.body.laborCost].every(isNonNegativeNumber) || !isPositiveNumber(req.body.sellingPrice) || !isPositiveNumber(req.body.goldCostPerG ?? 5450)) return res.status(400).json({ error: 'Enter non-negative job costs and a selling price greater than zero.' });
    const newJobCost = await prisma.$transaction(async (tx) => {
      if (req.body.sellingPrice !== undefined) {
        const sale = await tx.sales.findUniqueOrThrow({ where: { invoiceId: req.body.invoiceId }, select: { downpayment: true } });
        await tx.sales.update({ where: { invoiceId: req.body.invoiceId }, data: {
          price: req.body.sellingPrice,
          client: { update: { balance: Math.max(0, Number(req.body.sellingPrice) - Number(sale.downpayment)) } }
        } });
      }
      const employee = req.body.empId
        ? { empId: req.body.empId }
        : await tx.employee.findFirst({ select: { empId: true } });
      if (!employee) throw new Error('Create an employee account before recording job costs.');
      return tx.job_Cost.create({
      data: {
        goldUsed: req.body.goldUsed,
        goldCostPerG: req.body.goldCostPerG ?? 5450,
        stoneCost: req.body.stoneCost ?? 0,
        laborCost: req.body.laborCost,
        invoiceId: req.body.invoiceId,
        empId: employee.empId,
      }, include: { sale: { include: { client: true } } }
    });
    });
    res.json(newJobCost);
  } catch (error) {
    console.error('Error creating job cost:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for job_cost
router.get('/', async (req: Request, res: Response) => {
  try {
    const allJobCosts = await prisma.job_Cost.findMany({
      include: {
        employee: { select: { empId: true, empName: true, empRole: true } },
        sale: { include: { client: true } }
      }
    });
    res.json(allJobCosts);
  } catch (error) {
    console.error('Error fetching job costs:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//update operation for job_cost
router.put('/:jobCostId', async (req: Request, res: Response) => {
  try {
    if (![req.body.goldUsed, req.body.stoneCost ?? 0, req.body.laborCost].every(isNonNegativeNumber) || !isPositiveNumber(req.body.sellingPrice) || !isPositiveNumber(req.body.goldCostPerG)) return res.status(400).json({ error: 'Enter non-negative job costs and a selling price greater than zero.' });
    const targetId = Array.isArray(req.params.jobCostId)
      ? req.params.jobCostId[0]
      : req.params.jobCostId;
    const updatedJobCost = await prisma.$transaction(async (tx) => {
      if (req.body.sellingPrice !== undefined) {
        const sale = await tx.sales.findUniqueOrThrow({ where: { invoiceId: req.body.invoiceId }, select: { downpayment: true } });
        await tx.sales.update({ where: { invoiceId: req.body.invoiceId }, data: {
          price: req.body.sellingPrice,
          client: { update: { balance: Math.max(0, Number(req.body.sellingPrice) - Number(sale.downpayment)) } }
        } });
      }
      return tx.job_Cost.update({
      where: { jobCostId: targetId },
      data: {
        goldUsed: req.body.goldUsed,
        goldCostPerG: req.body.goldCostPerG,
        stoneCost: req.body.stoneCost ?? 0,
        laborCost: req.body.laborCost,
        invoiceId: req.body.invoiceId,
        ...(req.body.empId ? { empId: req.body.empId } : {})
      }, include: { sale: { include: { client: true } } }
    });
    });
    res.json(updatedJobCost);
  } catch (error) {
    console.error('Error updating job cost:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// DELETE http://localhost:3000/job_costing/:jobCostId
router.delete('/:jobCostId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.jobCostId)
      ? req.params.jobCostId[0]
      : req.params.jobCostId;
    await prisma.job_Cost.delete({
      where: { jobCostId: targetId }
    });
    res.json({ message: 'Job cost breakdown successfully deleted' });
  } catch (error) {
    console.error('Error deleting job cost:', error);
    res.status(500).json({ error: 'Failed to delete job cost' });
  }
});

export default router;
