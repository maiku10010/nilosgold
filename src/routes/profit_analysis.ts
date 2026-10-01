import { Request, Response, Router } from 'express';
import { prisma } from '../db';

const router = Router();
router.get('/', async (req: Request, res: Response) => {
  const startValue = String(req.query.start ?? '');
  const endValue = String(req.query.end ?? '');
  const start = startValue ? new Date(`${startValue}T00:00:00`) : new Date(new Date().getFullYear(), 0, 1);
  const end = endValue ? new Date(`${endValue}T23:59:59.999`) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end || end > new Date()) {
    res.status(400).json({ error: 'Choose a valid date range that does not include future dates.' }); return;
  }
  try {
    const [sales, expenses, inquiries] = await Promise.all([
      prisma.sales.findMany({ where: { deletedAt: null, salesDate: { gte: start, lte: end }, status: { in: ['FINISHED', 'PAID', 'PARTIAL'] } }, include: { job: true } }),
      prisma.expenses.aggregate({ where: { deletedAt: null, expDate: { gte: start, lte: end } }, _sum: { amount: true } }),
      prisma.inquiries.count({ where: { deletedAt: null, inqDate: { gte: start, lte: end } } }),
    ]);
    const revenue = sales.reduce((sum, sale) => sum + Number(sale.price), 0);
    const jobCost = sales.reduce((sum, sale) => {
      if (!sale.job || sale.job.deletedAt) return sum;
      return sum + Number(sale.job.goldUsed) * Number(sale.job.goldCostPerG) + Number(sale.job.stoneCost) + Number(sale.job.laborCost);
    }, 0);
    const operatingExpenses = Number(expenses._sum.amount ?? 0);
    res.json({ start: start.toISOString(), end: end.toISOString(), revenue, jobCost, grossProfit: revenue - jobCost, expenses: operatingExpenses, netProfit: revenue - jobCost - operatingExpenses, netMargin: revenue ? ((revenue - jobCost - operatingExpenses) / revenue) * 100 : 0, inquiries, salesCount: sales.length });
  } catch (error) {
    console.error('Profit analysis could not be loaded:', error);
    res.status(500).json({ error: 'Profit analysis could not be loaded.' });
  }
});
export default router;
