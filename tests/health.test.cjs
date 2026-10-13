const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.VERCEL = '1';
// Deliberately no database or secrets: startup and public/protected boundaries.
require.cache[require.resolve('../dist/db')] = { exports: { prisma: {} } };
const app = require('../dist/index').default;
test('Express boots, health responds, and business routes require authentication', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ok');
    for (const path of ['/inventory', '/gold/price', '/sales']) assert.equal((await fetch(base + path)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
