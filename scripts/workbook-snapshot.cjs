const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
require('pg').types.setTypeParser(1114, value => value);
async function main() {
  const db = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await db.connect();
  const result = {};
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const keys = {clients:'clientId',inquiries:'inquiryId',sales:'invoiceId',sale_payments:'payment_id',job_costs:'jobCostId',job_cost_items:'item_id',expenses:'expenseId',inventory:'referenceId',workbook_import_issues:'issue_id'};
  for (const [table,key] of Object.entries(keys)) {
    result[table] = (await db.query(`SELECT * FROM public.${table}`)).rows;
    result[`${table}_ids`] = result[table].map(row=>row[key]).sort();
  }
  result.constraints = (await db.query(`SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace`)).rows;
  result.indexes = (await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'`)).rows;
  await db.query('COMMIT');
  result.captured_at = new Date().toISOString();
  await db.end();
  const dest = process.argv[2];
  if (!dest) throw new Error('Supply a new backup file path');
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  fs.writeFileSync(dest, JSON.stringify(result,null,2), {flag:'wx'});
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))));
}
main().catch(e=>{ console.error(e.message);process.exitCode=1; });
