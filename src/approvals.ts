import { parseStoneCost } from './lib/jobCostingSchema';
import { serviceRules, validateServiceFields, stripDisallowedFields, ServiceType } from './lib/serviceRules';
import { roundTwo } from './rounding';
import { NextFunction, Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { isAdminRole } from './auth';
import { writeSystemLog } from './audit';
import { validateInventoryLedger } from './inventoryLedger';
import { friendlyId } from './friendlyId';
import { isTodayOrFutureDate, isValidPHContact } from './validation';
import { InventoryCategory } from '@prisma/client';
import { paidTotal, setSalePaidTotal } from './accounting';
import { goldWeight, syncGoldAllocation, releaseGoldAllocation, reverseJobInventory, restoreScrapRecovery } from './goldAllocation';

type Entity = 'SALE' | 'JOB_COST' | 'INQUIRY' | 'EXPENSE' | 'INVENTORY' | 'CLIENT';
type Action = 'UPDATE' | 'DELETE';
type Spec = { entity: Entity; id: string; allowed: Set<string>; context: Set<string> };
const contextFields = new Set(['invoiceId', 'jobCostId', 'referenceId', 'inquiryId', 'expenseId', 'clientId', 'clientName']);

function requestSpec(req: Request): Spec | null {
  const segments = req.path.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.length !== 2 || !segments[1]) return null;
  const [resource, id] = segments;
  const resourceSpecs: Record<string, { entity: Entity; allowed: string[] }> = {
    sales: { entity: 'SALE', allowed: ['serviceType', 'price', 'payment', 'salesDate', 'date', 'clientName', 'contactNum', 'email'] },
    'job-cost': { entity: 'JOB_COST', allowed: ['goldSourceId', 'goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost', 'laborCost', 'laborCharge', 'otherCost', 'empId', 'sellingPrice', 'itemName', 'deadline', 'deliveryDate'] },
    job_costing: { entity: 'JOB_COST', allowed: ['goldSourceId', 'goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost', 'laborCost', 'laborCharge', 'otherCost', 'empId', 'sellingPrice', 'itemName', 'deadline', 'deliveryDate'] },
    inquiries: { entity: 'INQUIRY', allowed: ['customerName', 'contactInfo', 'email', 'details', 'category', 'quotedPrice', 'isFullyPaid', 'date', 'inqDate'] },
    expenses: { entity: 'EXPENSE', allowed: ['category', 'amount', 'description', 'expDate', 'date'] },
    inventory: { entity: 'INVENTORY', allowed: ['itemName', 'category', 'quantityIn', 'quantityOut', 'quantityLoss', 'goldIn', 'goldOut', 'scraps', 'scrap', 'unit', 'unitPrice', 'date', 'updatedAt'] },
    // Client balance is derived from invoices and must never be manually edited.
    client: { entity: 'CLIENT', allowed: ['clientName', 'contactNum', 'email'] },
  };
  const selected = resourceSpecs[resource];
  return selected ? { entity: selected.entity, id, allowed: new Set(selected.allowed), context: contextFields } : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function findCurrent(entity: Entity, id: string): Promise<any> {
  switch (entity) {
    case 'SALE': return prisma.sales.findFirst({ where: { invoiceId: id, deletedAt: null }, include: { client: true, payments: true, job: { include: { inventoryMovement: true } } } });
    case 'JOB_COST': {
      const job = await prisma.job_Cost.findFirst({ where: { jobCostId: id, deletedAt: null }, include: { inquiry: true, sales: { include: { client: true } }, inventoryMovement: true } });
      if (!job) return null;
      const source = await prisma.inventory.findFirst({ where: { category: 'GOLD', goldKarat: job.goldKarat, deletedAt: null, quantityIn: { gt: 0 } } });
      return { ...job, goldSourceId: source?.referenceId ?? null };
    }
    case 'INQUIRY': return prisma.inquiries.findFirst({ where: { inquiryId: id, deletedAt: null }, include: { jobCost: true } });
    case 'EXPENSE': return prisma.expenses.findFirst({ where: { expenseId: id, deletedAt: null } });
    case 'INVENTORY': return prisma.inventory.findFirst({ where: { referenceId: id, deletedAt: null } });
    case 'CLIENT': return prisma.client.findFirst({ where: { clientId: id, deletedAt: null } });
  }
}

const numericFields = new Set(['price', 'payment', 'goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost', 'laborCost', 'laborCharge', 'otherCost', 'sellingPrice', 'quotedPrice', 'amount', 'goldIn', 'goldOut', 'scraps', 'quantityIn', 'quantityOut', 'quantityLoss', 'unitPrice']);
const positiveFields = new Set(['price', 'goldCostPerG', 'sellingPrice', 'amount', 'unitPrice']);
const nullableStringFields = new Set(['contactInfo', 'email', 'details', 'description', 'contactNum']);
function normalizedChanges(body: Record<string, unknown>, spec: Spec, serviceType?: ServiceType): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const notApplicable = serviceType ? stripDisallowedFields(serviceType, {}) : {};
  for (const [key, raw] of Object.entries(body)) {
    if (!spec.allowed.has(key)) {
      if (spec.context.has(key)) continue;
      continue;
    }
    if (raw === undefined) continue;
    if (spec.entity === 'INVENTORY' && key === 'unitPrice' && raw === null) { changes[key] = null; continue; }
    if (spec.entity === 'JOB_COST' && key === 'stoneCost') { changes[key] = parseStoneCost(raw); continue; }
    if (raw === null && Object.hasOwn(notApplicable, key)) { changes[key] = null; continue; }
    if (spec.entity === 'JOB_COST' && ['goldUsed', 'goldScrap'].includes(key)) {
      changes[key] = goldWeight(raw).toString();
      continue;
    }
    if (numericFields.has(key)) {
      const value = spec.entity === 'JOB_COST' ? roundTwo(raw) : Number(raw);
      if (!Number.isFinite(value) || value < 0 || (positiveFields.has(key) && value <= 0)) throw new Error(`Enter a valid ${key}.`);
      changes[key] = value;
    } else if (key === 'isFullyPaid' && typeof raw === 'boolean') {
      changes[key] = raw;
    } else if (['deadline', 'deliveryDate'].includes(key)) {
      if (!isTodayOrFutureDate(raw)) throw new Error('Delivery date must be today or later.');
      changes[key] = new Date(`${raw}T00:00:00.000Z`).toISOString();
    } else if (['date', 'salesDate', 'inqDate', 'expDate', 'updatedAt'].includes(key)) {
      if (typeof raw !== 'string' || !raw || Number.isNaN(Date.parse(raw))) throw new Error('Enter a valid date.');
      const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
      if (date.getTime() > Date.now()) throw new Error('Dates cannot be in the future.');
      changes[key] = date.toISOString();
    } else if (key === 'scrap') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error('Enter a valid scrap weight.');
      changes.quantityLoss = value;
    } else if (typeof raw === 'string') {
      const value = raw.trim();
      if (!value && !nullableStringFields.has(key)) throw new Error(`${key} cannot be empty.`);
      if (value.length > 500) throw new Error(`${key} is too long.`);
      if (key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
      if (['contactNum', 'contactInfo'].includes(key) && value && !isValidPHContact(raw)) throw new Error('Enter an 11-digit Philippine mobile number starting with 09.');
      changes[key] = value || (nullableStringFields.has(key) ? null : value);
    } else {
      throw new Error(`Invalid value for ${key}.`);
    }
  }
  if (Object.keys(changes).length === 0) throw new Error('There are no editable fields in this change request.');
  return changes;
}

