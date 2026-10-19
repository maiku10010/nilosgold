// Read-only module smoke checks; login/logout create their normal audit events.
require('dotenv').config({ path: '.env.demo.local', quiet: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const base = 'https://golddemo-api.vercel.app';
  const origin = 'https://golddemo-five.vercel.app';
  assert.equal(process.env.DEMO_SUPABASE_PROJECT_REF, 'kzupjvycvcspinpctmty');
  assert(process.env.DEMO_ADMIN_PASSWORD, 'Private demo credentials are required.');
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/inquiries')).status, 401);
  const login = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify({ userName: 'demo.admin', password: process.env.DEMO_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200, 'Demo admin login');
  assert.equal((await login.json()).user.empId, 'DEMO-ADMIN');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  try {
    for (const [path, id, min] of [
      ['/inquiries', 'inquiryId', 24], ['/job_costing', 'jobCostId', 18],
      ['/sales', 'invoiceId', 12], ['/inventory', 'referenceId', 36],
      ['/expenses', 'expenseId', 16], ['/client', 'clientId', 12],
    ]) {
      const response = await fetch(base + path, { headers: { cookie, origin } });
      assert.equal(response.status, 200, path);
      const rows = await response.json();
      assert(Array.isArray(rows) && rows.length >= min, path);
      assert(rows.every(row => row[id].startsWith('DEMO-') || (path === '/expenses' && row.source === 'inventory' && row[id].startsWith('inventory-DEMO-'))), path + ' must contain only demo records');
      console.log(`${path}: ${rows.length} demo records verified`);
    }
    const logs = await (await fetch(base + '/audit-logs', { headers: { cookie, origin } })).json();
    assert(logs.every(row => row.actorEmpId?.startsWith('DEMO-') || row.action === 'LOGIN_FAILED'), 'Only demo audit actors');
    assert.equal((await fetch(base + '/profit-analysis', { headers: { cookie, origin } })).status, 200);
    console.log('Admin audit and profit reports verified.');
  } finally {
    await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie, origin } });
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const response = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/clients?select=clientId', {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    });
    assert([401, 403].includes(response.status), 'Anonymous direct table access must be denied');
    console.log('Public Supabase key cannot read business tables.');
  }
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync('outputs/demo-login.txt', `GoldDemo: ${origin}\nAdmin: demo.admin\nStaff: demo.staff\nMaker: demo.maker\nInitial demo password: ${process.env.DEMO_ADMIN_PASSWORD}\n\nThese credentials apply only to the new mock-data demo.\n`);
  console.log('Private login details saved to ignored outputs/demo-login.txt.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
