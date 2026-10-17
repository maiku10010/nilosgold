const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Replace the database module before importing routes: never connect to live data.
const prisma = { sales: {}, salePayment: {}, client: {}, approvalRequest: {}, systemLog: {} };
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const salesRouter = require('../dist/routes/sales').default;
const approvals = require('../dist/approvals');
const receipt = salesRouter.stack.find(layer => layer.route?.path === '/:invoiceId/receipt').route.stack[0].handle;
const updateSale = salesRouter.stack.find(layer => layer.route?.methods.put).route.stack[0].handle;
const saleLastUpdate = salesRouter.stack.find(layer => layer.route?.path === '/:invoiceId/last-update').route.stack[0].handle;
const approve = approvals.default.stack.find(layer => layer.route?.path === '/:requestId/approve').route.stack[0].handle;
const undoApproval = approvals.default.stack.find(layer => layer.route?.path === '/:requestId/undo').route.stack[0].handle;
const originalFetch = global.fetch;
const originalEnv = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
let sale, calls, writes;
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function send(body = { confirm: true, invoiceId: 'INV-1' }) {
  const response = res();
  await receipt({ params: { invoiceId: 'INV-1' }, body }, response);
  return response;
}

beforeEach(() => {
  sale = { invoiceId: 'INV-1', clientId: 'C-1', status: 'FINISHED', deletedAt: null, receiptSentAt: null,
    salesDate: new Date('2026-01-01'), price: 100, serviceType: 'Repair',
    payments: [{ paymentId: 'PAY-1', invoiceId: 'INV-1', amount: 50, paidAt: new Date('2026-01-01'), paymentNumber: 1 }],
    client: { clientName: 'Test Customer', email: 'customer@example.com' } };
  calls = []; writes = 0;
  process.env.RESEND_API_KEY = 'test-only'; process.env.EMAIL_FROM = 'sender@example.com';
  global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'email-1' }) }; };
  prisma.sales.findFirst = async ({ where }) => sale && !sale.deletedAt && sale.invoiceId === where.invoiceId ? structuredClone(sale) : null;
  prisma.sales.findUniqueOrThrow = async () => structuredClone(sale);
  prisma.sales.updateMany = async ({ where, data }) => {
    if (sale.receiptSentAt !== where.receiptSentAt) return { count: 0 };
    writes++; Object.assign(sale, data); return { count: 1 };
  };
  prisma.sales.update = async ({ data }) => { if (data.client) Object.assign(sale.client, data.client.update); return sale; };
  prisma.sales.findMany = async () => [sale];
  prisma.salePayment.findMany = async () => structuredClone(sale.payments);
  prisma.salePayment.create = async ({ data }) => {
    const payment = { ...data, paymentId: data.paymentId || `PAY-${sale.payments.length + 1}` };
    sale.payments.push(payment); return payment;
  };
  prisma.salePayment.delete = async ({ where }) => {
    const index = sale.payments.findIndex(payment => payment.paymentId === where.paymentId);
    return sale.payments.splice(index, 1)[0];
  };
  prisma.salePayment.update = async ({ where, data }) => {
    const payment = sale.payments.find(payment => payment.paymentId === where.paymentId);
    Object.assign(payment, data); return payment;
  };
  prisma.client.update = async ({ data }) => Object.assign(sale.client, data);
  prisma.$transaction = async fn => fn(prisma);
  prisma.systemLog.create = async () => ({});
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const [name, value] of [['RESEND_API_KEY', originalEnv.key], ['EMAIL_FROM', originalEnv.from]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test('requires explicit matching confirmation, including an absent body', async () => {
  for (const body of [null, {}, { confirm: true, invoiceId: 'different' }]) assert.equal((await send(body)).statusCode, 400);
  assert.equal(calls.length, 0);
});
test('rejects unfinished, deleted, and missing invoices without sending', async () => {
  sale.status = 'PENDING'; assert.equal((await send()).statusCode, 404);
  sale.status = 'FINISHED'; sale.deletedAt = new Date(); assert.equal((await send()).statusCode, 404);
  sale = null; assert.equal((await send()).statusCode, 404);
  assert.equal(calls.length, 0);
});
test('missing and invalid email never call the provider or mark sent', async () => {
  for (const email of [null, ' ', 'invalid']) {
    sale.client.email = email;
    assert.equal((await send()).body.notification.sent, false);
  }
  assert.equal(calls.length, 0); assert.equal(writes, 0);
});
test('missing provider configuration keeps receipt retryable', async () => {
  delete process.env.RESEND_API_KEY;
  assert.match((await send()).body.notification.reason, /RESEND_API_KEY/);
  assert.equal(calls.length, 0); assert.equal(writes, 0);
});
test('stale recipient confirmation cannot send to a different address', async () => {
  const result = await send({ confirm: true, invoiceId: 'INV-1', email: 'old@example.com' });
  assert.equal(result.statusCode, 409);
  assert.equal(calls.length, 0);
});
test('provider rejection leaves timestamp empty and later success records it', async () => {
  const success = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ message: 'Rate limited. Try again.' }) });
  assert.match((await send()).body.notification.reason, /Rate limited/);
  assert.equal(sale.receiptSentAt, null);
  global.fetch = success;
  assert.equal((await send()).body.notification.sent, true); assert.equal(writes, 1);
});
test('successful receipt uses stable provider key and repeated request synchronizes sent state', async () => {
  const first = await send();
  assert.ok(first.body.receiptSentAt instanceof Date);
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'official-receipt-INV-1');
  assert.deepEqual(JSON.parse(calls[0].options.body).to, ['customer@example.com']);
  const second = await send();
  assert.equal(second.body.notification.alreadySent, true);
  assert.deepEqual(second.body.receiptSentAt, first.body.receiptSentAt);
  assert.equal(calls.length, 1); assert.equal(writes, 1);
});
test('concurrent provider replays preserve the first timestamp and the same key', async () => {
  const results = await Promise.all([send(), send()]);
  assert.ok(results.every(r => r.body.notification.sent));
  assert.equal(writes, 1);
  assert.ok(calls.every(c => c.options.headers['Idempotency-Key'] === 'official-receipt-INV-1'));
  assert.deepEqual(results[0].body.receiptSentAt, results[1].body.receiptSentAt);
});
test('timeout and malformed success report uncertainty without a sent timestamp', async () => {
  global.fetch = async () => { throw new Error('timeout'); };
  assert.match((await send()).body.notification.reason, /may have succeeded/);
  for (const body of [{}, null, { id: '' }]) {
    global.fetch = async () => ({ ok: true, json: async () => body });
    assert.match((await send()).body.notification.reason, /did not confirm/);
  }
  assert.equal(writes, 0);
});
test('accepted email with failed persistence warns against blind retries', async t => {
  t.mock.method(console, 'error', () => {});
  prisma.sales.updateMany = async () => { throw new Error('database unavailable'); };
  const result = await send();
  assert.equal(result.statusCode, 503);
  assert.match(result.body.error, /provider accepted/);
  assert.equal(sale.receiptSentAt, null);
});
test('admin sale edit saves and clears receipt email', async () => {
  for (const email of [' new@example.com ', '']) {
    const response = res();
    await updateSale({ params: { invoiceId: 'INV-1' }, body: { invoiceId: 'INV-1', clientName: 'Test Customer', serviceType: 'Repair', price: 100, payment: 50, email } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(sale.client.email, email.trim() || null);
  }
});
test('staff email edits remain queued until another admin approves them', async () => {
  let queued;
  prisma.approvalRequest.findFirst = async () => null;
  prisma.approvalRequest.create = async ({ data }) => { queued = { ...data, requestId: 'A-1', status: 'PENDING' }; return queued; };
  const response = res();
  await approvals.queueStaffChanges({ path: '/sales/INV-1', method: 'PUT', user: { empId: 'staff', empRole: 'Staff' }, body: { email: ' new@example.com ' } }, response, () => assert.fail('must queue'));
  assert.equal(response.statusCode, 202);
  assert.equal(queued.proposedData.email, 'new@example.com');
  assert.equal(sale.client.email, 'customer@example.com');
  prisma.approvalRequest.findUnique = async () => queued;
  prisma.approvalRequest.update = async ({ data }) => ({ ...queued, ...data });
  const reviewed = res();
  await approve({ params: { requestId: 'A-1' }, body: {}, user: { empId: 'admin', empName: 'Admin', empRole: 'Admin' } }, reviewed);
  assert.equal(reviewed.statusCode, 200);
  assert.equal(sale.client.email, 'new@example.com');
});
test('an approving admin can undo an email edit during the five-second window', async () => {
  const approval = { requestId: 'A-2', status: 'APPROVED', action: 'UPDATE', entityType: 'SALE', entityId: 'INV-1', reviewerEmpId: 'admin', reviewedAt: new Date(), beforeData: { client: { email: 'customer@example.com' } }, proposedData: { email: 'new@example.com' } };
  sale.client.email = 'new@example.com';
  prisma.approvalRequest.findUnique = async () => approval;
  prisma.approvalRequest.update = async ({ data }) => ({ ...approval, ...data });
  const response = res();
  await undoApproval({ params: { requestId: 'A-2' }, user: { empId: 'admin', empName: 'Admin', empRole: 'Admin' } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(sale.client.email, 'customer@example.com');
  assert.equal(response.body.request.status, 'REJECTED');
});

test('sale update footer reads only the targeted invoice edit metadata, including for staff', async () => {
  let logQuery;
  const stamp = new Date('2026-10-18T02:00:00Z');
  prisma.systemLog.findFirst = async query => {
    logQuery = query;
    return { actorRole: 'Admin', createdAt: stamp };
  };
  const response = res();
  await saleLastUpdate({ params: { invoiceId: 'INV-1' }, user: { empRole: 'Staff' } }, response);
  assert.deepEqual(response.body, { lastUpdate: { actorRole: 'Admin', createdAt: stamp } });
  assert.equal(logQuery.where.entityType, 'SALE');
  assert.equal(logQuery.where.entityId, 'INV-1');
  assert.deepEqual(logQuery.select, { actorRole: true, createdAt: true });
  assert.deepEqual(logQuery.orderBy, { createdAt: 'desc' });
  assert.equal(logQuery.where.action.in.includes('PUT_REQUESTED'), false);
  assert.equal(logQuery.where.action.in.includes('APPROVAL_APPROVED'), true);
  prisma.systemLog.findFirst = async () => null;
  const empty = res();
  await saleLastUpdate({ params: { invoiceId: 'INV-1' } }, empty);
  assert.deepEqual(empty.body, { lastUpdate: null });
});

test('sale update footer does not disclose logs for missing or archived invoices', async () => {
  prisma.systemLog.findFirst = async () => assert.fail('No history query for missing invoices');
  for (const missing of [null, { ...sale, deletedAt: new Date() }]) {
    sale = missing;
    const response = res();
    await saleLastUpdate({ params: { invoiceId: 'INV-1' } }, response);
    assert.equal(response.statusCode, 404);
  }
});
