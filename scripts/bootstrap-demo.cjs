// Fresh demo databases only. The historical migration chains require legacy tables.
require('dotenv/config');
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

async function main() {
  const url = process.env.DIRECT_URL;
  if (process.env.DEMO_ALLOW_SEED !== 'true' || !url || !process.env.DEMO_DATABASE_HOST || new URL(url).hostname !== process.env.DEMO_DATABASE_HOST) {
    throw new Error('Explicit demo opt-in and matching DEMO_DATABASE_HOST are required.');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('goldsmith-demo-bootstrap'))");
    const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    if (existing.rowCount) throw new Error('Requires a fresh public schema; no existing database was changed.');
    await client.query(readFileSync(resolve(__dirname, '../prisma/demo-schema.sql'), 'utf8'));
    const result = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND rowsecurity");
    if (result.rows[0].count !== 13) throw new Error('Expected RLS on all 13 demo tables.');
    await client.query('COMMIT');
    console.log('Fresh demo schema created; RLS verified on all 13 application tables. Run npm run demo:seed next.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
main().catch(() => { console.error('Demo bootstrap failed. Check demo opt-in, DIRECT_URL, and an empty public schema.'); process.exitCode = 1; });
