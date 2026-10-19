// Offline, exact-decimal verification. No database writes or database credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const keys = { clients:'clientId', inquiries:'inquiryId', sales:'invoiceId', sale_payments:'payment_id', job_costs:'jobCostId', job_cost_items:'item_id', expenses:'expenseId', inventory:'referenceId', workbook_import_issues:'issue_id' };
const numeric = { inquiries:['quotedPrice'], sales:['price'], sale_payments:['amount'], job_costs:['goldUsed','gold_scrap','stoneCost','laborCost','labor_charge','other_cost'], job_cost_items:['line_price','gold_grams','gold_cost','stone_cost','labor_cost','labor_charge','other_cost'], expenses:['amount'] };
const allowed = { sales:['date','description','status'], job_costs:['date','item_name','status'], sale_payments:['paid_at','method'], expenses:['date','description'] };
// PostgreSQL numeric values arrive as strings. Preserve every decimal digit, including grams.
function parts(value) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw Error(`Invalid exact decimal: ${value}`);
  const fraction = match[3] || '';
  return { n: BigInt((match[1] || '') + match[2] + fraction), scale: fraction.length };
}
function sum(values) {
  const p = values.filter(v => v != null).map(parts), scale = Math.max(0, ...p.map(v => v.scale));
  const n = p.reduce((a, v) => a + v.n * 10n ** BigInt(scale - v.scale), 0n);
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return (n < 0n ? '-' : '') + text;
}
function index(rows, key) {
  const result = new Map();
  for (const r of rows) { if (r[key] == null || result.has(r[key])) throw Error(`Missing/duplicate ${key}`); result.set(r[key], r); }
  return result;
}
function differences(a, b) {
  const result = [];
  for (const [table, key] of Object.entries(keys)) {
    const x = index(a[table], key), y = index(b[table], key);
    for (const id of new Set([...x.keys(), ...y.keys()])) {
      if (!x.has(id) || !y.has(id)) { result.push({ table, id, kind: x.has(id) ? 'removed' : 'added' }); continue; }
      for (const field of new Set([...Object.keys(x.get(id)), ...Object.keys(y.get(id))])) {
        if (!equal(x.get(id)[field], y.get(id)[field])) result.push({ table, id, field, before: x.get(id)[field], after: y.get(id)[field] });
      }
    }
  }
  return result;
}
function totals(snapshot) {
  const result = {};
  for (const table of Object.keys(keys)) {
    result[table] = {};
    for (const scope of ['all', 'active']) {
      const rows = snapshot[table].filter(r => scope === 'all' || !r.deletedAt);
      result[table][scope] = { count: rows.length };
      for (const field of numeric[table] || []) result[table][scope][field] = {
        sum: sum(rows.map(r => r[field])), nulls: rows.filter(r => r[field] == null).length,
      };
    }
  }
  const groups = Object.groupBy(snapshot.inventory.filter(r => !r.deletedAt), r => JSON.stringify([r.category, r.gold_karat, r.unit]));
  result.inventoryByCategoryPurityUnit = Object.fromEntries(Object.entries(groups).sort().map(([group, rows]) => [group, {
    count: rows.length, quantityIn: sum(rows.map(r => r.quantityIn)), quantityOut: sum(rows.map(r => r.quantityOut)), quantityLoss: sum(rows.map(r => r.quantityLoss)),
  }]));
  return result;
}
function relationships(s) {
  const errors = [], checks = [
    ['sales','clientId','clients'], ['sales','jobCostId','job_costs'], ['sale_payments','invoice_id','sales'],
    ['job_cost_items','job_cost_id','job_costs'], ['job_costs','client_id','clients'], ['job_costs','inquiryId','inquiries'],
    ['inventory','jobCostId','job_costs'], ['inquiries','clientId','clients'],
  ];
  for (const [table, field, target] of checks) {
    const parents = index(s[target], keys[target]);
    for (const row of s[table]) if (row[field] != null && !parents.has(row[field])) errors.push({ table, id: row[keys[table]], field, missing: row[field], target });
  }
  return errors;
}
function periods(s) {
  const result = {};
  for (const [table, date, amount] of [['sales','date','price'], ['sale_payments','paid_at','amount'], ['expenses','date','amount']]) {
    const groups = Object.groupBy(s[table].filter(r => !r.deletedAt), r => r[date] ? r[date].slice(0,7) : 'undated');
    result[table] = Object.fromEntries(Object.entries(groups).sort().map(([period, rows]) => [period, { count: rows.length, amount: sum(rows.map(r => r[amount])) }]));
  }
  return result;
}
function verify(before, prepared, live, manifest) {
  const expected = structuredClone(before), refreshed = structuredClone(live), conflicts = [], seen = new Set();
  for (const p of manifest.patches) {
    if (!allowed[p.table]?.includes(p.field) || keys[p.table] !== p.key) throw Error('Patch touches an unapproved field');
    const identity = JSON.stringify([p.table, p.id, p.field]);
    if (seen.has(identity)) throw Error('Duplicate patch'); seen.add(identity);
    const old = index(before[p.table], p.key).get(p.id), current = index(live[p.table], p.key).get(p.id);
    if (!old || !equal(old[p.field], p.before)) throw Error('Manifest before-value mismatch');
    expected[p.table].find(r => r[p.key] === p.id)[p.field] = p.after;
    if (!equal(old, current)) conflicts.push({ table:p.table, id:p.id, field:p.field, reason:'Affected full row changed since preparation' });
    else refreshed[p.table].find(r => r[p.key] === p.id)[p.field] = p.after;
  }
  const undocumentedChanges = differences(expected, prepared);
  const currentTotals = totals(live), refreshedTotals = totals(refreshed);
  const integrityErrors = relationships(refreshed);
  const result = { capturedAt:live.captured_at, comparedTables:Object.keys(keys), documentedChanges:manifest.patches.length,
    undocumentedChanges, conflicts, liveChangesSincePreparation:differences(before, live),
    originalTotalsPreserved:equal(totals(before), totals(prepared)), freshTotalsPreserved:equal(currentTotals, refreshedTotals),
    currentTotals, preparedTotals:refreshedTotals, integrityErrors,
    currentMonthlyTotals:periods(live), preparedMonthlyTotals:periods(refreshed),
    status:'VERIFICATION_FAILED', refreshed };
  if (!undocumentedChanges.length && !conflicts.length && result.originalTotalsPreserved && result.freshTotalsPreserved && !integrityErrors.length) result.status = 'OFFLINE_COPY_VERIFIED';
  refreshed.preparation = { mode:'offline-only', sourceHash:manifest.sourceHash, refreshedFrom:live.captured_at, verification:result.status };
  return result;
}
function main() {
  const [dir] = process.argv.slice(2); if (!dir) throw Error('Supply preparation directory');
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const manifest = read('proposed-patches.json');
  const hash = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
  if (manifest.snapshotSha256 !== hash('system-snapshot.json')) throw Error('Original snapshot hash mismatch');
  if (manifest.sourceHash !== read('source.json').sha256) throw Error('Source hash mismatch');
  const { refreshed, ...report } = verify(read('system-snapshot.json'), read('prepared-data.json'), read('verification-snapshot.json'), manifest);
  report.verificationSnapshotSha256 = hash('verification-snapshot.json');
  fs.writeFileSync(path.join(dir,'verification.json'), JSON.stringify(report,null,2));
  if (report.status === 'OFFLINE_COPY_VERIFIED') fs.writeFileSync(path.join(dir,'prepared-data-verified.json'), JSON.stringify(refreshed,null,2));
  console.log(JSON.stringify({status:report.status, documentedChanges:report.documentedChanges, undocumentedChanges:report.undocumentedChanges.length, conflicts:report.conflicts.length, liveChanges:report.liveChangesSincePreparation, totalsPreserved:report.freshTotalsPreserved, integrityErrors:report.integrityErrors},null,2));
  if (report.status !== 'OFFLINE_COPY_VERIFIED') process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { sum, differences, verify, keys };
