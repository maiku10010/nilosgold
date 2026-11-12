const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readableError } = require('../dist/lib/readableError');
const { validateServiceFields } = require('../dist/lib/serviceRules');
test('uses familiar field names and preserves useful instructions', () => {
  assert.equal(readableError('Enter a valid goldCostPerG.'), 'Enter a valid gold price per gram.');
  assert.equal(readableError('goldPricePerG cannot be empty.'), 'Gold price per gram cannot be empty.');
  assert.equal(readableError('Invalid value for contactNum.'), 'Invalid value for contact number.');
  assert.equal(readableError('Enter non-negative costs.'), 'Enter zero or greater costs.');
  assert.equal(readableError('Unit price must be greater than zero, or null when unknown.'), 'Unit price must be greater than zero, or leave it blank if unknown.');
  assert.equal(readableError('Not enough gold: available is 2.5 g.'), 'Not enough gold: available is 2.5 g.');
});
test('hides technical failures and explains connection problems', () => {
  assert.match(readableError('Invalid prisma.inventory.update() invocation: P2002'), /ask an administrator/);
  assert.match(readableError('AUTH_SECRET must be configured'), /ask an administrator/);
  assert.equal(readableError('Failed to fetch'), 'Could not connect. Check your internet connection and try again.');
  assert.equal(readableError({}), 'Something went wrong. Please try again.');
});
test('service errors name the field clearly and keep its identifier for the form', () => {
  assert.throws(() => validateServiceFields('Cleaning', { goldCostPerG: 10 }), error =>
    error.message === 'gold price per gram is not used for Cleaning jobs.' && error.field === 'goldCostPerG' && error.statusCode === 400);
});
