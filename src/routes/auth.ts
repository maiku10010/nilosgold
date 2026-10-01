import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { assertAllowedOrigin, authenticate, clearSessionCookie, createSessionToken, sessionExpiry, setSessionCookie } from '../auth';
import { prisma } from '../db';
import { writeSystemLog } from '../audit';

const router = Router();
const attempts = new Map<string, { count: number; startedAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function ip(req: Request): string { return req.ip || req.socket.remoteAddress || 'unknown'; }

router.post('/login', async (req: Request, res: Response) => {
  if (!assertAllowedOrigin(req, res)) return;
  const userName = String(req.body?.userName ?? req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!userName || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) return res.status(503).json({ error: 'Authentication is not fully configured. Ask an administrator to configure AUTH_SECRET.' });
  const key = `${ip(req)}:${userName.toLocaleLowerCase()}`;
  const recent = attempts.get(key);
  if (recent && Date.now() - recent.startedAt < WINDOW_MS && recent.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
  }
  if (!recent || Date.now() - recent.startedAt >= WINDOW_MS) attempts.set(key, { count: 1, startedAt: Date.now() });
  else recent.count += 1;

  try {
    const employee = await prisma.employee.findFirst({ where: { userName, deletedAt: null } });
    const valid = employee
      ? (employee.password.startsWith('$2') ? await bcrypt.compare(password, employee.password) : password === employee.password)
      : false;
    if (!employee || !valid) {
      await writeSystemLog({ actorName: userName.slice(0, 100), actorRole: 'UNKNOWN', action: 'LOGIN_FAILED', ipAddress: ip(req), userAgent: req.header('user-agent') });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (!employee.password.startsWith('$2')) {
      await prisma.employee.update({ where: { empId: employee.empId }, data: { password: await bcrypt.hash(password, 12) } });
    }
    const expiresAt = sessionExpiry();
    const sessionId = crypto.randomUUID();
    await prisma.authSession.create({ data: { id: sessionId, empId: employee.empId, expiresAt } });
    const token = createSessionToken(employee.empId, sessionId, expiresAt);
    setSessionCookie(res, token, expiresAt);
    attempts.delete(key);
    await writeSystemLog({ actorEmpId: employee.empId, actorName: employee.empName, actorRole: employee.empRole, action: 'LOGIN', ipAddress: ip(req), userAgent: req.header('user-agent') });
    return res.json({ user: { empId: employee.empId, empName: employee.empName, userName: employee.userName, empRole: employee.empRole } });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' });
  }
});

router.get('/me', authenticate, (req: Request, res: Response) => {
  const { sessionId: _sessionId, ...user } = req.user!;
  res.json({ user });
});

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  if (!assertAllowedOrigin(req, res)) return;
  try {
    await prisma.authSession.updateMany({ where: { id: req.user!.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeSystemLog({ actorEmpId: req.user!.empId, actorName: req.user!.empName, actorRole: req.user!.empRole, action: 'LOGOUT', ipAddress: ip(req), userAgent: req.header('user-agent') });
    clearSessionCookie(res);
    res.json({ message: 'You are signed out.' });
  } catch (error) {
    console.error('Logout failed:', error);
    clearSessionCookie(res);
    res.status(503).json({ error: 'Sign-out could not be confirmed. The browser session was cleared.' });
  }
});

export default router;