export async function queueStaffChanges(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user || isAdminRole(req.user.empRole) || !['PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return; }
  let spec: Spec | null;
  try { spec = requestSpec(req); }
  catch { res.status(400).json({ error: 'Invalid record ID.' }); return; }
  if (!spec) { next(); return; }
  const action: Action = req.method === 'DELETE' ? 'DELETE' : 'UPDATE';
  try {
    const current = await findCurrent(spec.entity, spec.id);
    if (!current) { res.status(404).json({ error: 'Record was not found or is already archived.' }); return; }
    if (spec.entity === 'INVENTORY' && current.jobCostId && ['GOLD', 'SCRAP'].includes(current.category)) { res.status(409).json({ error: 'Edit the linked job costing to adjust this automatic movement.' }); return; }
    let proposedData: Record<string, unknown> | null = null;
    if (action === 'UPDATE') {
      try {
        const type = spec.entity === 'JOB_COST' ? current.serviceType as ServiceType : undefined;
        const payload = type ? stripDisallowedFields(type, req.body ?? {}) : req.body ?? {};
        if (spec.entity === 'JOB_COST') validateServiceFields(type, req.body ?? {});
        proposedData = normalizedChanges(payload, spec, type);
      }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
      if (spec.entity === 'INVENTORY') {
        const category = String(proposedData.category ?? current.category).toUpperCase();
        const unit = String(proposedData.unit ?? current.unit);
        const units: Record<string, string[]> = { SCRAP: ['grams'], GOLD: ['grams', 'troy oz'], SILVER: ['grams'], GEMSTONES: ['carats', 'pieces'], BOXES: ['boxes', 'pieces'], PACKAGING: ['pieces', 'boxes'], FINDINGS: ['pieces', 'grams'], TOOLS: ['pieces'] };
        if (!units[category] || !units[category].includes(unit)) { res.status(400).json({ error: 'Choose a supported category and unit combination.' }); return; }
      }
      if (spec.entity === 'SALE') {
        const nextPrice = Number(proposedData.price ?? current.price);
        const nextPayment = Number(proposedData.payment ?? paidTotal(current.payments));
        if (nextPayment > nextPrice) { res.status(400).json({ error: 'Payment cannot exceed the sale price.' }); return; }
      }
      if (spec.entity === 'SALE' && current.status === 'PENDING') { res.status(409).json({ error: 'Update this invoice from its pending job costing.' }); return; }
      if (spec.entity === 'INQUIRY' && (current.status !== 'PENDING' || current.jobCost)) { res.status(409).json({ error: 'Only pending inquiries without a job costing can be edited.' }); return; }
    }
    const existingRequest = await prisma.approvalRequest.findFirst({ where: { entityType: spec.entity, entityId: spec.id, status: 'PENDING' }, select: { requestId: true } });
    if (existingRequest) { res.status(409).json({ error: 'An Admin review is already pending for this record.', approvalId: existingRequest.requestId }); return; }
    const request = await prisma.approvalRequest.create({
      data: {
        entityType: spec.entity,
        entityId: spec.id,
        action,
        beforeData: json(current),
        proposedData: proposedData ? json(proposedData) : undefined,
        requesterEmpId: req.user.empId,
      },
    });
    res.status(202).json({ approvalRequired: true, approvalId: request.requestId, message: 'Sent to an Administrator for approval. The record stays unchanged until it is approved.' });
  } catch (error) {
    console.error('Could not create approval request:', error);
    res.status(500).json({ error: 'This change could not be sent for approval.' });
  }
}

async function applyUpdate(tx: Prisma.TransactionClient, request: any, changes: Record<string, unknown>, goldRestoreSnapshot?: Record<string, any>): Promise<void> {
  const id = request.entityId as string;
  const date = (key: string) => changes[key] ? new Date(String(changes[key])) : undefined;
  switch (request.entityType as Entity) {
    case 'SALE': {
      const sale = await tx.sales.findFirst({ where: { invoiceId: id, deletedAt: null } });
      if (!sale) throw new Error('Sale is no longer active.');
      await tx.sales.update({ where: { invoiceId: id }, data: {
        ...(changes.serviceType !== undefined ? { serviceType: changes.serviceType as string } : {}),
        ...(changes.price !== undefined ? { price: changes.price as number } : {}),
        ...(changes.salesDate || changes.date ? { salesDate: date('salesDate') ?? date('date') } : {}),
      } });
      if (changes.payment !== undefined) await setSalePaidTotal(tx, id, changes.payment as number);
      const clientData = request.proposedData as Record<string, unknown> | null;
      const clientChanges = clientData && ('clientName' in clientData || 'contactNum' in clientData || 'email' in clientData)
        ? { ...(typeof clientData.clientName === 'string' ? { clientName: clientData.clientName } : {}), ...(clientData.contactNum !== undefined ? { contactNum: clientData.contactNum as string | null } : {}), ...(clientData.email !== undefined ? { email: clientData.email as string | null } : {}) }
        : null;
      if (clientChanges) await tx.client.update({ where: { clientId: sale.clientId }, data: clientChanges });
      return;
    }
    case 'JOB_COST': {
      const job = await tx.job_Cost.findFirst({ where: { jobCostId: id, deletedAt: null }, include: { sales: true } });
      if (!job) throw new Error('Job costing is no longer active.');
      const payload = goldRestoreSnapshot ? changes : stripDisallowedFields(job.serviceType as ServiceType, changes);
      const rules = goldRestoreSnapshot ? serviceRules(job.serviceType) : validateServiceFields(job.serviceType, changes);
      const { sellingPrice, ...jobFields } = payload;
      await tx.job_Cost.update({ where: { jobCostId: id }, data: {
        ...(jobFields.goldUsed !== undefined ? { goldUsed: jobFields.goldUsed === null ? null : goldWeight(jobFields.goldUsed) } : {}),
        ...(jobFields.goldScrap !== undefined ? { goldScrap: jobFields.goldScrap === null ? null : goldWeight(jobFields.goldScrap) } : {}),
        ...(jobFields.goldCostPerG !== undefined ? { goldCostPerG: jobFields.goldCostPerG === null ? null : Number(Number(jobFields.goldCostPerG).toFixed(2)) } : {}),
        ...(jobFields.stoneCost !== undefined ? { stoneCost: parseStoneCost(jobFields.stoneCost) } : {}),
        ...(jobFields.laborCost !== undefined ? { laborCost: jobFields.laborCost as number | null } : {}),
        ...(jobFields.laborCharge !== undefined ? { laborCharge: jobFields.laborCharge as number | null } : {}),
        ...(jobFields.otherCost !== undefined ? { otherCost: jobFields.otherCost as number } : {}),
        ...(jobFields.itemName !== undefined ? { itemName: jobFields.itemName as string | null } : {}),
        ...(jobFields.deadline !== undefined || jobFields.deliveryDate !== undefined ? { deadline: date('deadline') ?? date('deliveryDate') } : {}),
        ...(typeof jobFields.empId === 'string' ? { empId: jobFields.empId } : {}),
      } });
      if (goldRestoreSnapshot && Array.isArray(goldRestoreSnapshot.inventoryMovement)) {
        await tx.inventory.updateMany({ where: { jobCostId: id, category: { not: 'SCRAP' } }, data: { deletedAt: new Date() } });
        for (const row of goldRestoreSnapshot.inventoryMovement) {
          if (row.category === 'SCRAP') continue;
          await tx.inventory.update({ where: { referenceId: row.referenceId }, data: {
            itemName: row.itemName, goldKarat: row.goldKarat ?? null, unit: row.unit,
            quantityIn: row.quantityIn, quantityOut: row.quantityOut, quantityLoss: row.category === 'GOLD' ? 0 : row.quantityLoss, unitPrice: row.unitPrice,
            deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
          } });
        }
        await restoreScrapRecovery(tx, id, goldRestoreSnapshot.inventoryMovement);
        await tx.job_Cost.update({ where: { jobCostId: id }, data: { goldKarat: goldRestoreSnapshot.goldKarat ?? null } });
      } else if (!rules.gold) {
        await releaseGoldAllocation(tx, id);
      } else {
        const source = jobFields.goldSourceId ? null : await tx.inventory.findFirst({ where: { category: 'GOLD', goldKarat: job.goldKarat, deletedAt: null, quantityIn: { gt: 0 } } });
        await syncGoldAllocation(tx, {
          goldSourceId: jobFields.goldSourceId ?? source?.referenceId,
          goldUsed: goldWeight(jobFields.goldUsed ?? job.goldUsed), goldScrap: goldWeight(jobFields.goldScrap ?? job.goldScrap),
          goldCostPerG: Number(jobFields.goldCostPerG ?? job.goldCostPerG), jobCostId: id, universalReferenceId: job.universalReferenceId,
        });
      }
      await validateInventoryLedger(tx);
      if (sellingPrice !== undefined && job.sales) await tx.sales.update({ where: { invoiceId: job.sales.invoiceId }, data: { price: sellingPrice as number } });
      return;
    }
    case 'INQUIRY': await tx.inquiries.update({ where: { inquiryId: id }, data: {
      ...(changes.customerName !== undefined ? { customerName: changes.customerName as string } : {}),
      ...(changes.contactInfo !== undefined ? { contactInfo: changes.contactInfo as string | null } : {}),
      ...(changes.email !== undefined ? { email: changes.email as string | null } : {}),
      ...(changes.details !== undefined ? { details: changes.details as string | null } : {}),
      ...(changes.category !== undefined ? { category: changes.category as string } : {}),
      ...(changes.quotedPrice !== undefined ? { quotedPrice: changes.quotedPrice as number } : {}),
      ...(changes.isFullyPaid !== undefined ? { isFullyPaid: changes.isFullyPaid as boolean } : {}),
      ...(changes.date || changes.inqDate ? { inqDate: date('inqDate') ?? date('date') } : {}),
    } }); return;
    case 'EXPENSE': await tx.expenses.update({ where: { expenseId: id }, data: {
      ...(changes.category !== undefined ? { category: changes.category as string } : {}),
      ...(changes.amount !== undefined ? { amount: changes.amount as number } : {}),
      ...(changes.description !== undefined ? { description: changes.description as string | null } : {}),
      ...(changes.expDate || changes.date ? { expDate: date('expDate') ?? date('date') } : {}),
    } }); return;
    case 'INVENTORY': {
      const current = await tx.inventory.findUnique({ where: { referenceId: id } });
      if (!current) throw new Error('Inventory entry is no longer active.');
      const rawPrice = changes.unitPrice === undefined ? current.unitPrice : changes.unitPrice;
      const unitPrice = rawPrice === null ? null : Number(rawPrice);
      if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice <= 0)) throw new Error('Unit price must be greater than zero, or null when unknown.');
      const category = String(changes.category ?? current.category) as InventoryCategory;
      const quantityIn = category === 'SCRAP' ? goldWeight(changes.quantityIn ?? changes.goldIn ?? current.quantityIn) : Number(changes.quantityIn ?? changes.goldIn ?? current.quantityIn);
      const quantityOut = category === 'SCRAP' ? goldWeight(changes.quantityOut ?? changes.goldOut ?? current.quantityOut) : Number(changes.quantityOut ?? changes.goldOut ?? current.quantityOut);
      const quantityLoss = category === 'SCRAP' ? goldWeight(changes.quantityLoss ?? changes.scraps ?? current.quantityLoss) : Number(changes.quantityLoss ?? changes.scraps ?? current.quantityLoss);
      await tx.inventory.update({ where: { referenceId: id }, data: {
        ...(changes.itemName !== undefined ? { itemName: changes.itemName as string } : {}),
        category,
        quantityIn, quantityOut, quantityLoss,
        ...(changes.unitPrice !== undefined ? { unitPrice } : {}),
        ...(changes.unit !== undefined ? { unit: changes.unit as string } : {}),
        updatedAt: date('updatedAt') ?? date('date') ?? new Date(),
      } });
      await validateInventoryLedger(tx); return;
    }
    case 'CLIENT': await tx.client.update({ where: { clientId: id }, data: {
      ...(changes.clientName !== undefined ? { clientName: changes.clientName as string } : {}),
      ...(changes.contactNum !== undefined ? { contactNum: changes.contactNum as string | null } : {}),
      ...(changes.email !== undefined ? { email: changes.email as string | null } : {}),
    } }); return;
  }
}

