const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../scripts/import-reconciled.cjs');
test('CSV handles BOM, embedded commas, escaped quotes, multiline fields and nulls', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b,c\r\n"one, two","a""b\nc",\r\n'), [{a:'one, two',b:'a"b\nc',c:null}]);
});
test('CSV rejects malformed records instead of discarding data', () => {
  for (const input of ['a,a\n1,2', 'a,b\n1', 'a\n"unterminated', 'a\n"x"bad', 'a\nx"y']) {
    assert.throws(() => parseCsv(input));
  }
});
