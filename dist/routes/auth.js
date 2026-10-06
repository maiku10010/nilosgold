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
const router = (0, express_1.Router)();
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
        const employee = await db_1.prisma.employee.findFirst({ where: { userName, deletedAt: null } });
        const valid = employee
            ? (employee.password.startsWith('$2') ? await bcryptjs_1.default.compare(password, employee.password) : password === employee.password)
            : false;
        if (!employee || !valid) {
            await (0, audit_1.writeSystemLog)({ actorName: userName.slice(0, 100), actorRole: 'UNKNOWN', action: 'LOGIN_FAILED', ipAddress: ip(req), userAgent: req.header('user-agent') });
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        if (!employee.password.startsWith('$2')) {
            await db_1.prisma.employee.update({ where: { empId: employee.empId }, data: { password: await bcryptjs_1.default.hash(password, 12) } });
        }
        const expiresAt = (0, auth_1.sessionExpiry)();
        const sessionId = node_crypto_1.default.randomUUID();
        await db_1.prisma.authSession.create({ data: { id: sessionId, empId: employee.empId, expiresAt } });
        const token = (0, auth_1.createSessionToken)(employee.empId, sessionId, expiresAt);
        (0, auth_1.setSessionCookie)(res, token, expiresAt);
        attempts.delete(key);
        await (0, audit_1.writeSystemLog)({ actorEmpId: employee.empId, actorName: employee.empName, actorRole: employee.empRole, action: 'LOGIN', ipAddress: ip(req), userAgent: req.header('user-agent') });
        return res.json({ user: { empId: employee.empId, empName: employee.empName, userName: employee.userName, empRole: employee.empRole } });
    }
    catch (error) {
        console.error('Login failed:', error);
        return res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' });
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
