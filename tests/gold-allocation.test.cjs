const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { goldMaterialCost, goldWeight, syncGoldAllocation } = require('../dist/goldAllocation');
const { calculateInventoryBalances } = require('../dist/inventoryLedger');

const source = (data = {}) => ({ referenceId: '18K-IN', category: 'GOLD', goldKarat: 18, itemName: 'Gold · 18K', unit: 'grams', quantityIn: new Prisma.Decimal('1.2'), quantityOut: new Prisma.Decimal(0), quantityLoss: new Prisma.Decimal(0), deletedAt: null, jobCostId: null, ...data });
const categoryMatches = (row, category) => !category || (typeof category === 'string' ? row.category === category : category.not ? row.category !== category.not : category.in.includes(row.category));
function database(rows) {
  const job = { jobCostId: 'JOB-1', serviceType: 'Repair', goldKarat: 18, goldUsed: '0', goldScrap: '0', goldCostPerG: 8000, universalReferenceId: 'REF-1', deletedAt: null, sales: { invoiceId: 'INV-1', serviceType: 'Repair', price: 15000, payments: [] } };
  return {
    rows, job,
    inventory: {
      findFirst: async ({ where }) => rows.find(row => !row.deletedAt && row.quantityIn.greaterThan(0) && (where.referenceId ? row.referenceId === where.referenceId : row.goldKarat === where.goldKarat)) ?? null,
      findMany: async ({ where = {} } = {}) => rows.filter(row => categoryMatches(row, where.category) && (!Object.hasOwn(where, 'goldKarat') || row.goldKarat === where.goldKarat) && (!where.jobCostId || row.jobCostId === where.jobCostId) && (!Object.hasOwn(where, 'deletedAt') || row.deletedAt === where.deletedAt)),
      create: async ({ data }) => { const row = source(data); rows.push(row); return row; },
      update: async ({ where, data }) => { const row = rows.find(row => row.referenceId === where.referenceId); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => { rows.filter(row => where.referenceId ? where.referenceId.in.includes(row.referenceId) : row.jobCostId === where.jobCostId && categoryMatches(row, where.category)).forEach(row => Object.assign(row, data)); return {}; },
    },
    job_Cost: {
      findFirst: async () => job,
      update: async ({ data }) => Object.assign(job, data),
    },
  };
}
const scrapNet = (tx, karat) => tx.rows.filter(row => row.category === 'SCRAP' && !row.deletedAt && (karat === undefined || row.goldKarat === karat)).reduce((sum, row) => sum.plus(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss), new Prisma.Decimal(0)).toString();
const allocation = (changes = {}) => ({ goldSourceId: '18K-IN', goldUsed: goldWeight('1'), goldScrap: goldWeight('0.2'), goldCostPerG: 8000, jobCostId: 'JOB-1', universalReferenceId: 'REF-1', ...changes });

test('exact Decimal arithmetic accepts 1 + 0.2 against 1.2 and records the selected karat', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, quantityIn: new Prisma.Decimal(10) })]);
  await syncGoldAllocation(tx, allocation());
  const movement = tx.rows.find(row => row.jobCostId === 'JOB-1');
  assert.equal(movement.goldKarat, 18);
  assert.equal(movement.itemName, 'Gold · 18K');
  assert.equal(movement.quantityOut.toString(), '1');
  assert.equal(movement.quantityLoss.toString(), '0');
  assert.equal(scrapNet(tx), '0.2');
  assert.equal(calculateInventoryBalances(tx.rows).get(movement.referenceId), 0.2);
});

test('shortage rejects gold used above available stock without borrowing from another karat', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, quantityIn: new Prisma.Decimal(10) })]);
  await assert.rejects(() => syncGoldAllocation(tx, allocation({ goldUsed: goldWeight('1.201') })), error => {
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
  assert.equal(tx.rows.filter(row => row.jobCostId === 'JOB-1' && row.category === 'GOLD').length, 1);
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
  assert.equal(movement.quantityOut.plus(movement.quantityLoss).toString(), '1.001');
  assert.equal(scrapNet(tx), '0.199');
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
  assert.equal(tx.rows.filter(row => row.jobCostId === 'JOB-1' && row.category !== 'SCRAP' && !row.deletedAt).length, 0);
  assert.equal(scrapNet(tx), '0');
  assert.equal(tx.job.goldUsed.toString(), '0');
});

