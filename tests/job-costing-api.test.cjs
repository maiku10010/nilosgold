const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { Prisma } = require('@prisma/client');
const { stripDisallowedFields } = require('../dist/lib/serviceRules');

// Exercise real Express routing and JSON serialization, with no live database writes.
const prisma = {};
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const router = require('../dist/routes/job_costing').default;
const inventoryRouter = require('../dist/routes/inventory').default;
let fixture, server, baseUrl;
const decimal = value => new Prisma.Decimal(value ?? 0);
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('gt' in value) return decimal(row[key]).greaterThan(value.gt);
      if ('not' in value) return row[key] !== value.not;
      if ('in' in value) return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
}
function database() {
  const state = {
    jobs: [], invoices: [], logs: [], transactionCount: 0, writes: 0, inTransaction: false,
    inquiries: ['INQ-1', 'INQ-2'].map(inquiryId => ({ inquiryId, category: 'Custom', customerName: 'Mia', quotedPrice: 15000, status: 'PENDING', deletedAt: null })),
    inventory: [{ referenceId: 'GOLD-18K', category: 'GOLD', goldKarat: 18, itemName: 'Gold · 18K', unit: 'grams', quantityIn: decimal('1.2'), quantityOut: decimal(0), quantityLoss: decimal(0), deletedAt: null, jobCostId: null }],
  };
  const client = { clientId: 'CLIENT-1', clientName: 'Mia', email: null };
  const write = () => { assert.equal(state.inTransaction, true, 'all writes must occur inside the costing transaction'); state.writes++; };
  const jobWithRelations = job => job && ({ ...job, inquiry: state.inquiries.find(row => row.inquiryId === job.inquiryId), sales: (() => { const invoice = state.invoices.find(row => row.jobCostId === job.jobCostId); return invoice ? { ...invoice, client, payments: [] } : null; })() });
  const tx = {
    inventory: {
      findFirst: async ({ where }) => state.inventory.find(row => matches(row, where)) ?? null,
      findMany: async ({ where = {} } = {}) => state.inventory.filter(row => matches(row, where)),
      create: async ({ data }) => { write(); const row = { deletedAt: null, ...data, quantityIn: decimal(data.quantityIn), quantityOut: decimal(data.quantityOut), quantityLoss: decimal(data.quantityLoss) }; state.inventory.push(row); return row; },
      update: async ({ where, data }) => { write(); const row = state.inventory.find(row => matches(row, where)); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => { write(); const rows = state.inventory.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
    },
    inquiries: {
      findFirst: async ({ where }) => { const row = state.inquiries.find(row => matches(row, where)); return row ? { ...row, client, jobCost: state.jobs.find(job => job.inquiryId === row.inquiryId) ?? null } : null; },
      update: async ({ where, data }) => { write(); const row = state.inquiries.find(row => matches(row, where)); Object.assign(row, data); return row; },
    },
    employee: { findFirst: async () => ({ empId: 'EMP-1' }) },
    job_Cost: {
      create: async ({ data }) => { write(); const row = { deletedAt: null, goldKarat: null, ...data, inquiryId: data.inquiry.connect.inquiryId, empId: 'EMP-1', clientId: client.clientId }; state.jobs.push(row); return row; },
      findFirst: async ({ where }) => jobWithRelations(state.jobs.find(row => matches(row, where))) ?? null,
      findUniqueOrThrow: async ({ where }) => { const job = state.jobs.find(row => matches(row, where)); assert.ok(job); return jobWithRelations(job); },
      update: async ({ where, data }) => { write(); const row = state.jobs.find(row => matches(row, where)); Object.assign(row, data); return row; },
    },
    sales: {
      create: async ({ data }) => { write(); const row = { ...data, deletedAt: null, jobCostId: data.job.connect.jobCostId }; state.invoices.push(row); return row; },
      update: async ({ where, data }) => { write(); const row = state.invoices.find(row => matches(row, where)); Object.assign(row, data); return row; },
    },
    systemLog: { create: async ({ data }) => { write(); state.logs.push(data); return data; } },
  };
  Object.assign(prisma, tx, { $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    state.transactionCount++; state.inTransaction = true;
    try { return await callback(tx); } finally { state.inTransaction = false; }
  } });
  return state;
}
const body = (overrides = {}) => ({ inquiryId: 'INQ-1', clientName: 'Mia', serviceType: 'Custom', goldSourceId: 'GOLD-18K', goldUsed: '1', goldScrap: '0', goldCostPerG: 8000, laborCost: 1000, sellingPrice: 15000, ...overrides });
async function request(method, path = '', payload) {
  const response = await fetch(baseUrl + path, { method, headers: { 'content-type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  return { status: response.status, data: await response.json() };
}
function balance(category) {
  return fixture.inventory.filter(row => row.category === category && !row.deletedAt).reduce((sum, row) => sum.plus(row.quantityIn).minus(row.quantityOut).minus(row.quantityLoss), decimal(0)).toString();
}
before(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { empId: 'ADMIN', empName: 'Admin', empRole: 'Admin' }; next(); });
  app.use('/job-cost', router);
  app.use('/inventory', inventoryRouter);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/job-cost`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { fixture = database(); });

test('POST Cleaning with gold used = 2 returns 400 without writing anything', async () => {
  const result = await request('POST', '', { inquiryId: 'INQ-1', clientName: 'Mia', serviceType: 'Cleaning', goldUsed: 2, laborCost: 1000, sellingPrice: 1500 });
  assert.equal(result.status, 400);
  assert.equal(result.data.field, 'goldUsed');
  assert.equal(fixture.writes, 0);
  assert.equal(fixture.jobs.length, 0);
});

test('POST a valid Custom job without stone cost saves and responds with stoneCost null', async () => {
  const result = await request('POST', '', body());
  assert.equal(result.status, 201);
  assert.equal(result.data.stoneCost, null);
  assert.equal(fixture.jobs[0].stoneCost, null);
});

test('POST a Custom inquiry overridden to Cleaning persists cleared gold fields as null', async () => {
  const payload = stripDisallowedFields('Cleaning', body({ serviceType: 'Cleaning', goldUsed: '2', goldScrap: '.2', stoneCost: 500 }));
  const result = await request('POST', '', payload);
  assert.equal(result.status, 201);
  assert.equal(result.data.serviceType, 'Cleaning');
  for (const field of ['goldUsed', 'goldScrap', 'goldCostPerG', 'stoneCost']) {
    assert.equal(result.data[field], null);
    assert.equal(fixture.jobs[0][field], null);
  }
  assert.equal(balance('GOLD'), '1.2');
  assert.equal(balance('SCRAP'), '0');
});

test('POST 1 g used plus 0.2 g scrap deducts only 1 g gold; DELETE restores both original balances', async () => {
  fixture.inventory.push({ referenceId: 'SCRAP-OPENING', category: 'SCRAP', goldKarat: null, itemName: 'Scrap gold', unit: 'grams', quantityIn: decimal('.1'), quantityOut: decimal(0), quantityLoss: decimal(0), deletedAt: null, jobCostId: null });
  const originalGold = balance('GOLD'); const originalScrap = balance('SCRAP');
  const created = await request('POST', '', body({ goldScrap: '0.2' }));
  assert.equal(created.status, 201);
  assert.equal(balance('GOLD'), '0.2');
  assert.equal(decimal(originalGold).minus(balance('GOLD')).toString(), '1');
  assert.equal(decimal(balance('SCRAP')).minus(originalScrap).toString(), '0.2');
  const goldMovement = fixture.inventory.find(row => row.jobCostId === created.data.jobCostId && row.category === 'GOLD');
  const scrapMovement = fixture.inventory.find(row => row.jobCostId === created.data.jobCostId && row.category === 'SCRAP');
  assert.equal(goldMovement.quantityOut.toString(), '1');
  assert.equal(goldMovement.quantityLoss.toString(), '0');
  assert.equal(scrapMovement.quantityIn.toString(), '0.2');
  assert.equal(scrapMovement.goldKarat, 18);
  assert.equal(scrapMovement.universalReferenceId, created.data.jobCostId);
  const removed = await request('DELETE', `/${encodeURIComponent(created.data.jobCostId)}`);
  assert.equal(removed.status, 200);
  assert.equal(balance('GOLD'), originalGold);
  assert.equal(balance('SCRAP'), originalScrap);
  assert.equal(fixture.transactionCount, 2);
});

test('two costed jobs recover 0.1 + 0.2 as exactly 0.3, without floating-point drift', async () => {
  const first = await request('POST', '', body({ goldUsed: '.1', goldScrap: '.1' }));
  const second = await request('POST', '', body({ inquiryId: 'INQ-2', goldUsed: '.2', goldScrap: '.2' }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(balance('SCRAP'), '0.3');
  assert.equal(balance('GOLD'), '0.9');
  assert.equal(fixture.jobs.length, 2);
  const inventoryResponse = await fetch(baseUrl.replace(/\/job-cost$/, '/inventory'));
  assert.equal(inventoryResponse.status, 200);
  const rows = await inventoryResponse.json();
  assert.equal(rows.filter(row => row.category === 'SCRAP').at(-1).balance, 0.3);
  assert.equal(rows.filter(row => row.category === 'GOLD').at(-1).balance, 0.9);
});


test('labor is 30% of the saved quote on create and edit, ignoring submitted labor and sale price', async () => {
  fixture.inquiries[0].quotedPrice = '100.05';
  const created = await request('POST', '', body({ laborCost: 9999 }));
  assert.equal(created.status, 201);
  assert.equal(Number(created.data.laborCost), 30.02);
  const edited = await request('PUT', '/' + created.data.jobCostId, { invoiceId: created.data.sales.invoiceId, clientName: 'Mia', goldSourceId: 'GOLD-18K', goldUsed: '1', goldCostPerG: 8000, sellingPrice: 20000 });
  assert.equal(edited.status, 200);
  assert.equal(Number(edited.data.laborCost), 30.02);
});

for (const serviceType of ['Repair', 'Resize', 'Cleaning']) {
  test(serviceType + ' can be costed without a gold source or manual labor', async () => {
    const created = await request('POST', '', { inquiryId: 'INQ-1', clientName: 'Mia', serviceType, sellingPrice: 15000 });
    assert.equal(created.status, 201);
    assert.equal(Number(created.data.laborCost), 4500);
    assert.equal(created.data.goldKarat, null);
    assert.equal(balance('GOLD'), '1.2');
  });
}

test('Custom still requires a source and does not accept omitted source', async () => {
  const result = await request('POST', '', body({ goldSourceId: null }));
  assert.equal(result.status, 400);
  assert.equal(result.data.field, 'goldSourceId');
});
