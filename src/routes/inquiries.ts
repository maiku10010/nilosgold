import { Request, Response, Router } from 'express';
import { prisma } from '../db';
import { friendlyId } from '../friendlyId';
import { isNonNegativeNumber, isValidNonFutureDate, isValidPHContact, isValidEmail } from '../validation';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { customerName, contactInfo, email, details, category, quotedPrice, clientId } = req.body;
    const date = req.body.date;
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Inquiry date must be a valid date no later than today.' });
    if (typeof customerName !== 'string' || !customerName.trim() || typeof category !== 'string' || !category.trim() || !isNonNegativeNumber(quotedPrice)) {
      return res.status(400).json({ error: 'Enter a customer, category, and valid quote.' });
    }
    if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) return res.status(400).json({ error: 'Enter a valid customer email address.' });
    if (contactInfo && !isValidPHContact(contactInfo)) return res.status(400).json({ error: 'Enter a valid Philippine contact number (09XXXXXXXXX or +639XXXXXXXXX).' });

    const inquiry = await prisma.inquiries.create({
      data: {
        inquiryId: friendlyId(),
        universalReferenceId: friendlyId(),
        customerName: customerName.trim(),
        contactInfo: typeof contactInfo === 'string' ? contactInfo.trim() : null,
        email: typeof email === 'string' && email.trim() ? email.trim() : null,
        details: typeof details === 'string' ? details.trim() : null,
        category: category.trim(),
        quotedPrice: Number(quotedPrice),
        status: 'PENDING',
        ...(date ? { inqDate: new Date(`${date}T00:00:00`) } : {}),
        ...(typeof clientId === 'string' && clientId ? { client: { connect: { clientId } } } : {}),
      },
      include: { client: true, jobCost: { include: { sales: true } } },
    });

    res.status(201).json(inquiry);
  } catch (error) {
    console.error('Error creating inquiry:', error);
    res.status(500).json({ error: 'Inquiry could not be saved.' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const inquiries = await prisma.inquiries.findMany({
      where: { deletedAt: null },
      include: { client: true, jobCost: { include: { sales: true } } },
      orderBy: { inqDate: 'desc' },
    });
    res.json(inquiries);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    res.status(500).json({ error: 'Inquiries could not be loaded.' });
  }
});

router.put('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = Array.isArray(req.params.inquiryId) ? req.params.inquiryId[0] : req.params.inquiryId;
    const date = req.body.date;
    if (date !== undefined && !isValidNonFutureDate(date)) return res.status(400).json({ error: 'Inquiry date must be a valid date no later than today.' });
    if (typeof req.body.customerName !== 'string' || !req.body.customerName.trim() || typeof req.body.category !== 'string' || !req.body.category.trim() || !isNonNegativeNumber(req.body.quotedPrice)) {
      return res.status(400).json({ error: 'Enter a customer, category, and valid quote.' });
    }
    if (req.body.email && !isValidEmail(req.body.email)) return res.status(400).json({ error: 'Enter a valid customer email address.' });
    if (req.body.contactInfo && !isValidPHContact(req.body.contactInfo)) return res.status(400).json({ error: 'Enter a valid Philippine contact number (09XXXXXXXXX or +639XXXXXXXXX).' });

    const existing = await prisma.inquiries.findFirst({ where: { inquiryId, deletedAt: null }, include: { jobCost: true } });
    if (!existing) return res.status(404).json({ error: 'Inquiry not found.' });
    if (existing.status !== 'PENDING' || (existing.jobCost && !existing.jobCost.deletedAt)) return res.status(409).json({ error: 'Only pending inquiries without an active job costing can be edited.' });

    const inquiry = await prisma.inquiries.update({
      where: { inquiryId },
      data: {
        customerName: req.body.customerName.trim(),
        contactInfo: typeof req.body.contactInfo === 'string' ? req.body.contactInfo.trim() : null,
        email: typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim() : null,
        details: typeof req.body.details === 'string' ? req.body.details.trim() : null,
        category: req.body.category.trim(),
        quotedPrice: Number(req.body.quotedPrice),
        ...(date ? { inqDate: new Date(`${date}T00:00:00`) } : {}),
      },
      include: { client: true, jobCost: { include: { sales: true } } },
    });
    res.json(inquiry);
  } catch (error) {
    console.error('Error updating inquiry:', error);
    res.status(500).json({ error: 'Inquiry could not be updated.' });
  }
});

router.delete('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = Array.isArray(req.params.inquiryId) ? req.params.inquiryId[0] : req.params.inquiryId;
    const existing = await prisma.inquiries.findFirst({ where: { inquiryId, deletedAt: null }, include: { jobCost: true } });
    if (!existing) return res.status(404).json({ error: 'Inquiry not found.' });
    if (existing.jobCost && !existing.jobCost.deletedAt) return res.status(409).json({ error: 'Delete the linked job costing before deleting this inquiry.' });
    await prisma.inquiries.update({ where: { inquiryId }, data: { deletedAt: new Date() } });
    res.json({ message: 'Inquiry deleted.' });
  } catch (error) {
    console.error('Error deleting inquiry:', error);
    res.status(500).json({ error: 'Inquiry could not be deleted.' });
  }
});

export default router;
