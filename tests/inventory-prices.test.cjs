const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Prisma } = require('@prisma/client');
let rows = [], requests = [];
const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === 'object') {
    if ('gt' in value) return Number(row[key]) > value.gt;
    if ('not' in value) return row[key] !== value.not;
  }
  return row[key] === value;
});
const prisma = {
  inventory: {
    findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
    findUnique: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
    findMany: async ({ where = {} } = {}) => rows.filter(row => matches(row, where)),
    create: async ({ data }) => { const row = { deletedAt: null, ...data }; rows.push(row); return row; },
    update: async ({ where, data }) => { const row = rows.find(row => matches(row, where)); Object.assign(row, data); return row; },
  },
  expenses: { findMany: async () => [] },
  approvalRequest: {
    findFirst: async ({ where }) => requests.find(row => matches(row, where)) ?? null,
    findUnique: async ({ where }) => requests.find(row => matches(row, where)) ?? null,
    create: async ({ data }) => { const row = { requestId: String(requests.length + 1), status: 'PENDING', ...data }; requests.push(row); return row; },
    update: async ({ where, data }) => { const row = requests.find(row => matches(row, where)); Object.assign(row, data); return row; },
  },
  systemLog: { create: async ({ data }) => data },
};
prisma.$transaction = async work => work(prisma);
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const inventory = require('../dist/routes/inventory').default;
const expenses = require('../dist/routes/expenses').default;
const approvals = require('../dist/approvals');

test('unknown prices survive inventory writes and staff approval, and enter expenses only once priced', async () => {
  rows = []; requests = [];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { empId: req.header('x-staff') ? 'STAFF' : 'ADMIN', empName: 'Test', empRole: req.header('x-staff') ? 'Staff' : 'Admin' }; next();
  });
  app.use(approvals.queueStaffChanges);
  app.use('/inventory', inventory); app.use('/expenses', expenses); app.use('/approvals', approvals.default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const call = async (path, body, method = 'POST', staff = false) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(staff ? { 'x-staff': '1' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const movement = { category: 'GEMSTONES', itemName: 'Moissanite', unit: 'pieces', quantityIn: 5, unitPrice: null };
  try {
    const created = await call('/inventory', movement);
    assert.equal(created.status, 201); assert.equal(created.data.unitPrice, null);
    const path = '/inventory/' + created.data.referenceId;
    const unchanged = await call(path, { quantityIn: 6 }, 'PUT');
    assert.equal(unchanged.status, 200); assert.equal(unchanged.data.unitPrice, null);
    assert.deepEqual((await call('/expenses', undefined, 'GET')).data, []);
    const priced = await call(path, { quantityIn: 6, unitPrice: 100 }, 'PUT');
    assert.equal(priced.status, 200);
    const purchases = await call('/expenses', undefined, 'GET');
    assert.equal(purchases.data.length, 1); assert.equal(purchases.data[0].amount, 600);
    const queued = await call(path, { unitPrice: null }, 'PUT', true);
    assert.equal(queued.status, 202); assert.equal(requests[0].proposedData.unitPrice, null);
    const approved = await call('/approvals/' + requests[0].requestId + '/approve', {});
    assert.equal(approved.status, 200); assert.equal(rows[0].unitPrice, null);
    assert.deepEqual((await call('/expenses', undefined, 'GET')).data, []);
    // Omitted prices preserve a known Decimal instead of converting it to null.
    rows[0].unitPrice = new Prisma.Decimal(125);
    const retained = await call(path, { quantityIn: 6 }, 'PUT');
    assert.equal(retained.status, 200); assert.equal(Number(retained.data.unitPrice), 125);
    for (const unitPrice of [0, -1, '', 'invalid', false]) {
      assert.equal((await call(path, { quantityIn: 6, unitPrice }, 'PUT')).status, 400);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
