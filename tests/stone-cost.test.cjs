const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jobCostingSchema, parseStoneCost } = require('../dist/lib/jobCostingSchema');
test('stone cost schema accepts omitted, null, explicit zero and non-negative numbers', () => {
  for (const value of [undefined, null, 0, 6105, 1.005]) assert.equal(jobCostingSchema.safeParse({ stoneCost: value }).success, true);
  assert.equal(jobCostingSchema.safeParse({}).success, true);
  assert.equal(parseStoneCost(undefined), null);
  assert.equal(parseStoneCost(null), null);
  assert.equal(parseStoneCost(0), 0);
  assert.equal(parseStoneCost(1.005), 1.01);
});
test('invalid or negative stone costs produce a 400 field error before rounding', () => {
  for (const value of [-1, -0.001, NaN, Infinity, '100', '', false, {}]) {
    assert.equal(jobCostingSchema.safeParse({ stoneCost: value }).success, false);
    assert.throws(() => parseStoneCost(value), error => error.statusCode === 400 && error.field === 'stoneCost');
  }
});
