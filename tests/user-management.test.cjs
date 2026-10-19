const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
process.env.AUTH_SECRET = 'user-management-test-secret-at-least-32-characters';
let employees = [], sessions = [], logs = [], failAudit = false;
function match(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('gt' in value) return row[key] > value.gt;
      if ('equals' in value) return row[key].toLowerCase() === value.equals.toLowerCase();
    }
    return row[key] === value;
  });
}
const select = (row, fields) => row && (fields ? Object.fromEntries(Object.keys(fields).filter(key => fields[key]).map(key => [key, row[key]])) : { ...row });
const prisma = {
  employee: {
    findFirst: async ({ where, select: fields }) => select(employees.find(row => match(row, where)), fields) ?? null,
    findUnique: async ({ where, select: fields }) => select(employees.find(row => match(row, where)), fields) ?? null,
    findMany: async ({ select: fields }) => employees.map(row => select(row, fields)),
    count: async ({ where }) => employees.filter(row => match(row, where)).length,
    create: async ({ data, select: fields }) => {
      if (employees.some(row => row.userName === data.userName)) throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
      const row = { deletedAt: null, lastLoginAt: null, tempPasswordExpiresAt: null, mustChangePassword: false, ...data };
      employees.push(row); return select(row, fields);
    },
    update: async ({ where, data, select: fields }) => {
      const row = employees.find(row => match(row, where)); assert.ok(row);
      Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
      return select(row, fields);
    },
  },
  authSession: {
    findFirst: async ({ where, include }) => {
      const row = sessions.find(row => match(row, where));
      if (!row) return null;
      const employee = employees.find(user => user.empId === row.empId);
      return { ...row, employee: select(employee, include.employee.select) };
    },
    create: async ({ data }) => { const row = { revokedAt: null, ...data }; sessions.push(row); return row; },
    updateMany: async ({ where, data }) => { const rows = sessions.filter(row => match(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
  },
  systemLog: { create: async ({ data }) => { if (failAudit) throw new Error('Audit unavailable'); logs.push(data); return data; } },
  $queryRaw: async () => [],
};
let queue = Promise.resolve();
prisma.$transaction = work => {
  const result = queue.then(async () => {
    const before = structuredClone({ employees, sessions, logs });
    try { return await work(prisma); } catch (error) { ({ employees, sessions, logs } = before); throw error; }
  });
  queue = result.catch(() => {}); return result;
};
require.cache[require.resolve('../dist/db')] = { exports: { prisma } };
const { authenticate, requireAdmin, requirePasswordChanged, createSessionToken } = require('../dist/auth');
const { guardAdminRemoval } = require('../dist/userManagement');
const auth = require('../dist/routes/auth').default;
const users = require('../dist/routes/users').default;
const employee = require('../dist/routes/employee').default;

test('user lifecycle HTTP flows enforce credentials, sessions, access and atomic audits', async () => {
  const password = 'original-admin-password';
  employees = [{ empId: 'admin', empName: 'Admin', userName: 'admin', empRole: 'Admin', password: await bcrypt.hash(password, 4), deletedAt: null, mustChangePassword: false, tempPasswordExpiresAt: null }];
  const app = express(); app.use(express.json()); app.use('/auth', auth); app.use(authenticate, requirePasswordChanged);
  app.get('/business', (_req, res) => res.json({ ok: true }));
  app.use('/users', requireAdmin, users); app.use('/employee', requireAdmin, employee);
  app.use((error, _req, res, _next) => res.status(500).json({ error: 'Request failed' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (path, body, cookie, method) => {
    const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], cache: response.headers.get('cache-control') };
  };
  try {
    const admin = await call('/auth/login', { userName: 'admin', password }); assert.equal(admin.status, 200);
    const create = await call('/users', { empName: 'A Staff', userName: 'a.staff', empRole: 'Staff', password: 'ignored' }, admin.cookie);
    assert.equal(create.status, 201); assert.equal(create.cache, 'no-store');
    const { user, temporaryPassword } = create.data;
    assert.ok(temporaryPassword.length >= 16); assert.equal(user.mustChangePassword, true); assert.equal(user.password, undefined);
    const stored = employees.find(row => row.empId === user.empId);
    assert.notEqual(stored.password, temporaryPassword); assert.ok(await bcrypt.compare(temporaryPassword, stored.password));
    assert.ok(Math.abs(new Date(create.data.expiresAt) - Date.now() - 86400000) < 10000);
    assert.equal((await call('/users', undefined, admin.cookie)).data.some(row => row.password || row.temporaryPassword), false);
    assert.equal((await call('/users', { empName: 'Duplicate', userName: 'a.staff', empRole: 'Staff' }, admin.cookie)).status, 409);
    const [login, replay] = await Promise.all([call('/auth/login', { userName: 'a.staff', password: temporaryPassword }), call('/auth/login', { userName: 'a.staff', password: temporaryPassword })]);
    assert.deepEqual([login.status, replay.status].sort(), [200, 401]);
    const setup = login.status === 200 ? login : replay;
    assert.equal(setup.data.user.mustChangePassword, true);
    assert.equal((await call('/business', undefined, setup.cookie)).status, 403);
    assert.equal((await call('/users', undefined, setup.cookie)).status, 403);
    assert.equal((await call('/auth/me', undefined, setup.cookie)).data.user.mustChangePassword, true);
    const changed = await call('/auth/change-password', { newPassword: 'staff-permanent-password' }, setup.cookie);
    assert.equal(changed.status, 200); assert.equal(changed.data.user.mustChangePassword, false);
    assert.equal((await call('/business', undefined, setup.cookie)).status, 401);
    assert.equal((await call('/business', undefined, changed.cookie)).status, 200);
    assert.equal((await call('/users', undefined, changed.cookie)).status, 403);
    assert.equal((await call('/employee', {}, changed.cookie)).status, 403);
    assert.equal((await call('/auth/login', { userName: 'a.staff', password: temporaryPassword })).status, 401);
    assert.equal((await call('/auth/change-password', { currentPassword: 'wrong', newPassword: 'another-valid-password' }, changed.cookie)).status, 400);
    const regular = await call('/auth/change-password', { currentPassword: 'staff-permanent-password', newPassword: 'another-valid-password' }, changed.cookie);
    assert.equal(regular.status, 200);
    assert.equal((await call('/business', undefined, changed.cookie)).status, 401);
    const reset = await call('/users/' + user.empId + '/reset-password', {}, admin.cookie);
    assert.equal(reset.status, 200); assert.notEqual(reset.data.temporaryPassword, temporaryPassword);
    assert.equal((await call('/business', undefined, regular.cookie)).status, 401);
    employees.find(row => row.empId === user.empId).tempPasswordExpiresAt = new Date(Date.now() - 1);
    assert.equal((await call('/auth/login', { userName: 'a.staff', password: reset.data.temporaryPassword })).status, 401);
    const reset2 = await call('/users/' + user.empId + '/reset-password', {}, admin.cookie);
    const setup2 = await call('/auth/login', { userName: 'a.staff', password: reset2.data.temporaryPassword });
    employees.find(row => row.empId === user.empId).tempPasswordExpiresAt = new Date(Date.now() - 1);
    assert.equal((await call('/auth/change-password', { newPassword: 'cannot-expired-password' }, setup2.cookie)).status, 401);
    const reset3 = await call('/users/' + user.empId + '/reset-password', {}, admin.cookie);
    const setup3 = await call('/auth/login', { userName: 'a.staff', password: reset3.data.temporaryPassword });
    await call('/users/' + user.empId, { active: false }, admin.cookie, 'PATCH');
    assert.equal((await call('/business', undefined, setup3.cookie)).status, 401);
    assert.equal((await call('/auth/login', { userName: 'a.staff', password: reset3.data.temporaryPassword })).status, 401);
    assert.ok(employees.find(row => row.empId === user.empId));
    assert.equal((await call('/users/' + user.empId, { active: true }, admin.cookie, 'PATCH')).status, 200);
    for (const body of [{ active: false }, { empRole: 'Staff' }]) assert.equal((await call('/users/admin', body, admin.cookie, 'PATCH')).status, 400);
    // Defense in depth: last-active-admin rule also rejects a different actor.
    await assert.rejects(guardAdminRemoval(prisma, { empId: 'other' }, employees[0], 'Staff', true), /At least one active/);
    await assert.rejects(guardAdminRemoval(prisma, { empId: 'other' }, employees[0], 'Admin', false), /At least one active/);
    assert.equal((await call('/employee/admin', {}, admin.cookie, 'DELETE')).status, 405);
    assert.equal((await call('/employee/admin', { password: 'bypass' }, admin.cookie, 'PUT')).status, 405);
    const second = await call('/users', { empName: 'Second Admin', userName: 'second', empRole: 'Admin' }, admin.cookie);
    const secondLogin = await call('/auth/login', { userName: 'second', password: second.data.temporaryPassword });
    const secondReady = await call('/auth/change-password', { newPassword: 'second-admin-password' }, secondLogin.cookie);
    const concurrent = await Promise.all([
      call('/users/' + second.data.user.empId, { empRole: 'Staff' }, admin.cookie, 'PATCH'),
      call('/users/admin', { active: false }, secondReady.cookie, 'PATCH'),
    ]);
    assert.equal(concurrent.filter(row => row.status === 200).length, 1);
    assert.equal(employees.filter(row => !row.deletedAt && row.empRole === 'Admin').length, 1);
    assert.ok(logs.some(row => row.action === 'USER_ROLE_CHANGED'));
    for (const action of ['USER_CREATED', 'USER_PASSWORD_RESET', 'USER_DEACTIVATED', 'USER_REACTIVATED']) {
      const entry = logs.find(row => row.action === action); assert.ok(entry, action); assert.equal(entry.actorEmpId, 'admin'); assert.ok(entry.entityId); assert.ok(entry.details.targetName);
    }
    assert.ok(!JSON.stringify(logs).includes(temporaryPassword));
    // An audit failure rolls the account creation back.
    const activeAdmin = employees.find(row => !row.deletedAt && row.empRole === 'Admin');
    const activeSession = sessions.find(row => row.empId === activeAdmin.empId && !row.revokedAt);
    const cookie = 'goldsmith_session=' + createSessionToken(activeAdmin.empId, activeSession.id, activeSession.expiresAt);
    failAudit = true;
    assert.equal((await call('/users', { empName: 'Rollback', userName: 'rollback', empRole: 'Staff' }, cookie)).status, 500);
    assert.equal(employees.some(row => row.userName === 'rollback'), false);
  } finally { failAudit = false; await new Promise(resolve => server.close(resolve)); }
});
