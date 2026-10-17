const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SERVICE_RULES, validateServiceFields, getAllowedFields, stripDisallowedFields } = require('../dist/lib/serviceRules');
const { serviceCost } = require('../dist/serviceCost');
const all = { goldSourceId: '18K-IN', goldUsed: '1', goldScrap: '.2', goldCostPerG: 8000, stoneCost: 500, laborCost: 1000 };
const cases = {
  Repair: { fields: Object.keys(all), total: '11100' },
  Custom: { fields: Object.keys(all), total: '11100' },
  Resize: { fields: Object.keys(all).filter(key => key !== 'stoneCost'), total: '10600' },
  Cleaning: { fields: ['laborCost'], total: '1000' },
};
for (const [type, expected] of Object.entries(cases)) {
  test(`${type} accepts exactly its configured cost fields and ignores disabled costs in totals`, () => {
    const accepted = Object.fromEntries(expected.fields.map(key => [key, all[key]]));
    assert.equal(validateServiceFields(type, accepted), SERVICE_RULES[type]);
    for (const key of Object.keys(all)) {
      if (expected.fields.includes(key)) continue;
      for (const value of [all[key], 0, "0", "", false]) {
        assert.throws(() => validateServiceFields(type, { ...accepted, [key]: value }), error => error.statusCode === 400 && error.field === key);
      }
    }
    assert.doesNotThrow(() => validateServiceFields(type, stripDisallowedFields(type, accepted)));
    assert.equal(serviceCost(type, all).toString(), expected.total);
  });
}
test('unknown service types cannot bypass the contract', () => {
  for (const type of ['Other', '__proto__', undefined]) assert.throws(() => validateServiceFields(type, {}), error => error.statusCode === 400);
});

const expectedAllowed = {
  Repair: ['goldSourceId', 'goldUsed', 'goldCostPerG', 'goldScrap', 'stoneCost', 'laborCost', 'laborCharge'],
  Custom: ['goldSourceId', 'goldUsed', 'goldCostPerG', 'goldScrap', 'stoneCost', 'laborCost', 'laborCharge'],
  Resize: ['goldSourceId', 'goldUsed', 'goldCostPerG', 'goldScrap', 'laborCost', 'laborCharge'],
  Cleaning: ['laborCost', 'laborCharge'],
};
for (const [type, allowed] of Object.entries(expectedAllowed)) {
  test(`${type} lists allowed fields and clears only disabled fields without mutating the payload`, () => {
    const original = Object.freeze({ goldSourceId: 'GOLD-18K', goldUsed: '1.2', goldCostPerG: 8000, goldScrap: '0.2', stoneCost: 0, laborCost: 1000, laborCharge: 1500, sellingPrice: 15000, clientName: 'Mia' });
    assert.deepEqual(getAllowedFields(type).sort(), [...allowed].sort());
    const stripped = stripDisallowedFields(type, original);
    assert.notEqual(stripped, original);
    for (const key of expectedAllowed.Custom) assert.equal(stripped[key], allowed.includes(key) ? original[key] : null);
    assert.equal(stripped.sellingPrice, original.sellingPrice);
    assert.equal(stripped.clientName, original.clientName);
    assert.equal(original.goldUsed, '1.2');
    assert.deepEqual(stripDisallowedFields(type, stripped), stripped);
    const empty = stripDisallowedFields(type, {});
    for (const key of expectedAllowed.Custom) assert.equal(Object.hasOwn(empty, key), !allowed.includes(key));
    assert.deepEqual(getAllowedFields(type).sort(), [...allowed].sort());
  });
}
test('helpers reject unknown services instead of silently allowing fields', () => {
  for (const type of ['Other', '__proto__', undefined]) {
    assert.throws(() => getAllowedFields(type), error => error.statusCode === 400);
    assert.throws(() => stripDisallowedFields(type, {}), error => error.statusCode === 400);
  }
});

test('null costs never contribute to totals, while applicable zero costs remain valid', () => {
  assert.equal(serviceCost('Cleaning', { goldUsed: null, goldScrap: null, goldCostPerG: null, stoneCost: null, laborCost: 1000 }).toString(), '1000');
  assert.equal(serviceCost('Resize', { goldUsed: '1', goldScrap: '0', goldCostPerG: 8000, stoneCost: null, laborCost: 0 }).toString(), '8000');
});