test('the costing create route deducts the required gold source and persists its karat', async () => {
  const tx = database([source()]);
  Object.assign(prisma, tx);
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  prisma.inquiries = {
    findFirst: async () => ({ inquiryId: 'INQ-1', category: 'Repair', customerName: 'Mia', quotedPrice: 15000, status: 'PENDING', jobCost: null, client: { clientId: 'CLIENT-1' }, universalReferenceId: 'REF-1' }),
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
  assert.equal(out.quantityOut.plus(out.quantityLoss).toString(), '1');
  assert.equal(scrapNet(tx), '0.2');
});


test('scrap edits append corrections, retain source purity and do not repeat identical saves', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, quantityIn: new Prisma.Decimal(10) })]);
  await syncGoldAllocation(tx, allocation());
  const original = tx.rows.find(row => row.category === 'SCRAP');
  assert.equal(original.itemName, 'Scrap gold');
  assert.equal(original.unit, 'grams');
  assert.equal(original.universalReferenceId, 'JOB-1');
  assert.equal(original.jobCostId, 'JOB-1');
  assert.equal(original.goldKarat, 18);
  assert.equal(original.quantityIn.toString(), '0.2');
  await syncGoldAllocation(tx, allocation({ goldScrap: goldWeight('.3') }));
  assert.equal(scrapNet(tx, 18), '0.3');
  const increasedCount = tx.rows.length;
  await syncGoldAllocation(tx, allocation({ goldScrap: goldWeight('.3') }));
  assert.equal(tx.rows.length, increasedCount);
  await syncGoldAllocation(tx, allocation({ goldSourceId: '14K-IN', goldScrap: goldWeight('.125') }));
  assert.equal(scrapNet(tx, 18), '0');
  assert.equal(scrapNet(tx, 14), '0.125');
  await syncGoldAllocation(tx, allocation({ goldSourceId: '14K-IN', goldScrap: goldWeight('0') }));
  assert.equal(scrapNet(tx), '0');
  await syncGoldAllocation(tx, allocation({ goldSourceId: '14K-IN', goldScrap: goldWeight('.001') }));
  assert.equal(scrapNet(tx), '0.001');
  assert.equal(original.quantityIn.toString(), '0.2');
  assert.equal(tx.rows.filter(row => row.category === 'SCRAP' && row.deletedAt).length, 0);
});

test('scrap pools all karats without consuming or replenishing usable gold', async () => {
  const tx = database([source()]);
  await syncGoldAllocation(tx, allocation({ goldUsed: goldWeight('1.2'), goldScrap: goldWeight('2') }));
  assert.equal(scrapNet(tx), '2');
  await assert.rejects(() => syncGoldAllocation(tx, allocation({ jobCostId: 'JOB-2', goldUsed: goldWeight('.001'), goldScrap: goldWeight('0') })), /Insufficient/);
  const pooled = [source({ category: 'SCRAP', goldKarat: 18 }), source({ category: 'SCRAP', goldKarat: 14, referenceId: 'SCRAP-OUT', quantityIn: new Prisma.Decimal(0), quantityOut: new Prisma.Decimal('.1') })];
  assert.equal(calculateInventoryBalances(pooled).get('SCRAP-OUT'), 1.1);
});