async function applyDelete(tx: Prisma.TransactionClient, request: any): Promise<void> {
  const now = new Date();
  const id = request.entityId as string;
  switch (request.entityType as Entity) {
    case 'SALE': {
      const sale = await tx.sales.findFirst({ where: { invoiceId: id, deletedAt: null }, include: { job: true } });
      if (!sale) throw new Error('Sale is no longer active.');
      await tx.sales.update({ where: { invoiceId: id }, data: { deletedAt: now } });
      if (sale.job) {
        await tx.job_Cost.update({ where: { jobCostId: sale.job.jobCostId }, data: { deletedAt: now, inquiryId: null } });
        await reverseJobInventory(tx, sale.job.jobCostId);
        await validateInventoryLedger(tx);
        if (sale.job.inquiryId) await tx.inquiries.update({ where: { inquiryId: sale.job.inquiryId }, data: { status: 'PENDING' } });
      }
      return;
    }
    case 'JOB_COST': {
      const job = await tx.job_Cost.findFirst({ where: { jobCostId: id, deletedAt: null }, include: { inquiry: true, sales: true } });
      if (!job) throw new Error('Job costing is no longer active.');
      await tx.job_Cost.update({ where: { jobCostId: id }, data: { deletedAt: now, inquiryId: null } });
      await reverseJobInventory(tx, id);
      await validateInventoryLedger(tx);
      if (job.sales) await tx.sales.update({ where: { invoiceId: job.sales.invoiceId }, data: { deletedAt: now } });
      if (job.inquiryId) await tx.inquiries.update({ where: { inquiryId: job.inquiryId }, data: { status: 'PENDING' } });
      return;
    }
    case 'INQUIRY': {
      const row = await tx.inquiries.findFirst({ where: { inquiryId: id, deletedAt: null }, include: { jobCost: true } });
      if (!row) throw new Error('Inquiry is no longer active.');
      if (row.jobCost && !row.jobCost.deletedAt) throw new Error('Delete the linked job costing before archiving this inquiry.');
      await tx.inquiries.update({ where: { inquiryId: id }, data: { deletedAt: now } }); return;
    }
    case 'EXPENSE': {
      const expense = await tx.expenses.findFirst({ where: { expenseId: id, deletedAt: null } });
      if (!expense) throw new Error('Expense is no longer active.');
      await tx.expenses.update({ where: { expenseId: id }, data: { deletedAt: now } });
      return;
    }
    case 'INVENTORY': {
      const current = await tx.inventory.findFirst({ where: { referenceId: id, deletedAt: null } });
      if (current?.jobCostId && ['GOLD', 'SCRAP'].includes(current.category)) throw new Error('Edit the linked job costing to adjust this automatic movement.');
      await tx.inventory.update({ where: { referenceId: id }, data: { deletedAt: now } });
      await validateInventoryLedger(tx); return;
    }
    case 'CLIENT': await tx.client.update({ where: { clientId: id }, data: { deletedAt: now } }); return;
  }
}

