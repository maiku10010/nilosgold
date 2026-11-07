const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Prisma } = require('@prisma/client');
const stock = { referenceId: 'purchase-1', category: 'GOLD', itemName: 'Gold', quantityIn: new Prisma.Decimal(2), unitPrice: new Prisma.Decimal(100), unit: 'grams', updatedAt: new Date(), deletedAt: null };
const archived = new Map();
const prisma = {
  inventory: { findMany: async () => [stock], findFirst: async ({ where }) => where.referenceId === stock.referenceId ? stock : null },
  expenses: {
    findMany: async ({ where }) => where.deletedAt === null ? [] : [...archived.values()],
    upsert: async ({ where, create, update }) => {
      archived.set(where.expenseId, archived.has(where.expenseId) ? { ...archived.get(where.expenseId), ...update } : create);
    },
  },
};
prisma.$transaction = async fn => fn(prisma);
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const route = require('../dist/routes/expenses').default;
test('archiving an inventory expense hides only that expense and retains stock and purchase values', async () => {
  const app = express(); app.use('/expenses', route);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/expenses`;
  const original = JSON.stringify(stock);
  try {
    const initial = await (await fetch(base)).json();
    assert.equal(initial.length, 1); assert.equal(initial[0].amount, 200);
    assert.equal((await fetch(base + '/inventory-purchase-1', { method: 'DELETE' })).status, 200);
    assert.deepEqual(await (await fetch(base)).json(), []);
    assert.equal(JSON.stringify(stock), original);
    assert.equal(Number(archived.get('inventory-purchase-1').amount), 200);
    assert.ok(archived.get('inventory-purchase-1').deletedAt instanceof Date);
    assert.equal((await fetch(base + '/inventory-purchase-1', { method: 'DELETE' })).status, 200);
    assert.equal(archived.size, 1);
    assert.equal((await fetch(base + '/inventory-missing', { method: 'DELETE' })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