test('job deletion reverses scrap and archives gold deductions in the same serializable transaction', async () => {
  const tx = database([source()]);
  tx.job.sales = null;
  Object.assign(prisma, tx);
  await syncGoldAllocation(tx, allocation());
  let transactions = 0;
  prisma.$transaction = async (fn, options) => { transactions++; assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  const router = require('../dist/routes/job_costing').default;
  const remove = router.stack.find(layer => layer.route?.methods.delete).route.stack[0].handle;
  const result = response();
  await remove({ params: { jobCostId: 'JOB-1' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(transactions, 1);
  assert.ok(tx.job.deletedAt);
  assert.equal(tx.rows.filter(row => row.jobCostId === 'JOB-1' && row.category !== 'SCRAP' && !row.deletedAt).length, 0);
  assert.equal(scrapNet(tx), '0');
  assert.doesNotThrow(() => calculateInventoryBalances(tx.rows.filter(row => !row.deletedAt)));
});

test('costing API rejects disabled fields with 400 and permits labor-only Cleaning without a gold source', async () => {
  const tx = database([source()]);
  Object.assign(prisma, tx);
  let transactions = 0;
  prisma.$transaction = async fn => { transactions++; return fn(prisma); };
  prisma.inquiries = { findFirst: async () => ({ inquiryId: 'INQ-1', category: 'Cleaning', customerName: 'Mia', quotedPrice: 15000, status: 'PENDING', client: { clientId: 'C' } }), update: async () => ({}) };
  prisma.employee = { findFirst: async () => ({ empId: 'E' }) };
  prisma.job_Cost.create = async ({ data }) => Object.assign(tx.job, data);
  prisma.job_Cost.findUniqueOrThrow = async () => tx.job;
  prisma.sales = { create: async ({ data }) => data };
  const router = require('../dist/routes/job_costing').default;
  const create = router.stack.find(layer => layer.route?.path === '/' && layer.route?.methods.post).route.stack[0].handle;
  const base = { inquiryId: 'INQ-1', clientName: 'Mia', serviceType: 'Cleaning', goldUsed: null, goldScrap: null, goldSourceId: null, goldCostPerG: null, stoneCost: null, laborCost: 1000, sellingPrice: 1500 };
  for (const fields of [{ goldUsed: 1 }, { goldSourceId: '18K-IN' }, { goldScrap: '.2' }, { stoneCost: 0 }]) {
    const result = response(); result.locals = {};
    await create({ body: { ...base, ...fields } }, result);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(transactions, 0);
  const result = response(); result.locals = {};
  await create({ body: base }, result);
  assert.equal(result.statusCode, 201);
  assert.equal(transactions, 1);
  assert.equal(tx.rows.length, 1);
});


test('approval edit and undo restore the original scrap amount and karat without duplicate stock', async () => {
  const tx = database([source(), source({ referenceId: '14K-IN', goldKarat: 14, quantityIn: new Prisma.Decimal(10) })]);
  await syncGoldAllocation(tx, allocation());
  tx.job.goldUsed = '1'; tx.job.goldScrap = '.2';
  tx.job.inventoryMovement = JSON.parse(JSON.stringify(tx.rows.filter(row => row.jobCostId === 'JOB-1')));
  Object.assign(prisma, tx);
  let queued;
  prisma.approvalRequest = {
    findFirst: async () => null,
    create: async ({ data }) => (queued = { ...data, requestId: 'APP-SCRAP', status: 'PENDING' }),
    findUnique: async () => queued,
    update: async ({ data }) => (queued = { ...queued, ...data }),
  };
  prisma.systemLog = { create: async () => ({}) };
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: { empId: 'STAFF', empRole: 'Staff' }, body: { goldSourceId: '14K-IN', goldScrap: '.125' } }, response(), () => assert.fail('must queue'));
  const user = { empId: 'ADMIN', empRole: 'Admin', empName: 'Admin' };
  const approved = response();
  await approve({ params: { requestId: 'APP-SCRAP' }, body: {}, user }, approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(scrapNet(tx, 18), '0');
  assert.equal(scrapNet(tx, 14), '0.125');
  const restored = response();
  await undo({ params: { requestId: 'APP-SCRAP' }, user }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(scrapNet(tx, 18), '0.2');
  assert.equal(scrapNet(tx, 14), '0');
  assert.equal(scrapNet(tx), '0.2');
});

test('staff and direct edits validate the stored service type rather than a spoofed payload type', async () => {
  const tx = database([source()]); tx.job.serviceType = 'Cleaning'; tx.job.sales.serviceType = 'Cleaning';
  Object.assign(prisma, tx);
  const queued = response();
  await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: { empId: 'STAFF', empRole: 'Staff' }, body: { serviceType: 'Repair', goldUsed: 1 } }, queued, () => assert.fail('must reject'));
  assert.equal(queued.statusCode, 400);
  prisma.$transaction = async fn => fn(prisma);
  const router = require('../dist/routes/job_costing').default;
  const edit = router.stack.find(layer => layer.route?.methods.put).route.stack[0].handle;
  const result = response();
  await edit({ params: { jobCostId: 'JOB-1' }, body: { invoiceId: 'INV-1', clientName: 'Mia', serviceType: 'Repair', goldUsed: 1, goldCostPerG: 8000, laborCost: 1000, sellingPrice: 15000 } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(tx.rows.length, 1);
});


test('direct Resize edits store stone cost as null and preserve measured-zero labor and scrap', async () => {
  const tx = database([source()]);
  tx.job.serviceType = 'Resize';
  tx.job.sales = { ...tx.job.sales, serviceType: 'Resize', client: { clientName: 'Mia' } };
  Object.assign(prisma, tx);
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  prisma.job_Cost.findUniqueOrThrow = async () => tx.job;
  prisma.sales = { update: async () => ({}) };
  const router = require('../dist/routes/job_costing').default;
  const edit = router.stack.find(layer => layer.route?.methods.put).route.stack[0].handle;
  const result = response();
  await edit({ params: { jobCostId: 'JOB-1' }, body: { invoiceId: 'INV-1', clientName: 'Mia', goldSourceId: '18K-IN', goldUsed: '1', goldScrap: '0', goldCostPerG: 8000, stoneCost: null, laborCost: 0, sellingPrice: 15000 } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.stoneCost, null);
  assert.equal(result.body.laborCost, 4500);
  assert.equal(result.body.goldScrap.toString(), '0');
});

test('Cleaning staff edits retain nulls through approval and undo and reject forbidden values', async () => {
  const tx = database([source()]);
  Object.assign(tx.job, { goldUsed: null, goldScrap: null, goldCostPerG: null, stoneCost: null, laborCost: 1000, goldKarat: null, inventoryMovement: [] });
  tx.job.serviceType = 'Cleaning'; tx.job.sales.serviceType = 'Cleaning';
  Object.assign(prisma, tx);
  let queued;
  prisma.approvalRequest = {
    findFirst: async () => null,
    create: async ({ data }) => (queued = { ...data, requestId: 'APP-NULL', status: 'PENDING' }),
    findUnique: async () => queued,
    update: async ({ data }) => (queued = { ...queued, ...data }),
  };
  prisma.systemLog = { create: async () => ({}) };
  prisma.$transaction = async fn => fn(prisma);
  const staff = { empId: 'STAFF', empRole: 'Staff' };
  for (const value of [0, '0', 100, '']) {
    const rejected = response();
    await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: staff, body: { stoneCost: value } }, rejected, () => assert.fail('must reject'));
    assert.equal(rejected.statusCode, 400);
  }
  const pending = response();
  await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: staff, body: { goldUsed: null, goldScrap: null, goldCostPerG: null, goldSourceId: null, stoneCost: null, laborCost: 1200 } }, pending, () => assert.fail('must queue'));
  assert.equal(pending.statusCode, 202);
  assert.equal(queued.proposedData.goldCostPerG, null);
  assert.equal(queued.proposedData.stoneCost, null);
  const user = { empId: 'ADMIN', empRole: 'Admin', empName: 'Admin' };
  const approved = response();
  await approve({ params: { requestId: 'APP-NULL' }, body: {}, user }, approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(tx.job.laborCost, 4500);
  for (const key of ['goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost']) assert.equal(tx.job[key], null);
  const restored = response();
  await undo({ params: { requestId: 'APP-NULL' }, user }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(tx.job.laborCost, 1000);
  for (const key of ['goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost']) assert.equal(tx.job[key], null);
});


test('Repair and Custom creates preserve omitted/null stone costs and explicitly entered zero', async () => {
  const router = require('../dist/routes/job_costing').default;
  const create = router.stack.find(layer => layer.route?.path === '/' && layer.route?.methods.post).route.stack[0].handle;
  for (const type of ['Repair', 'Custom']) {
    for (const stoneCost of [undefined, null, 0, 500]) {
      const tx = database([source()]); Object.assign(prisma, tx);
      prisma.$transaction = async fn => fn(prisma);
      prisma.inquiries = { findFirst: async () => ({ inquiryId: 'INQ-1', category: type, customerName: 'Mia', quotedPrice: 15000, status: 'PENDING', client: { clientId: 'C' } }), update: async () => ({}) };
      prisma.employee = { findFirst: async () => ({ empId: 'E' }) };
      prisma.job_Cost.create = async ({ data }) => Object.assign(tx.job, data);
      prisma.job_Cost.findUniqueOrThrow = async () => tx.job;
      prisma.sales = { create: async ({ data }) => data };
      const result = response(); result.locals = {};
      await create({ body: { inquiryId: 'INQ-1', clientName: 'Mia', serviceType: type, goldSourceId: '18K-IN', goldUsed: '.5', goldScrap: 0, goldCostPerG: 8000, laborCost: 1000, sellingPrice: 15000, ...(stoneCost === undefined ? {} : { stoneCost }) } }, result);
      assert.equal(result.statusCode, 201);
      assert.equal(result.body.stoneCost, stoneCost ?? null);
    }
  }
});

test('Repair edits can clear a previous stone cost and reject invalid values with 400', async () => {
  const tx = database([source()]); tx.job.stoneCost = 500;
  tx.job.sales.client = { clientName: 'Mia' };
  Object.assign(prisma, tx);
  prisma.$transaction = async fn => fn(prisma);
  prisma.job_Cost.findUniqueOrThrow = async () => tx.job;
  prisma.sales = { update: async () => ({}) };
  const router = require('../dist/routes/job_costing').default;
  const edit = router.stack.find(layer => layer.route?.methods.put).route.stack[0].handle;
  const base = { invoiceId: 'INV-1', clientName: 'Mia', goldSourceId: '18K-IN', goldUsed: '.5', goldScrap: 0, goldCostPerG: 8000, laborCost: 1000, sellingPrice: 15000 };
  for (const stoneCost of [-1, -0.001, 'bad', false]) {
    const invalid = response();
    await edit({ params: { jobCostId: 'JOB-1' }, body: { ...base, stoneCost } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.field, 'stoneCost');
    assert.equal(tx.job.stoneCost, 500);
  }
  const cleared = response();
  await edit({ params: { jobCostId: 'JOB-1' }, body: { ...base, stoneCost: null } }, cleared);
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.stoneCost, null);
});

test('Repair staff can request clearing stone cost and approval undo restores its previous amount', async () => {
  const tx = database([source()]); tx.job.stoneCost = 500; tx.job.inventoryMovement = [];
  Object.assign(prisma, tx);
  let queued;
  prisma.approvalRequest = {
    findFirst: async () => null,
    create: async ({ data }) => (queued = { ...data, requestId: 'APP-STONE', status: 'PENDING' }),
    findUnique: async () => queued,
    update: async ({ data }) => (queued = { ...queued, ...data }),
  };
  prisma.systemLog = { create: async () => ({}) };
  prisma.$transaction = async fn => fn(prisma);
  const pending = response();
  await approvals.queueStaffChanges({ method: 'PUT', path: '/job-cost/JOB-1', user: { empId: 'STAFF', empRole: 'Staff' }, body: { stoneCost: null } }, pending, () => assert.fail('must queue'));
  assert.equal(pending.statusCode, 202);
  assert.equal(queued.proposedData.stoneCost, null);
  assert.equal(queued.beforeData.stoneCost, 500);
  const user = { empId: 'ADMIN', empRole: 'Admin', empName: 'Admin' };
  const approved = response();
  await approve({ params: { requestId: 'APP-STONE' }, body: {}, user }, approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(tx.job.stoneCost, null);
  const restored = response();
  await undo({ params: { requestId: 'APP-STONE' }, user }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(tx.job.stoneCost, 500);
});


test('costing inherits the original inquiry service type and audits only an actual override', async () => {
  const router = require('../dist/routes/job_costing').default;
  const create = router.stack.find(layer => layer.route?.path === '/' && layer.route?.methods.post).route.stack[0].handle;
  for (const [original, chosen] of [['Cleaning', undefined], ['Custom', 'Custom'], ['Custom', 'Cleaning'], ['Cleaning', 'Repair']]) {
    const tx = database([source()]); Object.assign(prisma, tx);
    const logs = []; let inTransaction = false;
    prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); inTransaction = true; try { return await fn(prisma); } finally { inTransaction = false; } };
    prisma.inquiries = { findFirst: async () => ({ inquiryId: 'INQ-1', category: original, customerName: 'Mia', quotedPrice: 15000, status: 'PENDING', client: { clientId: 'C' } }), update: async () => ({}) };
    prisma.employee = { findFirst: async () => ({ empId: 'E' }) };
    prisma.job_Cost.create = async ({ data }) => Object.assign(tx.job, data);
    prisma.job_Cost.findUniqueOrThrow = async () => tx.job;
    let invoiceType;
    prisma.sales = { create: async ({ data }) => { invoiceType = data.serviceType; return data; } };
    prisma.systemLog = { create: async ({ data }) => { assert.equal(inTransaction, true); logs.push(data); return data; } };
    const effective = chosen ?? original;
    const body = { inquiryId: 'INQ-1', clientName: 'Mia', laborCost: 1000, sellingPrice: 15000,
      ...(chosen ? { serviceType: chosen } : {}),
      ...(effective === 'Cleaning' ? {} : { goldSourceId: '18K-IN', goldUsed: '.5', goldCostPerG: 8000 }),
    };
    const result = response(); result.locals = {};
    await create({ body, user: { empId: 'STAFF', empName: 'Anna', empRole: 'Staff' } }, result);
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.serviceType, effective);
    assert.equal(invoiceType, effective);
    assert.equal(logs.length, effective === original ? 0 : 1);
    if (logs.length) {
      assert.equal(logs[0].entityId, tx.job.jobCostId);
      assert.equal(logs[0].entityType, 'JOB_COST');
      assert.equal(logs[0].actorEmpId, 'STAFF');
      assert.deepEqual(logs[0].details.before, { serviceType: original });
      assert.deepEqual(logs[0].details.after, { serviceType: effective });
      assert.equal(logs[0].details.inquiryId, 'INQ-1');
    }
  }
});

test('costing validation uses the job service type even if its invoice type differs', async () => {
  const tx = database([source()]); tx.job.serviceType = 'Cleaning'; tx.job.sales.serviceType = 'Repair';
  Object.assign(prisma, tx); prisma.$transaction = async fn => fn(prisma);
  const router = require('../dist/routes/job_costing').default;
  const edit = router.stack.find(layer => layer.route?.methods.put).route.stack[0].handle;
  const result = response();
  await edit({ params: { jobCostId: 'JOB-1' }, body: { invoiceId: 'INV-1', clientName: 'Mia', goldUsed: 1, goldCostPerG: 8000, laborCost: 1000, sellingPrice: 15000 } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(tx.rows.length, 1);
});

test('inquiry API exposes its stored category as the canonical serviceType', async () => {
  prisma.inquiries = { findMany: async () => [{ inquiryId: 'INQ-1', category: 'Cleaning' }, { inquiryId: 'INQ-2', category: 'Custom' }] };
  const router = require('../dist/routes/inquiries').default;
  const list = router.stack.find(layer => layer.route?.methods.get).route.stack[0].handle;
  const result = response();
  await list({}, result);
  assert.deepEqual(result.body.map(row => row.serviceType), ['Cleaning', 'Custom']);
});


test('approved job deletion and undo append scrap reversal and recovery without deleting history', async () => {
  const tx = database([source()]); tx.job.sales = null;
  await syncGoldAllocation(tx, allocation());
  tx.job.inventoryMovement = JSON.parse(JSON.stringify(tx.rows.filter(row => row.jobCostId === 'JOB-1')));
  Object.assign(prisma, tx);
  let queued;
  prisma.approvalRequest = {
    findFirst: async () => null,
    create: async ({ data }) => (queued = { ...data, requestId: 'APP-DELETE-SCRAP', status: 'PENDING' }),
    findUnique: async () => queued,
    update: async ({ data }) => (queued = { ...queued, ...data }),
  };
  prisma.systemLog = { create: async () => ({}) };
  prisma.sales = { updateMany: async () => ({}) };
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  const pending = response();
  await approvals.queueStaffChanges({ method: 'DELETE', path: '/job-cost/JOB-1', user: { empId: 'STAFF', empRole: 'Staff' } }, pending, () => assert.fail('must queue'));
  assert.equal(pending.statusCode, 202);
  const user = { empId: 'ADMIN', empRole: 'Admin', empName: 'Admin' };
  const approved = response();
  await approve({ params: { requestId: 'APP-DELETE-SCRAP' }, body: {}, user }, approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(scrapNet(tx), '0');
  assert.ok(tx.job.deletedAt);
  const restored = response();
  await undo({ params: { requestId: 'APP-DELETE-SCRAP' }, user }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(tx.job.deletedAt, null);
  assert.equal(scrapNet(tx), '0.2');
  assert.equal(tx.rows.filter(row => row.category === 'SCRAP' && !row.deletedAt).length, 3);
});

test('scrap API exposes job reference, source karat, signed grams and one pooled balance', async () => {
  const tx = database([
    source({ referenceId: 'S-1', category: 'SCRAP', jobCostId: 'JOB-1', goldKarat: 18, quantityIn: new Prisma.Decimal('.1') }),
    source({ referenceId: 'S-2', category: 'SCRAP', jobCostId: 'JOB-2', goldKarat: 14, quantityIn: new Prisma.Decimal('.2') }),
  ]);
  Object.assign(prisma, tx);
  const router = require('../dist/routes/inventory').default;
  const list = router.stack.find(layer => layer.route?.methods.get).route.stack[0].handle;
  const result = response();
  await list({ query: {} }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body[0].jobId, 'JOB-1');
  assert.equal(result.body[0].sourceKarat, 18);
  assert.equal(result.body[0].grams, '0.1');
  assert.equal(result.body[1].sourceKarat, 14);
  assert.equal(result.body[1].balance, .3);
});


test('customer gold works without stock and switching sources restores shop stock', async () => {
  const tx = database([]);
  await syncGoldAllocation(tx, allocation({ goldSourceId: 'CUSTOMER_GOLD', goldCostPerG: 0 }));
  assert.equal(tx.job.customerGold, true);
  assert.equal(tx.job.goldKarat, null);
  assert.equal(tx.rows.length, 0);
  tx.rows.push(source());
  await syncGoldAllocation(tx, allocation());
  assert.equal(tx.job.customerGold, false);
  assert.equal(tx.job.goldKarat, 18);
  assert.equal(scrapNet(tx), '0.2');
  await syncGoldAllocation(tx, allocation({ goldSourceId: 'CUSTOMER_GOLD' }));
  assert.equal(tx.job.customerGold, true);
  assert.equal(tx.job.goldKarat, null);
  assert.equal(scrapNet(tx), '0');
  assert.ok(tx.rows.filter(row => row.category === 'GOLD' && row.jobCostId === 'JOB-1').every(row => row.deletedAt));
});
