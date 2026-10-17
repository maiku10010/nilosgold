const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const entries = [];
const events = [];
const prisma = {
  systemLog: { create: async ({ data }) => {
    await new Promise(resolve => setImmediate(resolve));
    entries.push(data);
    events.push('audit saved');
    return data;
  } },
  expenses: { create: async () => ({ expenseId: 'EXP-SAVED', category: 'Supplies', description: 'Gold tools', amount: 6105 }) },
};
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const { auditMutations } = require('../dist/audit');
const expenses = require('../dist/routes/expenses').default;

test('creates persist committed IDs for every record type before the response completes', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { empId: 'ADMIN', empName: 'Admin', empRole: 'Admin' };
    next();
  });
  app.use(auditMutations);
  app.use('/expenses', expenses);
  const types = [
    ['inquiries', 'INQUIRY', 'inquiryId'],
    ['inventory', 'INVENTORY', 'referenceId'],
    ['job-cost', 'JOB_COST', 'jobCostId'],
    ['job_costing', 'JOB_COST', 'jobCostId'],
    ['sales', 'SALE', 'invoiceId'],
    ['client', 'CLIENT', 'clientId'],
    ['employee', 'EMPLOYEE', 'empId'],
  ];
  for (const [path, , field] of types) {
    const router = express.Router();
    router.post('/', (_req, res) => {
      res.locals.auditRecordId = 'SAVED-' + field;
      res.status(201).json({ message: 'Saved' });
    });
    app.use('/' + path, router);
  }
  app.post('/inquiries/:id/ready', (req, res) => res.json({ inquiryId: req.params.id }));
  app.post('/client-error', (_req, res) => res.status(400).json({ error: 'Invalid' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [path, type, field] of types) {
      const response = await fetch(base + '/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: 'FORGED', password: 'private' }),
      });
      await response.json();
      events.push('response received');
      const entry = entries.at(-1);
      assert.equal(entry.entityType, type);
      assert.equal(entry.entityId, 'SAVED-' + field);
      assert.equal(entry.action, 'POST');
      assert.equal(entry.details.body.password, '[REDACTED]');
      assert.deepEqual(events.slice(-2), ['audit saved', 'response received']);
    }
    const response = await fetch(base + '/expenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Supplies', description: 'Gold tools', amount: 6105, expenseId: 'FORGED' }),
    });
    assert.equal(response.status, 200);
    await response.json();
    assert.equal(entries.at(-1).entityId, 'EXP-SAVED');
    const update = await fetch(base + '/inquiries/EXISTING/ready', { method: 'POST' });
    await update.json();
    assert.equal(entries.at(-1).entityId, 'EXISTING');
    const count = entries.length;
    const invalid = await fetch(base + '/client-error', { method: 'POST' });
    assert.equal(invalid.status, 400);
    assert.equal(entries.length, count);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
