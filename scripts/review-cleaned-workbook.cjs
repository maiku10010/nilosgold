// Offline only. Produces a patch manifest and a corrected COPY; never connects to a database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('./prepare-workbook-import.cjs');
const norm = v => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v ?? null;
const day = v => v == null ? null : String(v).slice(0, 10);
const round = v => Math.round(v * 100) / 100;
const total = (rows, field) => round(rows.reduce((n, r) => n + Number(r[field] || 0), 0));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const ids = { sales: 'invoiceId', job_costs: 'jobCostId', sale_payments: 'payment_id', expenses: 'expenseId' };

function review(source, original, baseline, historicalSnapshot, live) {
  if (baseline.sha256 !== original.sha256) throw Error('Original workbook does not match the prior import manifest');
  const candidate = build(source, historicalSnapshot); // Diagnostic reconstruction only; never an executable import plan.
  const prepared = structuredClone(live), patches = [], held = [], sourceChanges = [];
  for (const sheet of new Set([...Object.keys(source.sheets), ...Object.keys(original.sheets)])) {
    const oldRows = new Map((original.sheets[sheet] || []).map(r => [r.row, r]));
    const newRows = new Map((source.sheets[sheet] || []).map(r => [r.row, r]));
    for (const row of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const a = oldRows.get(row)?.values || [], b = newRows.get(row)?.values || [];
      for (let col = 0; col < Math.max(a.length, b.length); col++) if (!same(a[col], b[col])) {
        sourceChanges.push({ sheet, row, column: col + 1, before: a[col] ?? null, after: b[col] ?? null,
          kind: same(norm(a[col]), norm(b[col])) ? 'whitespace' : 'value' });
      }
    }
  }
  function propose(table, id, field, expected, after, evidence, type = 'text') {
    const key = ids[table], rows = prepared[table].filter(r => r[key] === id);
    if (rows.length !== 1) { held.push({ table, id, field, reason: 'Missing or ambiguous live record', evidence }); return; }
    const r = rows[0], before = r[field];
    const comparable = x => type === 'date' ? day(x) : type === 'number' ? (x == null ? null : Number(x)) : x ?? null;
    if (same(comparable(before), comparable(after))) return;
    if (r.deletedAt || !same(comparable(before), comparable(expected))) {
      held.push({ table, id, field, before, baseline: expected, proposed: after, reason: 'Live record changed since import or is deleted', evidence }); return;
    }
    // Keep the database timestamp representation; correcting the day must preserve time of day.
    const value = type === 'date' && before && after ? day(after) + String(before).slice(10) : after;
    patches.push({ table, key, id, field, before, after: value, evidence }); r[field] = value;
  }
  const oldSales = new Map(baseline.sales.map(s => [s.invoiceId, s]));
  const newSales = new Map(candidate.sales.map(s => [s.invoiceId, s]));
  const newMaps = new Map(candidate.mappings.map(m => [m.sourceRow, m]));
  const oldJobs = new Map(baseline.jobs.map(j => [j.jobCostId, j]));
  const newJobs = new Map(candidate.jobs.map(j => [j.jobCostId, j]));
  const visited = new Set();
  for (const m of baseline.mappings) {
    if (m.mergedInto || visited.has(m.invoiceId)) continue;
    visited.add(m.invoiceId);
    const nm = newMaps.get(m.sourceRow), a = oldSales.get(m.invoiceId), b = newSales.get(nm?.invoiceId);
    const actual = live.sales.find(s => s.invoiceId === m.invoiceId);
    if (!b || nm.mergedInto || !actual || actual.source_sheet !== 'Daily Sales' || actual.source_row !== m.sourceRow || norm(m.name) !== norm(nm.name)) {
      held.push({ table: 'sales', id: m.invoiceId, sourceRow: m.sourceRow, reason: 'Source identity or grouping needs review' }); continue;
    }
    const evidence = `Daily Sales!row ${m.sourceRow}`;
    for (const field of ['date', 'description']) if (!same(a[field], b[field])) propose('sales', a.invoiceId, field, a[field], b[field], evidence, field === 'date' ? 'date' : 'text');
    // A cleaned "done" spelling establishes delivery, never an additional receipt.
    if (a.status !== b.status) {
      if (a.status === 'PAID' && b.status === 'FINISHED') propose('sales', a.invoiceId, 'status', a.status, b.status, evidence);
      else held.push({ table: 'sales', id: a.invoiceId, field: 'status', before: actual.status, proposed: b.status, reason: 'Do not infer payment or reverse settlement from cleaned status', evidence });
    }
    for (const field of ['price', 'price_confirmed']) if (!same(a[field], b[field])) held.push({ table: 'sales', id: a.invoiceId, field, before: a[field], proposed: b[field], reason: 'Financial change requires reconciliation', evidence });
    const ja = oldJobs.get(a.jobCostId), jb = newJobs.get(b.jobCostId);
    const liveJob = live.job_costs.find(j => j.jobCostId === a.jobCostId);
    if (!ja || !jb || !liveJob || liveJob.source_row !== m.sourceRow || liveJob.source_sheet !== 'Daily Sales') continue;
    for (const field of ['date', 'item_name', 'status']) if (!same(ja[field], jb[field])) {
      if (field === 'status' && !(ja.status === 'IN_PROGRESS' && jb.status === 'FINISHED')) continue;
      propose('job_costs', ja.jobCostId, field, ja[field], jb[field], evidence, field === 'date' ? 'date' : 'text');
    }
  }
  // Payment identity is provenance + existing invoice ID, not regenerated date-based IDs.
  for (const p of baseline.payments) {
    const oldMap = baseline.mappings.find(m => m.invoiceId === p.invoice_id && !m.mergedInto);
    const newInvoice = newMaps.get(oldMap?.sourceRow)?.invoiceId;
    const matches = candidate.payments.filter(n => n.invoice_id === newInvoice && n.source_sheet === p.source_sheet && n.source_row === p.source_row && n.notes === p.notes);
    if (matches.length !== 1 || Number(matches[0].amount) !== Number(p.amount)) {
      held.push({ table: 'sale_payments', id: p.payment_id, amount: p.amount, source: p.notes, reason: 'Re-import would remove or change payment; retain recorded receipt' }); continue;
    }
    const q = matches[0], actual = live.sale_payments.find(x => x.payment_id === p.payment_id);
    if (!actual || actual.invoice_id !== p.invoice_id || actual.source_sheet !== p.source_sheet || actual.source_row !== p.source_row) {
      held.push({ table: 'sale_payments', id: p.payment_id, reason: 'Payment provenance changed; manual review' }); continue;
    }
    for (const [field, sourceField] of [['paid_at', 'paid_at'], ['method', 'method']]) if (!same(p[sourceField], q[sourceField])) propose('sale_payments', p.payment_id, field, p[sourceField], q[sourceField], p.notes, field === 'paid_at' ? 'date' : 'text');
  }
  for (const e of baseline.expenses) {
    const matches = candidate.expenses.filter(x => x.sourceRow === e.sourceRow);
    const actual = live.expenses.find(x => x.expenseId === e.expenseId);
    if (matches.length !== 1 || !actual || actual.source_sheet !== 'Expenses' || actual.source_row !== e.sourceRow) { held.push({ table: 'expenses', id: e.expenseId, reason: 'Expense source identity needs review' }); continue; }
    const n = matches[0];
    for (const field of ['date', 'description']) if (!same(e[field], n[field])) propose('expenses', e.expenseId, field, e[field], n[field], `Expenses!row ${e.sourceRow}`, field === 'date' ? 'date' : 'text');
    if (Number(e.amount) !== Number(n.amount)) held.push({ table: 'expenses', id: e.expenseId, before: e.amount, proposed: n.amount, reason: 'Expense amount requires reconciliation' });
  }
  const formulaIssues = [], costLinks = [];
  for (const [sheet, rows] of Object.entries(source.sheets)) for (const r of rows) {
    r.values.forEach((v, i) => { if (typeof v === 'string' && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(v)) formulaIssues.push({ sheet, row: r.row, column: i + 1, value: v }); });
    if (sheet === 'Job Costing' && r.row >= 5) {
      const refs = Object.fromEntries(['A', 'B', 'L'].map(c => [c, Number((r.formulas[c] || '').match(/'Daily Sales'!\$?[A-Z]+\$?(\d+)/)?.[1]) || null]));
      if (new Set(Object.values(refs).filter(Boolean)).size > 1) costLinks.push({ row: r.row, references: refs });
    }
  }
  const active = table => live[table].filter(r => !r.deletedAt);
  const payments = new Map(); for (const p of live.sale_payments) payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Number(p.amount));
  const overpayments = active('sales').filter(s => s.price != null && (payments.get(s.invoiceId) || 0) > Number(s.price) + .005).map(s => ({ invoiceId: s.invoiceId, price: Number(s.price), paid: round(payments.get(s.invoiceId)), excess: round(payments.get(s.invoiceId) - Number(s.price)) }));
  const duplicateClients = Object.values(Object.groupBy(active('clients'), c => norm(c.clientName).toLowerCase())).filter(g => g.length > 1).map(g => g.map(c => ({ id: c.clientId, name: c.clientName })));
  const counts = Object.fromEntries(['clients','inquiries','sales','sale_payments','job_costs','job_cost_items','expenses','inventory'].map(t => [t, { all: live[t].length, active: active(t).length }]));
  const financials = { activeInvoicePrices: total(active('sales'), 'price'), allRecordedPayments: total(live.sale_payments, 'amount'), activeExpenses: total(active('expenses'), 'amount'), baselineImportedPrices: baseline.summary.price, baselineImportedPayments: baseline.summary.cash, unsafeReimportPayments: candidate.summary.cash, paymentLossOnReimport: round(baseline.summary.cash - candidate.summary.cash) };
  const preservedSystemChanges = [];
  for (const [table, oldRows, key, fields] of [
    ['sales', baseline.sales, 'invoiceId', ['price', 'price_confirmed', 'status']],
    ['sale_payments', baseline.payments, 'payment_id', ['amount']],
    ['expenses', baseline.expenses, 'expenseId', ['amount']],
    ['job_costs', baseline.jobs, 'jobCostId', ['goldUsed', 'goldCostPerG', 'gold_scrap', 'stoneCost', 'laborCost', 'labor_charge', 'other_cost']],
  ]) {
    const old = new Map(oldRows.map(r => [r[key], r]));
    for (const r of live[table]) {
      const a = old.get(r[key]);
      if (!a) { preservedSystemChanges.push({ table, id: r[key], reason: 'System record outside prior import' }); continue; }
      for (const f of fields) {
        const numeric = !['status', 'price_confirmed'].includes(f);
        const value = x => numeric && x != null ? Number(x) : x ?? null;
        if (!same(value(a[f]), value(r[f]))) preservedSystemChanges.push({ table, id: r[key], field: f, imported: a[f] ?? null, current: r[f], reason: 'Preserved system edit since import' });
      }
    }
  }
  const summary = { sourceHash: source.sha256, originalHash: original.sha256, snapshotCapturedAt: live.captured_at, counts, financials, sourceChanges: sourceChanges.length, stagedFieldChanges: patches.length, stagedRecords: new Set(patches.map(p => p.table + ':' + p.id)).size, heldChanges: held.length, preservedSystemChanges: preservedSystemChanges.length, formulaErrors: formulaIssues.length, inconsistentCostLinks: costLinks.length, overpaidInvoices: overpayments.length, duplicateClientGroups: duplicateClients.length, unresolvedSourceIssues: candidate.issues.length };
  prepared.preparation = { mode: 'offline-only', sourceHash: source.sha256, financialAmountsUnchanged: true };
  return { summary, patches, held, sourceChanges, formulaIssues, costLinks, overpayments, duplicateClients, preservedSystemChanges, sourceIssues: candidate.issues, prepared };
}
function main() {
  const [dir, history] = process.argv.slice(2);
  if (!dir || !history) throw Error('Usage: node scripts/review-cleaned-workbook.cjs OUTPUT_DIR PRIOR_IMPORT_DIR');
  const read = (base, name) => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
  const livePath = path.join(dir, 'system-snapshot.json');
  const result = review(read(dir, 'source.json'), read(history, 'source.json'), read(history, 'plan.json'), read(history, 'before.json'), read(dir, 'system-snapshot.json'));
  const { prepared, ...report } = result;
  report.snapshotSha256 = crypto.createHash('sha256').update(fs.readFileSync(livePath)).digest('hex');
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
  write('review.json', report); write('prepared-data.json', prepared);
  write('proposed-patches.json', { mode: 'REVIEW_ONLY', sourceHash: report.summary.sourceHash, snapshotSha256: report.snapshotSha256, patches: report.patches, held: report.held });
  console.log(JSON.stringify(report.summary, null, 2));
}
if (require.main === module) main();
module.exports = { review };
