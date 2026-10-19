const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/prepare-workbook-import.cjs');
const { review } = require('../scripts/review-cleaned-workbook.cjs');

function fixture() {
  const original = { sha256: 'original', sheets: {
    'Daily Sales': [{ row: 9, values: ['2026-10-09', 1, null, 'Example', 'Ring', 1000, 300, 700, 'csh', 'done'], formulas: {} }],
    'Job Costing': [], Expenses: [], GOLD: [], 'Gold Inventory ': [], 'Stone Inventory': [],
    Collectables: [{ row: 3, values: ['2026-10-09', 'Example', 'Ring', 1000, 300, null, null, null, 'paid', 'done'], formulas: {} }],
    'other ex,': [{ row: 2, values: [] }], Repayment: [],
  } };
  const history = { clients: [], sales: [], job_costs: [], expenses: [], inventory: [] };
  const baseline = build(original, history);
  const live = { clients: baseline.clients, sales: baseline.sales.map(s => ({ ...s, source_sheet: 'Daily Sales', source_row: 9 })),
    job_costs: baseline.jobs.map(j => ({ ...j, source_sheet: 'Daily Sales', source_row: 9 })),
    sale_payments: baseline.payments, expenses: [], inventory: [], inquiries: [], job_cost_items: baseline.items };
  const source = structuredClone(original); source.sha256 = 'cleaned';
  source.sheets['Daily Sales'][0].values[8] = 'cash';
  source.sheets.Collectables[0].values[8] = 0;
  return { source, original, baseline, history, live: structuredClone(live) };
}
test('preserves settled receipts when paid becomes zero, and stages only supported fields', () => {
  const f = fixture(), input = JSON.stringify(f.live);
  const r = review(f.source, f.original, f.baseline, f.history, f.live);
  assert.equal(r.summary.financials.paymentLossOnReimport, 700);
  assert.deepEqual(r.prepared.sale_payments.map(p => p.amount), [300, 700]);
  assert.equal(r.prepared.sales[0].status, 'FINISHED');
  assert.equal(r.patches.length, 1); assert.equal(r.patches[0].field, 'method');
  assert.equal(JSON.stringify(f.live), input);
});
test('does not overwrite a newer system change', () => {
  const f = fixture(); f.live.sale_payments[0].method = 'bank transfer';
  const r = review(f.source, f.original, f.baseline, f.history, f.live);
  assert.equal(r.patches.length, 0);
  assert.equal(r.prepared.sale_payments[0].method, 'bank transfer');
  assert.ok(r.held.some(h => h.field === 'method' && h.reason.includes('changed')));
});
test('date corrections preserve record IDs and time of day', () => {
  const f = fixture();
  f.source.sheets['Daily Sales'][0].values[0] = '2026-09-09';
  f.live.sales[0].date = '2026-10-09 08:15:00';
  const r = review(f.source, f.original, f.baseline, f.history, f.live);
  assert.equal(r.prepared.sales[0].date, '2026-09-09 08:15:00');
  assert.equal(r.prepared.sales[0].invoiceId, f.live.sales[0].invoiceId);
  assert.equal(r.prepared.sale_payments[0].paid_at, '2026-09-09');
});
