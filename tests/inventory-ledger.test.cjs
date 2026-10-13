const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateInventoryBalances } = require('../dist/inventoryLedger');
const { isTodayOrFutureDate } = require('../dist/validation');

const movement = (referenceId, data = {}) => ({
  referenceId, category: 'GOLD', itemName: 'Gold Ring', unit: 'grams',
  quantityIn: 0, quantityOut: 0, quantityLoss: 0, ...data,
});

test('backdated gold usage is accepted when current pooled stock is sufficient', () => {
  const balances = calculateInventoryBalances([
    movement('usage', { quantityOut: 5 }),
    movement('stock', { quantityIn: 10 }),
  ]);
  assert.equal(balances.get('usage'), -5);
  assert.equal(balances.get('stock'), 5);
});

test('current aggregate stock shortages are still rejected', () => {
  assert.throws(
    () => calculateInventoryBalances([movement('stock', { quantityIn: 4 }), movement('usage', { quantityOut: 5 })]),
    /Insufficient gold stock/,
  );
});

test('gold stock is pooled across grams and troy ounces', () => {
  const balances = calculateInventoryBalances([
    movement('ounce', { unit: 'troy oz', quantityIn: 1 }),
    movement('usage', { quantityOut: 31 }),
  ]);
  assert.ok(Math.abs(balances.get('usage') - 0.1034768) < 0.000001);
});

test('deadlines must be real Manila calendar dates that are not in the past', () => {
  const now = new Date('2026-10-14T00:30:00Z');
  assert.equal(isTodayOrFutureDate('2026-10-14', now), true);
  assert.equal(isTodayOrFutureDate('2026-10-15', now), true);
  assert.equal(isTodayOrFutureDate('2026-10-13', now), false);
  assert.equal(isTodayOrFutureDate('2026-02-30', now), false);
});
