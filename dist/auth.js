"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdminRole = isAdminRole;
exports.authCookieName = authCookieName;
exports.sessionExpiry = sessionExpiry;
exports.createSessionToken = createSessionToken;
exports.setSessionCookie = setSessionCookie;
exports.clearSessionCookie = clearSessionCookie;
exports.authenticate = authenticate;
exports.requireAdmin = requireAdmin;
exports.isAllowedOrigin = isAllowedOrigin;
exports.assertAllowedOrigin = assertAllowedOrigin;
exports.requirePasswordChanged = requirePasswordChanged;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("./db");
const COOKIE_NAME = 'nilo_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
function isAdminRole(role) {
    return role?.trim().toLowerCase() === 'admin';
}
function authCookieName() { return COOKIE_NAME; }
function sessionExpiry() { return new Date(Date.now() + SESSION_MS); }
function signingSecret() {
    const value = process.env.AUTH_SECRET;
    return value && value.length >= 32 ? value : null;
}
function createSessionToken(empId, sessionId, expiresAt) {
    const secret = signingSecret();
    if (!secret)
        throw new Error('AUTH_SECRET must be configured with at least 32 characters.');
    const payload = Buffer.from(JSON.stringify({ sub: empId, jti: sessionId, exp: expiresAt.getTime() })).toString('base64url');
    const signature = node_crypto_1.default.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}
function readToken(req) {
    const authorization = req.header('authorization');
    if (authorization?.startsWith('Bearer '))
        return authorization.slice(7);
    const cookieHeader = req.header('cookie') ?? '';
    const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
    return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : null;
}
function setSessionCookie(res, token, expiresAt) {
    const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
    res.append('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=${Math.floor(maxAge / 1000)}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=0${secure ? '; Secure' : ''}`);
}
function validPayload(token) {
    const secret = signingSecret();
    if (!secret)
        return null;
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra)
        return null;
    const expected = node_crypto_1.default.createHmac('sha256', secret).update(payload).digest();
    let actual;
    try {
        actual = Buffer.from(suppliedSignature, 'base64url');
    }
    catch {
        return null;
    }
    if (actual.length !== expected.length || !node_crypto_1.default.timingSafeEqual(actual, expected))
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof parsed.sub !== 'string' || typeof parsed.jti !== 'string' || typeof parsed.exp !== 'number' || parsed.exp <= Date.now())
            return null;
        return { sub: parsed.sub, jti: parsed.jti, exp: parsed.exp };
    }
    catch {
        return null;
    }
}
async function authenticate(req, res, next) {
    const token = readToken(req);
    if (!token) {
        res.status(401).json({ error: 'Sign in to continue.' });
        return;
    }
    const payload = validPayload(token);
    if (!payload) {
        res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
        return;
    }
    try {
        const session = await db_1.prisma.authSession.findFirst({
            where: { id: payload.jti, empId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
            include: { employee: { select: { empId: true, empName: true, userName: true, empRole: true, deletedAt: true, mustChangePassword: true, tempPasswordExpiresAt: true } } },
        });
        if (!session || session.employee.deletedAt || (session.employee.mustChangePassword && (!session.employee.tempPasswordExpiresAt || session.employee.tempPasswordExpiresAt <= new Date()))) {
            res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
            return;
        }
        const { deletedAt, tempPasswordExpiresAt, ...user } = session.employee;
        req.user = { ...user, sessionId: session.id };
        next();
    }
    catch (error) {
        console.error('Session verification failed:', error);
        res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' });
    }
}
function requireAdmin(req, res, next) {
    if (!req.user || !isAdminRole(req.user.empRole)) {
        res.status(403).json({ error: 'Administrator access is required.' });
        return;
    }
    next();
}
const vercelUiDeploymentOrigin = /^https:\/\/nilosgoldui-[a-z0-9-]+-myk-paul-edison-fugatas-projects\.vercel\.app$/i;
function isAllowedOrigin(origin) {
    const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,https://nilosgoldui.vercel.app')
        .split(',').map(item => item.trim()).filter(Boolean);
    return allowed.includes(origin) || vercelUiDeploymentOrigin.test(origin);
}
function assertAllowedOrigin(req, res) {
    const origin = req.header('origin');
    if (!origin || isAllowedOrigin(origin))
        return true;
    res.status(403).json({ error: 'Request origin is not allowed.' });
    return false;
}
function requirePasswordChanged(req, res, next) {
    if (req.user?.mustChangePassword) {
        res.status(403).json({ error: 'Set your password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
        return;
    }
    next();
}
