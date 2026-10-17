const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SERVICE_RULES, validateServiceFields } = require('../dist/lib/serviceRules');
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
      for (const value of [all[key], 0, null]) {
        assert.throws(() => validateServiceFields(type, { ...accepted, [key]: value }), error => error.statusCode === 400 && error.field === key);
      }
    }
    assert.equal(serviceCost(type, all).toString(), expected.total);
  });
}
test('unknown service types cannot bypass the contract', () => {
  for (const type of ['Other', '__proto__', undefined]) assert.throws(() => validateServiceFields(type, {}), error => error.statusCode === 400);
});
