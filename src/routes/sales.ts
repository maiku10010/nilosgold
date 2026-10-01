import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { isNonNegativeNumber, isPositiveNumber, isValidNonFutureDate } from '../validation';

const router = Router();

//create operation for sales
router.post('/', async (req: Request, res: Response) => {
  try {
    const { clientName, contactNum, ...sale } = req.body;
    const date = req.body.salesDate ?? req.body.date;
    const downpayment = req.body.downpayment ?? 0;
    if (typeof clientName !== 'string' || !clientName.trim() || typeof contactNum !== 'string' || !contactNum.trim()) return res.status(400).json({ error: 'Client name and contact number are required.' });
    if (!isPositiveNumber(sale.price) || !isNonNegativeNumber(downpayment) || Number(downpayment) > Number(sale.price)) return res.status(400).json({ error: 'Enter a valid price and a downpayment no greater than the total price.' });
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Sale date must be a valid date no later than today.' });
    if (!['Custom', 'Repair', 'Resize', 'Cleaning'].includes(req.body.serviceType) || !['Ongoing', 'Paid', 'Released'].includes(req.body.status)) return res.status(400).json({ error: 'Choose a valid service type and status.' });
    const newSales = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({ data: { clientName: clientName.trim(), contactNum: contactNum.trim(), balance: Math.max(0, Number(sale.price) - Number(downpayment)) } });
      return tx.sales.create({
      data: {
        ...(typeof sale.invoiceId === 'string' && sale.invoiceId.trim() ? { invoiceId: sale.invoiceId.trim() } : {}),
        serviceType: req.body.serviceType,
        price: req.body.price,
        status: req.body.status,
        downpayment,
        salesDate: date ? new Date(date) : undefined,
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
    const date = req.body.salesDate ?? req.body.date;
    const downpayment = req.body.downpayment ?? 0;
    if (!isPositiveNumber(req.body.price) || !isNonNegativeNumber(downpayment) || Number(downpayment) > Number(req.body.price)) return res.status(400).json({ error: 'Enter a valid price and a downpayment no greater than the total price.' });
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Sale date must be a valid date no later than today.' });
    if (!['Custom', 'Repair', 'Resize', 'Cleaning'].includes(req.body.serviceType) || !['Ongoing', 'Paid', 'Released'].includes(req.body.status)) return res.status(400).json({ error: 'Choose a valid service type and status.' });
    const updatedSales = await prisma.sales.update({
      where: { invoiceId: targetId },
      data: {
        serviceType: req.body.serviceType,
        price: req.body.price,
        status: req.body.status,
        downpayment,
        salesDate: date ? new Date(date) : undefined,
        client: { update: {
          ...(typeof req.body.clientName === 'string' && req.body.clientName.trim() ? { clientName: req.body.clientName.trim() } : {}),
          ...(typeof req.body.contactNum === 'string' && req.body.contactNum.trim() ? { contactNum: req.body.contactNum.trim() } : {}),
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
