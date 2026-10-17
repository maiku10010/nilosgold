"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueStaffChanges = queueStaffChanges;
const rounding_1 = require("./rounding");
const express_1 = require("express");
const db_1 = require("./db");
const auth_1 = require("./auth");
const audit_1 = require("./audit");
const inventoryLedger_1 = require("./inventoryLedger");
const friendlyId_1 = require("./friendlyId");
const validation_1 = require("./validation");
const accounting_1 = require("./accounting");
const contextFields = new Set(['invoiceId', 'jobCostId', 'referenceId', 'inquiryId', 'expenseId', 'clientId', 'clientName']);
function requestSpec(req) {
    const segments = req.path.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments.length !== 2 || !segments[1])
        return null;
    const [resource, id] = segments;
    const resourceSpecs = {
        sales: { entity: 'SALE', allowed: ['serviceType', 'price', 'payment', 'salesDate', 'date', 'clientName', 'contactNum', 'email'] },
        'job-cost': { entity: 'JOB_COST', allowed: ['goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost', 'laborCost', 'laborCharge', 'otherCost', 'empId', 'sellingPrice', 'itemName', 'deadline', 'deliveryDate'] },
        job_costing: { entity: 'JOB_COST', allowed: ['goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost', 'laborCost', 'laborCharge', 'otherCost', 'empId', 'sellingPrice', 'itemName', 'deadline', 'deliveryDate'] },
        inquiries: { entity: 'INQUIRY', allowed: ['customerName', 'contactInfo', 'email', 'details', 'category', 'quotedPrice', 'isFullyPaid', 'date', 'inqDate'] },
        expenses: { entity: 'EXPENSE', allowed: ['category', 'amount', 'description', 'expDate', 'date'] },
        inventory: { entity: 'INVENTORY', allowed: ['itemName', 'category', 'quantityIn', 'quantityOut', 'quantityLoss', 'goldIn', 'goldOut', 'scraps', 'scrap', 'unit', 'unitPrice', 'date', 'updatedAt'] },
        // Client balance is derived from invoices and must never be manually edited.
        client: { entity: 'CLIENT', allowed: ['clientName', 'contactNum', 'email'] },
    };
    const selected = resourceSpecs[resource];
    return selected ? { entity: selected.entity, id, allowed: new Set(selected.allowed), context: contextFields } : null;
}
function json(value) {
    return JSON.parse(JSON.stringify(value));
}
async function findCurrent(entity, id) {
    switch (entity) {
        case 'SALE': return db_1.prisma.sales.findFirst({ where: { invoiceId: id, deletedAt: null }, include: { client: true, payments: true } });
        case 'JOB_COST': return db_1.prisma.job_Cost.findFirst({ where: { jobCostId: id, deletedAt: null }, include: { inquiry: true, sales: { include: { client: true } } } });
        case 'INQUIRY': return db_1.prisma.inquiries.findFirst({ where: { inquiryId: id, deletedAt: null }, include: { jobCost: true } });
        case 'EXPENSE': return db_1.prisma.expenses.findFirst({ where: { expenseId: id, deletedAt: null } });
        case 'INVENTORY': return db_1.prisma.inventory.findFirst({ where: { referenceId: id, deletedAt: null } });
        case 'CLIENT': return db_1.prisma.client.findFirst({ where: { clientId: id, deletedAt: null } });
    }
}
const numericFields = new Set(['price', 'payment', 'goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost', 'laborCost', 'laborCharge', 'otherCost', 'sellingPrice', 'quotedPrice', 'amount', 'goldIn', 'goldOut', 'scraps', 'quantityIn', 'quantityOut', 'quantityLoss', 'unitPrice']);
const positiveFields = new Set(['price', 'goldCostPerG', 'sellingPrice', 'amount', 'unitPrice']);
const nullableStringFields = new Set(['contactInfo', 'email', 'details', 'description', 'contactNum']);
function normalizedChanges(body, spec) {
    const changes = {};
    for (const [key, raw] of Object.entries(body)) {
        if (!spec.allowed.has(key)) {
            if (spec.context.has(key))
                continue;
            continue;
        }
        if (raw === undefined)
            continue;
        if (numericFields.has(key)) {
            const value = spec.entity === 'JOB_COST' ? (0, rounding_1.roundTwo)(raw) : Number(raw);
            if (!Number.isFinite(value) || value < 0 || (positiveFields.has(key) && value <= 0))
                throw new Error(`Enter a valid ${key}.`);
            changes[key] = value;
        }
        else if (key === 'isFullyPaid' && typeof raw === 'boolean') {
            changes[key] = raw;
        }
        else if (['deadline', 'deliveryDate'].includes(key)) {
            if (!(0, validation_1.isTodayOrFutureDate)(raw))
                throw new Error('Delivery date must be today or later.');
            changes[key] = new Date(`${raw}T00:00:00.000Z`).toISOString();
        }
        else if (['date', 'salesDate', 'inqDate', 'expDate', 'updatedAt'].includes(key)) {
            if (typeof raw !== 'string' || !raw || Number.isNaN(Date.parse(raw)))
                throw new Error('Enter a valid date.');
            const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
            if (date.getTime() > Date.now())
                throw new Error('Dates cannot be in the future.');
            changes[key] = date.toISOString();
        }
        else if (key === 'scrap') {
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0)
                throw new Error('Enter a valid scrap weight.');
            changes.quantityLoss = value;
        }
        else if (typeof raw === 'string') {
            const value = raw.trim();
            if (!value && !nullableStringFields.has(key))
                throw new Error(`${key} cannot be empty.`);
            if (value.length > 500)
                throw new Error(`${key} is too long.`);
            if (key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
                throw new Error('Enter a valid email address.');
            if (['contactNum', 'contactInfo'].includes(key) && value && !(0, validation_1.isValidPHContact)(raw))
                throw new Error('Enter an 11-digit Philippine mobile number starting with 09.');
            changes[key] = value || (nullableStringFields.has(key) ? null : value);
        }
        else {
            throw new Error(`Invalid value for ${key}.`);
        }
    }
    if (Object.keys(changes).length === 0)
        throw new Error('There are no editable fields in this change request.');
    return changes;
}
async function queueStaffChanges(req, res, next) {
    if (!req.user || (0, auth_1.isAdminRole)(req.user.empRole) || !['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        next();
        return;
    }
    let spec;
    try {
        spec = requestSpec(req);
    }
    catch {
        res.status(400).json({ error: 'Invalid record ID.' });
        return;
    }
    if (!spec) {
        next();
        return;
    }
    const action = req.method === 'DELETE' ? 'DELETE' : 'UPDATE';
    try {
        const current = await findCurrent(spec.entity, spec.id);
        if (!current) {
            res.status(404).json({ error: 'Record was not found or is already archived.' });
            return;
        }
        let proposedData = null;
        if (action === 'UPDATE') {
            try {
                proposedData = normalizedChanges(req.body ?? {}, spec);
            }
            catch (error) {
                res.status(400).json({ error: error.message });
                return;
            }
            if (spec.entity === 'INVENTORY') {
                const category = String(proposedData.category ?? current.category).toUpperCase();
                const unit = String(proposedData.unit ?? current.unit);
                const units = { GOLD: ['grams', 'troy oz'], SILVER: ['grams'], GEMSTONES: ['carats', 'pieces'], BOXES: ['boxes', 'pieces'], PACKAGING: ['pieces', 'boxes'], FINDINGS: ['pieces', 'grams'], TOOLS: ['pieces'] };
                if (!units[category] || !units[category].includes(unit)) {
                    res.status(400).json({ error: 'Choose a supported category and unit combination.' });
                    return;
                }
            }
            if (spec.entity === 'SALE') {
                const nextPrice = Number(proposedData.price ?? current.price);
                const nextPayment = Number(proposedData.payment ?? (0, accounting_1.paidTotal)(current.payments));
                if (nextPayment > nextPrice) {
                    res.status(400).json({ error: 'Payment cannot exceed the sale price.' });
                    return;
                }
            }
            if (spec.entity === 'SALE' && current.status === 'PENDING') {
                res.status(409).json({ error: 'Update this invoice from its pending job costing.' });
                return;
            }
            if (spec.entity === 'INQUIRY' && (current.status !== 'PENDING' || current.jobCost)) {
                res.status(409).json({ error: 'Only pending inquiries without a job costing can be edited.' });
                return;
            }
        }
        const existingRequest = await db_1.prisma.approvalRequest.findFirst({ where: { entityType: spec.entity, entityId: spec.id, status: 'PENDING' }, select: { requestId: true } });
        if (existingRequest) {
            res.status(409).json({ error: 'An Admin review is already pending for this record.', approvalId: existingRequest.requestId });
            return;
        }
        const request = await db_1.prisma.approvalRequest.create({
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
    }
    catch (error) {
        console.error('Could not create approval request:', error);
        res.status(500).json({ error: 'This change could not be sent for approval.' });
    }
}
async function applyUpdate(tx, request, changes) {
    const id = request.entityId;
    const date = (key) => changes[key] ? new Date(String(changes[key])) : undefined;
    switch (request.entityType) {
        case 'SALE': {
            const sale = await tx.sales.findFirst({ where: { invoiceId: id, deletedAt: null } });
            if (!sale)
                throw new Error('Sale is no longer active.');
            await tx.sales.update({ where: { invoiceId: id }, data: {
                    ...(changes.serviceType !== undefined ? { serviceType: changes.serviceType } : {}),
                    ...(changes.price !== undefined ? { price: changes.price } : {}),
                    ...(changes.salesDate || changes.date ? { salesDate: date('salesDate') ?? date('date') } : {}),
                } });
            if (changes.payment !== undefined)
                await (0, accounting_1.setSalePaidTotal)(tx, id, changes.payment);
            const clientData = request.proposedData;
            const clientChanges = clientData && ('clientName' in clientData || 'contactNum' in clientData || 'email' in clientData)
                ? { ...(typeof clientData.clientName === 'string' ? { clientName: clientData.clientName } : {}), ...(clientData.contactNum !== undefined ? { contactNum: clientData.contactNum } : {}), ...(clientData.email !== undefined ? { email: clientData.email } : {}) }
                : null;
            if (clientChanges)
                await tx.client.update({ where: { clientId: sale.clientId }, data: clientChanges });
            return;
        }
        case 'JOB_COST': {
            const job = await tx.job_Cost.findFirst({ where: { jobCostId: id, deletedAt: null }, include: { sales: true } });
            if (!job)
                throw new Error('Job costing is no longer active.');
            const { sellingPrice, ...jobFields } = changes;
            await tx.job_Cost.update({ where: { jobCostId: id }, data: {
                    ...(jobFields.goldUsed !== undefined ? { goldUsed: jobFields.goldUsed } : {}),
                    ...(jobFields.goldScrap !== undefined ? { goldScrap: jobFields.goldScrap } : {}),
                    ...(jobFields.goldCostPerG !== undefined ? { goldCostPerG: Number(Number(jobFields.goldCostPerG).toFixed(2)) } : {}),
                    ...(jobFields.stoneCost !== undefined ? { stoneCost: jobFields.stoneCost } : {}),
                    ...(jobFields.laborCost !== undefined ? { laborCost: jobFields.laborCost } : {}),
                    ...(jobFields.laborCharge !== undefined ? { laborCharge: jobFields.laborCharge } : {}),
                    ...(jobFields.otherCost !== undefined ? { otherCost: jobFields.otherCost } : {}),
                    ...(jobFields.itemName !== undefined ? { itemName: jobFields.itemName } : {}),
                    ...(jobFields.deadline !== undefined || jobFields.deliveryDate !== undefined ? { deadline: date('deadline') ?? date('deliveryDate') } : {}),
                    ...(typeof jobFields.empId === 'string' ? { empId: jobFields.empId } : {}),
                } });
            const movement = await tx.inventory.findFirst({ where: { jobCostId: id, category: 'GOLD' } });
            const goldUsed = Number(jobFields.goldUsed ?? job.goldUsed);
            const goldScrap = Number(jobFields.goldScrap ?? job.goldScrap);
            if (movement)
                await tx.inventory.update({ where: { referenceId: movement.referenceId }, data: { itemName: String(jobFields.itemName ?? job.itemName ?? 'Job costing gold'), quantityOut: goldUsed, quantityLoss: goldScrap, unitPrice: Number(Number(jobFields.goldCostPerG ?? job.goldCostPerG).toFixed(2)), deletedAt: goldUsed + goldScrap > 0 ? null : new Date() } });
            else if (goldUsed + goldScrap > 0)
                await tx.inventory.create({ data: { referenceId: (0, friendlyId_1.friendlyId)(), universalReferenceId: job.universalReferenceId, jobCostId: id, itemName: String(jobFields.itemName ?? job.itemName ?? 'Job costing gold'), unit: 'grams', category: 'GOLD', quantityOut: goldUsed, quantityLoss: goldScrap, unitPrice: Number(Number(jobFields.goldCostPerG ?? job.goldCostPerG).toFixed(2)) } });
            if (movement || goldUsed + goldScrap > 0)
                await (0, inventoryLedger_1.validateInventoryLedger)(tx);
            if (sellingPrice !== undefined && job.sales)
                await tx.sales.update({ where: { invoiceId: job.sales.invoiceId }, data: { price: sellingPrice } });
            return;
        }
        case 'INQUIRY':
            await tx.inquiries.update({ where: { inquiryId: id }, data: {
                    ...(changes.customerName !== undefined ? { customerName: changes.customerName } : {}),
                    ...(changes.contactInfo !== undefined ? { contactInfo: changes.contactInfo } : {}),
                    ...(changes.email !== undefined ? { email: changes.email } : {}),
                    ...(changes.details !== undefined ? { details: changes.details } : {}),
                    ...(changes.category !== undefined ? { category: changes.category } : {}),
                    ...(changes.quotedPrice !== undefined ? { quotedPrice: changes.quotedPrice } : {}),
                    ...(changes.isFullyPaid !== undefined ? { isFullyPaid: changes.isFullyPaid } : {}),
                    ...(changes.date || changes.inqDate ? { inqDate: date('inqDate') ?? date('date') } : {}),
                } });
            return;
        case 'EXPENSE':
            await tx.expenses.update({ where: { expenseId: id }, data: {
                    ...(changes.category !== undefined ? { category: changes.category } : {}),
                    ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
                    ...(changes.description !== undefined ? { description: changes.description } : {}),
                    ...(changes.expDate || changes.date ? { expDate: date('expDate') ?? date('date') } : {}),
                } });
            return;
        case 'INVENTORY': {
            const current = await tx.inventory.findUnique({ where: { referenceId: id } });
            if (!current)
                throw new Error('Inventory entry is no longer active.');
            const unitPrice = Number(changes.unitPrice ?? current.unitPrice);
            if (!Number.isFinite(unitPrice) || unitPrice <= 0)
                throw new Error('Unit price must be greater than zero.');
            const category = String(changes.category ?? current.category);
            const quantityIn = Number(changes.quantityIn ?? changes.goldIn ?? current.quantityIn);
            const quantityOut = Number(changes.quantityOut ?? changes.goldOut ?? current.quantityOut);
            const quantityLoss = Number(changes.quantityLoss ?? changes.scraps ?? current.quantityLoss);
            await tx.inventory.update({ where: { referenceId: id }, data: {
                    ...(changes.itemName !== undefined ? { itemName: changes.itemName } : {}),
                    category,
                    quantityIn, quantityOut, quantityLoss,
                    ...(changes.unitPrice !== undefined ? { unitPrice: changes.unitPrice } : {}),
                    ...(changes.unit !== undefined ? { unit: changes.unit } : {}),
                    updatedAt: date('updatedAt') ?? date('date') ?? new Date(),
                } });
            await (0, inventoryLedger_1.validateInventoryLedger)(tx);
            return;
        }
        case 'CLIENT':
            await tx.client.update({ where: { clientId: id }, data: {
                    ...(changes.clientName !== undefined ? { clientName: changes.clientName } : {}),
                    ...(changes.contactNum !== undefined ? { contactNum: changes.contactNum } : {}),
                    ...(changes.email !== undefined ? { email: changes.email } : {}),
                } });
            return;
    }
}
async function applyDelete(tx, request) {
    const now = new Date();
    const id = request.entityId;
    switch (request.entityType) {
        case 'SALE': {
            const sale = await tx.sales.findFirst({ where: { invoiceId: id, deletedAt: null }, include: { job: true } });
            if (!sale)
                throw new Error('Sale is no longer active.');
            await tx.sales.update({ where: { invoiceId: id }, data: { deletedAt: now } });
            if (sale.job) {
                await tx.job_Cost.update({ where: { jobCostId: sale.job.jobCostId }, data: { deletedAt: now, inquiryId: null } });
                if (sale.job.inquiryId)
                    await tx.inquiries.update({ where: { inquiryId: sale.job.inquiryId }, data: { status: 'PENDING' } });
            }
            return;
        }
        case 'JOB_COST': {
            const job = await tx.job_Cost.findFirst({ where: { jobCostId: id, deletedAt: null }, include: { inquiry: true, sales: true } });
            if (!job)
                throw new Error('Job costing is no longer active.');
            await tx.job_Cost.update({ where: { jobCostId: id }, data: { deletedAt: now, inquiryId: null } });
            const movements = await tx.inventory.findMany({ where: { jobCostId: id, deletedAt: null } });
            if (movements.length) {
                await tx.inventory.updateMany({ where: { jobCostId: id, deletedAt: null }, data: { deletedAt: now } });
                await (0, inventoryLedger_1.validateInventoryLedger)(tx);
            }
            if (job.sales)
                await tx.sales.update({ where: { invoiceId: job.sales.invoiceId }, data: { deletedAt: now } });
            if (job.inquiryId)
                await tx.inquiries.update({ where: { inquiryId: job.inquiryId }, data: { status: 'PENDING' } });
            return;
        }
        case 'INQUIRY': {
            const row = await tx.inquiries.findFirst({ where: { inquiryId: id, deletedAt: null }, include: { jobCost: true } });
            if (!row)
                throw new Error('Inquiry is no longer active.');
            if (row.jobCost && !row.jobCost.deletedAt)
                throw new Error('Delete the linked job costing before archiving this inquiry.');
            await tx.inquiries.update({ where: { inquiryId: id }, data: { deletedAt: now } });
            return;
        }
        case 'EXPENSE': {
            const expense = await tx.expenses.findFirst({ where: { expenseId: id, deletedAt: null } });
            if (!expense)
                throw new Error('Expense is no longer active.');
            await tx.expenses.update({ where: { expenseId: id }, data: { deletedAt: now } });
            return;
        }
        case 'INVENTORY': {
            await tx.inventory.update({ where: { referenceId: id }, data: { deletedAt: now } });
            await (0, inventoryLedger_1.validateInventoryLedger)(tx);
            return;
        }
        case 'CLIENT':
            await tx.client.update({ where: { clientId: id }, data: { deletedAt: now } });
            return;
    }
}
async function undoApprovedRequest(tx, request) {
    const before = (request.beforeData ?? {});
    if (request.action === 'UPDATE') {
        const proposed = (request.proposedData ?? {});
        const restore = Object.fromEntries(Object.keys(proposed).map(key => [key, before[key] ?? before.client?.[key]]));
        await applyUpdate(tx, { ...request, proposedData: restore }, restore);
        return;
    }
    const id = request.entityId;
    switch (request.entityType) {
        case 'SALE': {
            await tx.sales.update({ where: { invoiceId: id }, data: { deletedAt: null } });
            if (before.jobCostId)
                await tx.job_Cost.update({ where: { jobCostId: before.jobCostId }, data: { deletedAt: null, inquiryId: before.job?.inquiryId ?? undefined } });
            return;
        }
        case 'JOB_COST': {
            await tx.job_Cost.update({ where: { jobCostId: id }, data: { deletedAt: null, inquiryId: before.inquiryId ?? undefined } });
            await tx.sales.updateMany({ where: { jobCostId: id }, data: { deletedAt: null } });
            await tx.inventory.updateMany({ where: { jobCostId: id }, data: { deletedAt: null } });
            await (0, inventoryLedger_1.validateInventoryLedger)(tx);
            return;
        }
        case 'INQUIRY':
            await tx.inquiries.update({ where: { inquiryId: id }, data: { deletedAt: null } });
            return;
        case 'EXPENSE':
            await tx.expenses.update({ where: { expenseId: id }, data: { deletedAt: null } });
            return;
        case 'INVENTORY':
            await tx.inventory.update({ where: { referenceId: id }, data: { deletedAt: null } });
            await (0, inventoryLedger_1.validateInventoryLedger)(tx);
            return;
        case 'CLIENT':
            await tx.client.update({ where: { clientId: id }, data: { deletedAt: null } });
            return;
    }
}
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const rows = await db_1.prisma.approvalRequest.findMany({
        include: { requester: { select: { empId: true, empName: true, empRole: true } }, reviewer: { select: { empId: true, empName: true } } },
        orderBy: { createdAt: 'desc' }, take: 250,
    });
    res.json(rows);
});
router.post('/:requestId/approve', async (req, res) => {
    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const approval = await tx.approvalRequest.findUnique({ where: { requestId } });
            if (!approval || approval.status !== 'PENDING')
                throw Object.assign(new Error('This approval request is no longer pending.'), { statusCode: 409 });
            if (approval.requesterEmpId === req.user.empId)
                throw Object.assign(new Error('A different Administrator must approve this change.'), { statusCode: 403 });
            if (approval.action === 'DELETE')
                await applyDelete(tx, approval);
            else
                await applyUpdate(tx, approval, (approval.proposedData ?? {}));
            return tx.approvalRequest.update({ where: { requestId }, data: { status: 'APPROVED', reviewerEmpId: req.user.empId, reviewerNote: note, reviewedAt: new Date() } });
        });
        await (0, audit_1.writeSystemLog)({ actorEmpId: req.user.empId, actorName: req.user.empName, actorRole: req.user.empRole, action: 'APPROVAL_APPROVED', entityType: result.entityType, entityId: result.entityId, details: { requestId, originalAction: result.action, requesterEmpId: result.requesterEmpId, note } });
        res.json({ request: result, message: 'Change approved and applied.' });
    }
    catch (error) {
        const status = Number(error.statusCode) || 409;
        res.status(status).json({ error: error.message || 'The change could not be applied.' });
    }
});
router.post('/:requestId/reject', async (req, res) => {
    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
    const result = await db_1.prisma.approvalRequest.updateMany({ where: { requestId, status: 'PENDING' }, data: { status: 'REJECTED', reviewerEmpId: req.user.empId, reviewerNote: note, reviewedAt: new Date() } });
    if (!result.count) {
        res.status(409).json({ error: 'This approval request is no longer pending.' });
        return;
    }
    const row = await db_1.prisma.approvalRequest.findUnique({ where: { requestId } });
    await (0, audit_1.writeSystemLog)({ actorEmpId: req.user.empId, actorName: req.user.empName, actorRole: req.user.empRole, action: 'APPROVAL_REJECTED', entityType: row?.entityType, entityId: row?.entityId, details: { requestId, note } });
    res.json({ request: row, message: 'Change rejected. The record remains unchanged.' });
});
router.post('/:requestId/undo', async (req, res) => {
    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const approval = await tx.approvalRequest.findUnique({ where: { requestId } });
            if (!approval || approval.status !== 'APPROVED' || approval.reviewerEmpId !== req.user.empId || !approval.reviewedAt)
                throw Object.assign(new Error('This approval can no longer be undone.'), { statusCode: 409 });
            if (Date.now() - approval.reviewedAt.getTime() > 5_000)
                throw Object.assign(new Error('The five-second undo window has ended.'), { statusCode: 409 });
            await undoApprovedRequest(tx, approval);
            return tx.approvalRequest.update({ where: { requestId }, data: { status: 'REJECTED', reviewerNote: 'Approval undone by reviewer.', reviewedAt: new Date() } });
        });
        await (0, audit_1.writeSystemLog)({ actorEmpId: req.user.empId, actorName: req.user.empName, actorRole: req.user.empRole, action: 'APPROVAL_UNDONE', entityType: result.entityType, entityId: result.entityId, details: { requestId } });
        res.json({ request: result, message: 'Approval undone. The prior record state was restored.' });
    }
    catch (error) {
        const status = Number(error.statusCode) || 409;
        res.status(status).json({ error: error.message || 'The approval could not be undone.' });
    }
});
exports.default = router;
