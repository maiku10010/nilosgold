const { test } = require('node:test');
const assert = require('node:assert/strict');
const prisma = {};
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const router = require('../dist/routes/inventory').default;
const handlers = router.stack.find(layer => layer.route?.path === '/:referenceId/details').route.stack;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('item details update every matching movement and preserve stock, prices and dates', async () => {
  const rows = [{ referenceId: 'IN', category: 'BOXES', itemName: 'Ring box', unit: 'pieces', quantityIn: 10, quantityOut: 0, quantityLoss: 0, unitPrice: 25, updatedAt: '2026-11-01' },
    { referenceId: 'OUT', category: 'BOXES', itemName: ' ring BOX ', unit: 'pieces', quantityIn: 0, quantityOut: 3, quantityLoss: 0, unitPrice: null, updatedAt: '2026-11-02' }];
  const original = structuredClone(rows);
  prisma.$transaction = async fn => fn({ inventory: {
    findFirst: async () => rows[0], findMany: async () => rows,
    updateMany: async ({ where, data }) => {
      assert.deepEqual(where.referenceId.in, ['IN', 'OUT']);
      assert.deepEqual(data, { itemName: 'Velvet ring box' });
      rows.forEach(row => Object.assign(row, data));
    },
  } });
  const result = response();
  await handlers[1].handle({ params: { referenceId: 'IN' }, body: { itemName: 'Velvet ring box' } }, result);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(rows.map(({ itemName, ...row }) => row), original.map(({ itemName, ...row }) => row));
  const invalid = response();
  await handlers[1].handle({ params: { referenceId: 'IN' }, body: { itemName: 'Box', quantityIn: 99 } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const denied = response();
  handlers[0].handle({ user: { empRole: 'Staff' } }, denied, () => assert.fail('must require administrator'));
  assert.equal(denied.statusCode, 403);
});
