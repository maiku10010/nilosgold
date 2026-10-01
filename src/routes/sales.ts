import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';

const router = Router();

//create operation for sales
router.post('/', async (req: Request, res: Response) => {
  try {
    const { clientName, contactNum, ...sale } = req.body;
    if (!clientName || !contactNum) return res.status(400).json({ error: 'Client name and contact number are required.' });
    const newSales = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({ data: { clientName, contactNum, balance: Math.max(0, Number(sale.price || 0) - Number(sale.downpayment || 0)) } });
      return tx.sales.create({
      data: {
        ...(typeof sale.invoiceId === 'string' && sale.invoiceId.trim() ? { invoiceId: sale.invoiceId.trim() } : {}),
        serviceType: req.body.serviceType,
        price: req.body.price,
        status: req.body.status,
        downpayment: req.body.downpayment || 0.00,
        salesDate: (req.body.salesDate ?? req.body.date) ? new Date(req.body.salesDate ?? req.body.date) : undefined,
        client: { connect: { clientId: client.clientId } }
      }, include: { client: true }
    });
    });
    res.json(newSales);
  } catch (error) {
    console.error('Error creating sales:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for sales
router.get('/', async (req: Request, res: Response) => {
  try {
    const allSales = await prisma.sales.findMany({
      include: { client: true }
    });
    res.json(allSales);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//update operation for sales
router.put('/:invoiceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.invoiceId)
      ? req.params.invoiceId[0]
      : req.params.invoiceId;
    const updatedSales = await prisma.sales.update({
      where: { invoiceId: targetId },
      data: {
        serviceType: req.body.serviceType,
        price: req.body.price,
        status: req.body.status,
        downpayment: req.body.downpayment || 0.00,
        salesDate: (req.body.salesDate ?? req.body.date) ? new Date(req.body.salesDate ?? req.body.date) : undefined,
        client: { update: {
          ...(req.body.clientName ? { clientName: req.body.clientName } : {}),
          ...(req.body.contactNum ? { contactNum: req.body.contactNum } : {}),
          balance: Math.max(0, Number(req.body.price ?? 0) - Number(req.body.downpayment ?? 0))
        } }
      }, include: { client: true }
    });
    res.json(updatedSales);
  } catch (error) {
    console.error('Error updating sales:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
//delete operation for sales
router.delete('/:invoiceId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.invoiceId)
      ? req.params.invoiceId[0]
      : req.params.invoiceId;
    await prisma.sales.delete({
      where: { invoiceId: targetId }
    });
    res.json({ message: 'Sale invoice successfully deleted' });
  } catch (error: any) {
    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Cannot delete sale: Please delete the associated Job Costing record first.'
      });
    }
    console.error('Error deleting sale:', error);
    res.status(500).json({ error: 'Failed to delete sale' });
  }
});
export default router;
