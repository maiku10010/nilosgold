const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sum, verify, keys } = require('../scripts/verify-prepared-data.cjs');

function fixture() {
  const before = Object.fromEntries(Object.keys(keys).map(t => [t, []]));
  before.clients = [{ clientId:'c1', clientName:'Example' }];
  before.sales = [{ invoiceId:'s1', clientId:'c1', jobCostId:null, price:'100', date:'2026-10-09', status:'PAID' }];
  before.sale_payments = [{ payment_id:'p1', invoice_id:'s1', amount:'30', method:'csh' }, { payment_id:'p2', invoice_id:'s1', amount:'70', method:'cash' }];
  const prepared = structuredClone(before); prepared.sale_payments[0].method = 'cash';
  const manifest = { patches:[{ table:'sale_payments', key:'payment_id', id:'p1', field:'method', before:'csh', after:'cash' }] };
  return { before, prepared, live:structuredClone(before), manifest };
}
test('decimal totals retain cents and gram precision beyond binary-number limits', () => {
  assert.equal(sum(['0.1','0.2']), '0.3');
  assert.equal(sum(['9007199254740992.01','0.02']), '9007199254740992.03');
  assert.equal(sum(['0.000000000000000000000000000001','-0.000000000000000000000000000002']), '-0.000000000000000000000000000001');
  assert.equal(sum([null, '-1.230', '1.23']), '0');
});
test('equal totals do not conceal money moved between records', () => {
  const f = fixture(); f.prepared.sale_payments[0].amount = '40'; f.prepared.sale_payments[1].amount = '60';
  const r = verify(f.before, f.prepared, f.live, f.manifest);
  assert.equal(r.originalTotalsPreserved, true);
  assert.equal(r.undocumentedChanges.length, 2);
  assert.equal(r.status, 'VERIFICATION_FAILED');
});
test('new records survive refresh without being mistaken for deletions', () => {
  const f = fixture(); f.live.inquiries.push({ inquiryId:'i1', quotedPrice:'120.25', clientId:'c1' });
  const r = verify(f.before, f.prepared, f.live, f.manifest);
  assert.equal(r.status, 'OFFLINE_COPY_VERIFIED');
  assert.deepEqual(r.refreshed.inquiries, f.live.inquiries);
  assert.equal(r.liveChangesSincePreparation[0].kind, 'added');
});
test('a changed non-patched field on an affected row blocks reuse', () => {
  const f = fixture(); f.live.sale_payments[0].amount = '35';
  const r = verify(f.before, f.prepared, f.live, f.manifest);
  assert.equal(r.status, 'VERIFICATION_FAILED');
  assert.equal(r.conflicts.length, 1);
});
test('broken references and duplicate IDs fail verification', () => {
  const f = fixture(); f.live.sales[0].clientId = 'missing';
  const r = verify(f.before, f.prepared, f.live, f.manifest);
  assert.equal(r.integrityErrors.length, 1); assert.equal(r.status, 'VERIFICATION_FAILED');
  f.live.clients.push(f.live.clients[0]);
  assert.throws(() => verify(f.before, f.prepared, f.live, f.manifest), /duplicate/);
});
test('financial mutations cannot be disguised as approved patches', () => {
  const f = fixture(); f.manifest.patches[0].field = 'amount';
  assert.throws(() => verify(f.before, f.prepared, f.live, f.manifest), /unapproved/);
});
