const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { goldMaterialCost, goldWeight, syncGoldAllocation } = require('../dist/goldAllocation');
const { calculateInventoryBalances } = require('../dist/inventoryLedger');

const source = (data = {}) => ({ referenceId: '18K-IN', category: 'GOLD', goldKarat: 18, itemName: 'Gold · 18K', unit: 'grams', quantityIn: new Prisma.Decimal('1.2'), quantityOut: new Prisma.Decimal(0), quantityLoss: new Prisma.Decimal(0), deletedAt: null, jobCostId: null, ...data });
function database(rows) {
  const job = { jobCostId: 'JOB-1', goldKarat: 18, goldUsed: '0', goldScrap: '0', goldCostPerG: 8000, universalReferenceId: 'REF-1', deletedAt: null, sales: { invoiceId: 'INV-1', price: 15000, payments: [] } };
  return {
    rows, job,
    inventory: {
      findFirst: async ({ where }) => rows.find(row => !row.deletedAt && row.quantityIn.greaterThan(0) && (where.referenceId ? row.referenceId === where.referenceId : row.goldKarat === where.goldKarat)) ?? null,
      findMany: async ({ where = {} } = {}) => rows.filter(row => (!where.category || row.category === where.category) && (!Object.hasOwn(where, 'goldKarat') || row.goldKarat === where.goldKarat) && (!where.jobCostId || row.jobCostId === where.jobCostId) && (!Object.hasOwn(where, 'deletedAt') || row.deletedAt === where.deletedAt)),
      create: async ({ data }) => { const row = source(data); rows.push(row); return row; },
      update: async ({ where, data }) => { const row = rows.find(row => row.referenceId === where.referenceId); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => { rows.filter(row => where.referenceId ? where.referenceId.in.includes(row.referenceId) : row.jobCostId === where.jobCostId && row.category === where.category).forEach(row => Object.assign(row, data)); return {}; },
    },
    job_Cost: {
      findFirst: async () => job,
      update: async ({ data }) => Object.assign(job, data),
    },
  };
}
const allocation = (changes = {}) => ({ goldSourceId: '18K-IN', goldUsed: goldWeight('1'), goldScrap: goldWeight('0.2'), goldCostPerG: 8000, jobCostId: 'JOB-1', universalReferenceId: 'REF-1', ...changes });

test('exact Decimal arithmetic accepts 1 + 0.2 against 1.2 and records the selected karat', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, quantityIn: new Prisma.Decimal(10) })]);
  await syncGoldAllocation(tx, allocation());
  const movement = tx.rows.find(row => row.jobCostId === 'JOB-1');
  assert.equal(movement.goldKarat, 18);
  assert.equal(movement.itemName, 'Gold · 18K');
  assert.equal(movement.quantityOut.toString(), '1');
  assert.equal(movement.quantityLoss.toString(), '0.2');
  assert.equal(calculateInventoryBalances(tx.rows).get(movement.referenceId), 0);
});

test('shortage rejects 1 + 0.201 without borrowing stock from another karat', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, quantityIn: new Prisma.Decimal(10) })]);
  await assert.rejects(() => syncGoldAllocation(tx, allocation({ goldScrap: goldWeight('0.201') })), error => {
    assert.equal(error.field, 'goldUsed');
    assert.match(error.message, /Insufficient Gold · 18K/);
    assert.match(error.message, /available is 1.2 g/);
    return true;
  });
  assert.equal(tx.rows.length, 2);
});

test('editing credits the existing allocation before replacement and switching sources releases the old karat', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, itemName: 'Gold · 14K', quantityIn: new Prisma.Decimal(2) }),
    source({ referenceId: 'OUT', jobCostId: 'JOB-1', quantityIn: new Prisma.Decimal(0), quantityOut: new Prisma.Decimal('.8') })]);
  await syncGoldAllocation(tx, allocation());
  assert.equal(tx.rows.filter(row => row.jobCostId === 'JOB-1').length, 1);
  await syncGoldAllocation(tx, allocation({ goldSourceId: '14K-IN' }));
  assert.equal(tx.job.goldKarat, 14);
  assert.equal(tx.rows.find(row => row.referenceId === 'OUT').goldKarat, 14);
  assert.doesNotThrow(() => calculateInventoryBalances(tx.rows));
});

test('gold weights keep milligrams and reject excess precision or missing gold sources', async () => {
  assert.equal(goldWeight('0.001').toString(), '0.001');
  assert.throws(() => goldWeight('0.0001'), /3 decimal/);
  assert.throws(() => goldWeight('-1'), /non-negative/);
  await assert.rejects(() => syncGoldAllocation(database([source()]), allocation({ goldSourceId: '' })), /Choose a gold source/);
  assert.equal(goldMaterialCost('1', '.2', '8000').toString(), '9600');
  assert.equal(goldMaterialCost('.0005', '0', '8000').toString(), '4');
});

