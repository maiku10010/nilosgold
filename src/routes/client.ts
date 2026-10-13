import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { friendlyId } from '../friendlyId';
import { isValidEmail, isValidPHContact } from '../validation';

const router = Router();

//create operation for client
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!isValidPHContact(req.body.contactNum)) return res.status(400).json({ error: 'Enter a valid Philippine contact number (11 digits starting with 09).' });
    if (req.body.email && !isValidEmail(req.body.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const newClient = await prisma.client.create({
      data: {
        clientId: friendlyId(),
        clientName: req.body.clientName,
        contactNum: req.body.contactNum,
        email: req.body.email || null,
        balance: req.body.balance
      }
    });
    res.json(newClient);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for client
router.get('/', async (req: Request, res: Response) => {
  try {
    const allClients = await prisma.client.findMany({
      where: { deletedAt: null },
      include: { sales: { where: { deletedAt: null } }, inquiries: { where: { deletedAt: null } } }
    });
    res.json(allClients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//update operation for client 
router.put('/:clientId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.clientId)
      ? req.params.clientId[0]
      : req.params.clientId;
    if (!isValidPHContact(req.body.contactNum)) return res.status(400).json({ error: 'Enter a valid Philippine contact number (11 digits starting with 09).' });
    if (req.body.email && !isValidEmail(req.body.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const updatedClient = await prisma.client.update({
      where: { clientId: targetId },
      data: {
        clientName: req.body.clientName,
        contactNum: req.body.contactNum,
        email: req.body.email ?? undefined,
        balance: req.body.balance
      }
    });
    res.json(updatedClient);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
//delete operation for client
router.delete('/:clientId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.clientId)
      ? req.params.clientId[0]
      : req.params.clientId;
    const deleted = await prisma.client.updateMany({
      where: { clientId: targetId, deletedAt: null }, data: { deletedAt: new Date() }
    });
    if (!deleted.count) return res.status(404).json({ error: 'Client not found or already archived.' });
    res.json({ message: 'Client successfully deleted' });
  } catch (error: any) {
    // P2003 triggers if the client still has connected sales records
    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Cannot delete client: This client still has existing sales/invoices attached.'
      });
    }
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

export default router;