async function undoApprovedRequest(tx: Prisma.TransactionClient, request: any): Promise<void> {
  const before = (request.beforeData ?? {}) as Record<string, any>;
  if (request.action === 'UPDATE') {
    const proposed = (request.proposedData ?? {}) as Record<string, unknown>;
    const restore = Object.fromEntries(Object.keys(proposed).map(key => [key, Object.hasOwn(before, key) ? before[key] : before.client?.[key]]));
    await applyUpdate(tx, { ...request, proposedData: restore }, restore, request.entityType === 'JOB_COST' ? before : undefined);
    return;
  }
  const id = request.entityId as string;
  switch (request.entityType as Entity) {
    case 'SALE': {
      await tx.sales.update({ where: { invoiceId: id }, data: { deletedAt: null } });
      if (before.jobCostId) {
        await tx.job_Cost.update({ where: { jobCostId: before.jobCostId }, data: { deletedAt: null, inquiryId: before.job?.inquiryId ?? undefined } });
        for (const row of before.job?.inventoryMovement ?? []) if (row.category !== 'SCRAP') await tx.inventory.update({ where: { referenceId: row.referenceId }, data: { deletedAt: row.deletedAt ? new Date(row.deletedAt) : null } });
        await restoreScrapRecovery(tx, before.jobCostId, before.job?.inventoryMovement ?? []);
        await validateInventoryLedger(tx);
      }
      return;
    }
    case 'JOB_COST': {
      await tx.job_Cost.update({ where: { jobCostId: id }, data: { deletedAt: null, inquiryId: before.inquiryId ?? undefined } });
      await tx.sales.updateMany({ where: { jobCostId: id }, data: { deletedAt: null } });
      await tx.inventory.updateMany({ where: { jobCostId: id, category: { not: 'SCRAP' } }, data: { deletedAt: new Date() } });
      for (const row of before.inventoryMovement ?? []) {
        if (row.category === 'SCRAP') continue;
        await tx.inventory.update({ where: { referenceId: row.referenceId }, data: { deletedAt: row.deletedAt ? new Date(row.deletedAt) : null } });
      }
      await restoreScrapRecovery(tx, id, before.inventoryMovement ?? []);
      await validateInventoryLedger(tx);
      return;
    }
    case 'INQUIRY': await tx.inquiries.update({ where: { inquiryId: id }, data: { deletedAt: null } }); return;
    case 'EXPENSE': await tx.expenses.update({ where: { expenseId: id }, data: { deletedAt: null } }); return;
    case 'INVENTORY': await tx.inventory.update({ where: { referenceId: id }, data: { deletedAt: null } }); await validateInventoryLedger(tx); return;
    case 'CLIENT': await tx.client.update({ where: { clientId: id }, data: { deletedAt: null } }); return;
  }
}

