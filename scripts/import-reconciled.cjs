// Dry-run by default. Imports only to historical tables, never live stock/cash.
const fs = require('node:fs');
const path = require('node:path');

function parseCsv(input) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  input = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error('Unexpected CSV quote');
      quoted = true;
    } else if (c === ',' || c === '\r' || c === '\n') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        rows.push(row); row = [];
      }
    } else {
      if (closed) throw new Error('Text after quoted CSV cell');
      field += c;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (row.length || field || closed) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length) throw new Error('Invalid CSV header');
  return rows.map(r => {
    if (r.length !== headers.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(headers.map((h, i) => [h, r[i] || null]));
  });
}

function load(directory) {
  const invoices = parseCsv(fs.readFileSync(path.join(directory, 'legacy_invoices.csv'), 'utf8'));
  const records = parseCsv(fs.readFileSync(path.join(directory, 'migration_records.csv'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'validation_summary.json'), 'utf8'));
  if (records.length !== summary.preserved_rows || invoices.length !== summary.legacy_invoices) throw new Error('Row count differs from validation summary');
  const ids = new Set(invoices.map(i => i.record_id));
  if (ids.size !== invoices.length || new Set(records.map(r => r.record_id)).size !== records.length) throw new Error('Duplicate record ID');
  for (const r of records) {
    if (r.source_sha256 !== summary.source_sha256[r.source_file]) throw new Error('Source hash mismatch');
    if (r.invoice_record_id && !ids.has(r.invoice_record_id)) throw new Error('Unresolved invoice reference');
    for (const key of ['original_data', 'cleaned_data']) {
      const value = JSON.parse(r[key]);
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid source JSON');
    }
  }
  return { invoices, records };
}

async function main() {
  const args = process.argv.slice(2);
  const directory = args.find(a => !a.startsWith('--'));
  if (!directory || args.some(a => a.startsWith('--') && !['--apply', '--dry-run'].includes(a))) throw new Error('Usage: node scripts/import-reconciled.cjs <output-directory> [--apply]');
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose apply or dry-run, not both');
  const { invoices, records } = load(directory);
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', invoices: invoices.length, preservedRows: records.length, inventoryWrites: 0 }));
    return;
  }
  require('dotenv').config({ quiet: true });
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) throw new Error('Database URL is required');
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('reconciled-legacy-import'))");
    for (const [table, rows] of [['legacy_invoices', invoices], ['legacy_sheet_rows', records]]) {
      for (const row of rows) {
        const keys = Object.keys(row);
        const allowed = table === 'legacy_invoices'
          ? ['record_id','legacy_invoice','source_file','source_row','invoice_date','date_estimated','customer_name','description','status','pulled_out','sale_price','recorded_payment','assumed_payment','reconciled_payment','balance','excess_payment','excess_classification']
          : ['record_id','source_file','source_row','source_sha256','processing','invoice_record_id','original_data','cleaned_data'];
        if (keys.length !== allowed.length || keys.some(k => !allowed.includes(k))) throw new Error('Unexpected columns');
        const values = keys.map(k => row[k]);
        // Exact reruns are safe. Changed imports require an explicit revision,
        // rather than silently overwriting previously reviewed history.
        const existing = await client.query(`SELECT 1 FROM public.${table} WHERE record_id = $1`, [row.record_id]);
        if (existing.rowCount) {
          const same = await client.query(`SELECT 1 FROM public.${table} WHERE ${keys.map((k,i) => `"${k}" IS NOT DISTINCT FROM $${i+1}`).join(' AND ')}`, values);
          if (!same.rowCount) throw new Error(`Changed historical record: ${row.record_id}`);
          continue;
        }
        await client.query(`INSERT INTO public.${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_,i) => `$${i+1}`).join(',')})`, values);
      }
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode: 'applied', invoices: invoices.length, preservedRows: records.length, inventoryWrites: 0 }));
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { await client.end(); }
}
module.exports = { parseCsv, load };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
