"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const auth_1 = require("../auth");
const db_1 = require("../db");
const audit_1 = require("../audit");
const userManagement_1 = require("../userManagement");
const router = (0, express_1.Router)();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
function ip(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
router.post('/login', async (req, res) => {
    if (!(0, auth_1.assertAllowedOrigin)(req, res))
        return;
    const userName = String(req.body?.userName ?? req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!userName || !password)
        return res.status(400).json({ error: 'Username and password are required.' });
    if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)
        return res.status(503).json({ error: 'Authentication is not fully configured. Ask an administrator to configure AUTH_SECRET.' });
    const key = `${ip(req)}:${userName.toLocaleLowerCase()}`;
    const recent = attempts.get(key);
    if (recent && Date.now() - recent.startedAt < WINDOW_MS && recent.count >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
    }
    if (!recent || Date.now() - recent.startedAt >= WINDOW_MS)
        attempts.set(key, { count: 1, startedAt: Date.now() });
    else
        recent.count += 1;
    try {
        const result = await (0, userManagement_1.userTransaction)(async (tx) => {
            const employee = await tx.employee.findFirst({ where: { userName, deletedAt: null } });
            const valid = employee?.password.startsWith('$2') && await bcryptjs_1.default.compare(password, employee.password);
            if (!employee || !valid || (employee.mustChangePassword && (!employee.tempPasswordExpiresAt || employee.tempPasswordExpiresAt <= new Date())))
                return null;
            // Redeem the temporary password now. Only this restricted session can set
            // the replacement; another login with the temporary secret must fail.
            await tx.employee.update({ where: { empId: employee.empId }, data: {
                    lastLoginAt: new Date(),
                    ...(employee.mustChangePassword ? { password: await bcryptjs_1.default.hash(node_crypto_1.default.randomBytes(32).toString('base64url'), 12) } : {}),
                } });
            const expiresAt = employee.mustChangePassword ? new Date(Math.min((0, auth_1.sessionExpiry)().getTime(), employee.tempPasswordExpiresAt.getTime())) : (0, auth_1.sessionExpiry)();
            const sessionId = node_crypto_1.default.randomUUID();
            await tx.authSession.create({ data: { id: sessionId, empId: employee.empId, expiresAt } });
            return { employee, expiresAt, sessionId };
        });
        if (!result) {
            await (0, audit_1.writeSystemLog)({ actorName: userName.slice(0, 100), actorRole: 'UNKNOWN', action: 'LOGIN_FAILED', ipAddress: ip(req), userAgent: req.header('user-agent') });
            return res.status(401).json({ error: 'Invalid or expired credentials. Ask an administrator to reset your password if needed.' });
        }
        const { employee, expiresAt, sessionId } = result;
        const token = (0, auth_1.createSessionToken)(employee.empId, sessionId, expiresAt);
        (0, auth_1.setSessionCookie)(res, token, expiresAt);
        attempts.delete(key);
        await (0, audit_1.writeSystemLog)({ actorEmpId: employee.empId, actorName: employee.empName, actorRole: employee.empRole, action: 'LOGIN', ipAddress: ip(req), userAgent: req.header('user-agent') });
        return res.json({ user: (0, userManagement_1.publicUser)(employee) });
    }
    catch (error) {
        console.error('Login failed:', error);
        return res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' });
    }
});
router.post('/change-password', auth_1.authenticate, async (req, res) => {
    if (!(0, auth_1.assertAllowedOrigin)(req, res))
        return;
    const { newPassword, currentPassword } = req.body ?? {};
    if (typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72)
        return res.status(400).json({ error: 'Use at least 12 characters and at most 72 bytes for your new password.' });
    try {
        const result = await (0, userManagement_1.userTransaction)(async (tx) => {
            const employee = await (0, userManagement_1.checkActor)(tx, req.user);
            if (employee.mustChangePassword) {
                if (!employee.tempPasswordExpiresAt || employee.tempPasswordExpiresAt <= new Date())
                    throw new userManagement_1.UserError(401, 'Your temporary password has expired. Ask an administrator for a reset.');
            }
            else if (typeof currentPassword !== 'string' || !await bcryptjs_1.default.compare(currentPassword, employee.password))
                throw new userManagement_1.UserError(400, 'Current password is incorrect.');
            if (typeof currentPassword === 'string' && newPassword === currentPassword)
                throw new userManagement_1.UserError(400, 'Choose a different password.');
            const user = await tx.employee.update({ where: { empId: employee.empId }, data: { password: await bcryptjs_1.default.hash(newPassword, 12), mustChangePassword: false, tempPasswordExpiresAt: null } });
            await tx.authSession.updateMany({ where: { empId: employee.empId, revokedAt: null }, data: { revokedAt: new Date() } });
            const sessionId = node_crypto_1.default.randomUUID();
            const expiresAt = (0, auth_1.sessionExpiry)();
            await tx.authSession.create({ data: { id: sessionId, empId: employee.empId, expiresAt } });
            await (0, userManagement_1.auditUser)(tx, req.user, 'USER_PASSWORD_CHANGED', user, null, { mustChangePassword: false });
            return { user, sessionId, expiresAt };
        });
        (0, auth_1.setSessionCookie)(res, (0, auth_1.createSessionToken)(result.user.empId, result.sessionId, result.expiresAt), result.expiresAt);
        res.json({ user: (0, userManagement_1.publicUser)(result.user) });
    }
    catch (error) {
        if (error instanceof userManagement_1.UserError)
            return res.status(error.status).json({ error: error.message });
        console.error('Password change failed:', error);
        res.status(503).json({ error: 'Password could not be changed.' });
    }
});
router.get('/me', auth_1.authenticate, (req, res) => {
    const { sessionId: _sessionId, ...user } = req.user;
    res.json({ user });
});
router.post('/logout', auth_1.authenticate, async (req, res) => {
    if (!(0, auth_1.assertAllowedOrigin)(req, res))
        return;
    try {
        await db_1.prisma.authSession.updateMany({ where: { id: req.user.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
        await (0, audit_1.writeSystemLog)({ actorEmpId: req.user.empId, actorName: req.user.empName, actorRole: req.user.empRole, action: 'LOGOUT', ipAddress: ip(req), userAgent: req.header('user-agent') });
        (0, auth_1.clearSessionCookie)(res);
        res.json({ message: 'You are signed out.' });
    }
    catch (error) {
        console.error('Logout failed:', error);
        (0, auth_1.clearSessionCookie)(res);
        res.status(503).json({ error: 'Sign-out could not be confirmed. The browser session was cleared.' });
    }
});
exports.default = router;
