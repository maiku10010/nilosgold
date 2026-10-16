const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roundTwo } = require('../dist/rounding');

test('costs round to two decimal places without binary halfway errors', () => {
  for (const [input, expected] of [['1234.567', 1234.57], [1.005, 1.01], [2.675, 2.68], [0.1 + 0.2, 0.3], [-1.005, -1.01], [0, 0]]) {
    assert.equal(roundTwo(input), expected);
  }
  assert.ok(Number.isNaN(roundTwo('invalid')));
});

require.cache[require.resolve('../dist/db')] = { exports: { prisma: { inventory: { findFirst: async () => ({ category: 'GOLD', itemName: 'Gold', unit: 'grams' }) } } } };
const express = require('express');
const router = require('../dist/routes/inventory').default;
test('inventory create and update reject zero, missing, negative and invalid unit prices', async () => {
  const app = express(); app.use(express.json()); app.use('/inventory', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const method of ['POST', 'PUT']) for (const unitPrice of [undefined, 0, -1, '', 'invalid']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/inventory${method === 'PUT' ? '/existing' : ''}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemName: 'Gold', quantityIn: 1, unitPrice }),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /greater than zero/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