const router = Router();
router.get('/', async (_req: Request, res: Response) => {
  const rows = await prisma.approvalRequest.findMany({
    include: { requester: { select: { empId: true, empName: true, empRole: true } }, reviewer: { select: { empId: true, empName: true } } },
    orderBy: { createdAt: 'desc' }, take: 250,
  });
  res.json(rows);
});

router.post('/:requestId/approve', async (req: Request, res: Response) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
  try {
    const result = await prisma.$transaction(async tx => {
      const approval = await tx.approvalRequest.findUnique({ where: { requestId } });
      if (!approval || approval.status !== 'PENDING') throw Object.assign(new Error('This approval request is no longer pending.'), { statusCode: 409 });
      if (approval.requesterEmpId === req.user!.empId) throw Object.assign(new Error('A different Administrator must approve this change.'), { statusCode: 403 });
      if (approval.action === 'DELETE') await applyDelete(tx, approval);
      else await applyUpdate(tx, approval, (approval.proposedData ?? {}) as Record<string, unknown>);
      return tx.approvalRequest.update({ where: { requestId }, data: { status: 'APPROVED', reviewerEmpId: req.user!.empId, reviewerNote: note, reviewedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await writeSystemLog({ actorEmpId: req.user!.empId, actorName: req.user!.empName, actorRole: req.user!.empRole, action: 'APPROVAL_APPROVED', entityType: result.entityType, entityId: result.entityId, details: { requestId, originalAction: result.action, requesterEmpId: result.requesterEmpId, note } });
    res.json({ request: result, message: 'Change approved and applied.' });
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode) || 409;
    res.status(status).json({ error: (error as Error).message || 'The change could not be applied.' });
  }
});

router.post('/:requestId/reject', async (req: Request, res: Response) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
  const result = await prisma.approvalRequest.updateMany({ where: { requestId, status: 'PENDING' }, data: { status: 'REJECTED', reviewerEmpId: req.user!.empId, reviewerNote: note, reviewedAt: new Date() } });
  if (!result.count) { res.status(409).json({ error: 'This approval request is no longer pending.' }); return; }
  const row = await prisma.approvalRequest.findUnique({ where: { requestId } });
  await writeSystemLog({ actorEmpId: req.user!.empId, actorName: req.user!.empName, actorRole: req.user!.empRole, action: 'APPROVAL_REJECTED', entityType: row?.entityType, entityId: row?.entityId, details: { requestId, note } });
  res.json({ request: row, message: 'Change rejected. The record remains unchanged.' });
});

router.post('/:requestId/undo', async (req: Request, res: Response) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  try {
    const result = await prisma.$transaction(async tx => {
      const approval = await tx.approvalRequest.findUnique({ where: { requestId } });
      if (!approval || approval.status !== 'APPROVED' || approval.reviewerEmpId !== req.user!.empId || !approval.reviewedAt) throw Object.assign(new Error('This approval can no longer be undone.'), { statusCode: 409 });
      if (Date.now() - approval.reviewedAt.getTime() > 5_000) throw Object.assign(new Error('The five-second undo window has ended.'), { statusCode: 409 });
      await undoApprovedRequest(tx, approval);
      return tx.approvalRequest.update({ where: { requestId }, data: { status: 'REJECTED', reviewerNote: 'Approval undone by reviewer.', reviewedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await writeSystemLog({ actorEmpId: req.user!.empId, actorName: req.user!.empName, actorRole: req.user!.empRole, action: 'APPROVAL_UNDONE', entityType: result.entityType, entityId: result.entityId, details: { requestId } });
    res.json({ request: result, message: 'Approval undone. The prior record state was restored.' });
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode) || 409;
    res.status(status).json({ error: (error as Error).message || 'The approval could not be undone.' });
  }
});

export default router;