const prisma = {};
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const approvals = require('../dist/approvals');
const approve = approvals.default.stack.find(layer => layer.route?.path === '/:requestId/approve').route.stack[0].handle;
const undo = approvals.default.stack.find(layer => layer.route?.path === '/:requestId/undo').route.stack[0].handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('staff requests retain milligram precision and approval applies the chosen source once', async () => {
  const tx = database([source()]);
  Object.assign(prisma, tx);
  let queued;
  prisma.approvalRequest = {
    findFirst: async () => null,
    create: async ({ data }) => { queued = { ...data, requestId: 'APP-1', status: 'PENDING' }; return queued; },
    findUnique: async () => queued,
    update: async ({ data }) => ({ ...queued, ...data }),
  };
  prisma.systemLog = { create: async () => ({}) };
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  const pending = response();
  await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: { empId: 'STAFF', empRole: 'Staff' }, body: {
    goldSourceId: '18K-IN', goldUsed: '1.001', goldScrap: '0.199',
  } }, pending, () => assert.fail('request must be queued'));
  assert.equal(pending.statusCode, 202);
  assert.equal(queued.beforeData.goldSourceId, '18K-IN');
  assert.equal(queued.proposedData.goldUsed, '1.001');
  assert.equal(tx.rows.length, 1);
  const reviewed = response();
  await approve({ params: { requestId: 'APP-1' }, body: {}, user: { empId: 'ADMIN', empRole: 'Admin', empName: 'Admin' } }, reviewed);
  assert.equal(reviewed.statusCode, 200);
  const movement = tx.rows.find(row => row.jobCostId === 'JOB-1');
  assert.equal(movement.quantityOut.plus(movement.quantityLoss).toString(), '1.2');
  assert.equal(tx.job.goldKarat, 18);
});

test('undo restores the exact original gold allocation, including legacy unspecified-karat jobs', async () => {
  const tx = database([source()]);
  tx.job.goldKarat = null;
  tx.job.inventoryMovement = [];
  Object.assign(prisma, tx);
  let queued;
  prisma.approvalRequest = {
    findFirst: async () => null,
    create: async ({ data }) => { queued = { ...data, requestId: 'APP-UNDO', status: 'PENDING' }; return queued; },
    findUnique: async () => queued,
    update: async ({ data }) => { queued = { ...queued, ...data }; return queued; },
  };
  prisma.systemLog = { create: async () => ({}) };
  prisma.$transaction = async fn => fn(prisma);
  await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: { empId: 'STAFF', empRole: 'Staff' }, body: {
    goldSourceId: '18K-IN', goldUsed: '1', goldScrap: '.2',
  } }, response(), () => assert.fail('request must be queued'));
  const approved = response();
  const user = { empId: 'ADMIN', empRole: 'Admin', empName: 'Admin' };
  await approve({ params: { requestId: 'APP-UNDO' }, body: {}, user }, approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(tx.job.goldKarat, 18);
  const restored = response();
  await undo({ params: { requestId: 'APP-UNDO' }, user }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(tx.job.goldKarat, null);
  assert.equal(tx.rows.filter(row => row.jobCostId === 'JOB-1' && !row.deletedAt).length, 0);
  assert.equal(tx.job.goldUsed.toString(), '0');
});

test('the costing create route deducts the required gold source and persists its karat', async () => {
  const tx = database([source()]);
  Object.assign(prisma, tx);
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  prisma.inquiries = {
    findFirst: async () => ({ inquiryId: 'INQ-1', customerName: 'Mia', status: 'PENDING', jobCost: null, client: { clientId: 'CLIENT-1' }, universalReferenceId: 'REF-1' }),
    update: async () => ({}),
  };
  prisma.employee = { findFirst: async () => ({ empId: 'EMP-1' }) };
  prisma.job_Cost.create = async ({ data }) => Object.assign(tx.job, data);
  prisma.sales = { create: async ({ data }) => data };
  prisma.job_Cost.findUniqueOrThrow = async () => tx.job;
  const router = require('../dist/routes/job_costing').default;
  const create = router.stack.find(layer => layer.route?.path === '/' && layer.route?.methods.post).route.stack[0].handle;
  const result = response(); result.locals = {};
  await create({ body: {
    inquiryId: 'INQ-1', clientName: 'Mia', serviceType: 'Repair', goldSourceId: '18K-IN',
    goldUsed: '1', goldScrap: '0.2', goldCostPerG: 8000, stoneCost: 0, laborCost: 1000, sellingPrice: 15000,
  } }, result);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.goldKarat, 18);
  assert.equal(result.locals.auditRecordId, tx.job.jobCostId);
  const out = tx.rows.find(row => row.jobCostId === tx.job.jobCostId);
  assert.equal(out.quantityOut.plus(out.quantityLoss).toString(), '1.2');
});
