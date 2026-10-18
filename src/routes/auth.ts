import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { assertAllowedOrigin, authenticate, clearSessionCookie, createSessionToken, sessionExpiry, setSessionCookie } from '../auth';
import { prisma } from '../db';
import { writeSystemLog } from '../audit';
import { auditUser, checkActor, publicUser, UserError, userTransaction } from '../userManagement';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
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
    const result = await userTransaction(async tx => {
      const employee = await tx.employee.findFirst({ where: { userName, deletedAt: null } });
      const valid = employee?.password.startsWith('$2') && await bcrypt.compare(password, employee.password);
      if (!employee || !valid || (employee.mustChangePassword && (!employee.tempPasswordExpiresAt || employee.tempPasswordExpiresAt <= new Date()))) return null;
      // Redeem the temporary password now. Only this restricted session can set
      // the replacement; another login with the temporary secret must fail.
      await tx.employee.update({ where: { empId: employee.empId }, data: {
        lastLoginAt: new Date(),
        ...(employee.mustChangePassword ? { password: await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12) } : {}),
      } });
      const expiresAt = employee.mustChangePassword ? new Date(Math.min(sessionExpiry().getTime(), employee.tempPasswordExpiresAt!.getTime())) : sessionExpiry();
      const sessionId = crypto.randomUUID();
      await tx.authSession.create({ data: { id: sessionId, empId: employee.empId, expiresAt } });
      return { employee, expiresAt, sessionId };
    });
    if (!result) {
      await writeSystemLog({ actorName: userName.slice(0, 100), actorRole: 'UNKNOWN', action: 'LOGIN_FAILED', ipAddress: ip(req), userAgent: req.header('user-agent') });
      return res.status(401).json({ error: 'Invalid or expired credentials. Ask an administrator to reset your password if needed.' });
    }
    const { employee, expiresAt, sessionId } = result;
    const token = createSessionToken(employee.empId, sessionId, expiresAt);
    setSessionCookie(res, token, expiresAt);
    attempts.delete(key);
    await writeSystemLog({ actorEmpId: employee.empId, actorName: employee.empName, actorRole: employee.empRole, action: 'LOGIN', ipAddress: ip(req), userAgent: req.header('user-agent') });
    return res.json({ user: publicUser(employee) });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' });
  }
});

router.post('/change-password', authenticate, async (req: Request, res: Response) => {
  if (!assertAllowedOrigin(req, res)) return;
  const { newPassword, currentPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72) return res.status(400).json({ error: 'Use at least 12 characters and at most 72 bytes for your new password.' });
  try {
    const result = await userTransaction(async tx => {
      const employee = await checkActor(tx, req.user!);
      if (employee.mustChangePassword) {
        if (!employee.tempPasswordExpiresAt || employee.tempPasswordExpiresAt <= new Date()) throw new UserError(401, 'Your temporary password has expired. Ask an administrator for a reset.');
      } else if (typeof currentPassword !== 'string' || !await bcrypt.compare(currentPassword, employee.password)) throw new UserError(400, 'Current password is incorrect.');
      if (typeof currentPassword === 'string' && newPassword === currentPassword) throw new UserError(400, 'Choose a different password.');
      const user = await tx.employee.update({ where: { empId: employee.empId }, data: { password: await bcrypt.hash(newPassword, 12), mustChangePassword: false, tempPasswordExpiresAt: null } });
      await tx.authSession.updateMany({ where: { empId: employee.empId, revokedAt: null }, data: { revokedAt: new Date() } });
      const sessionId = crypto.randomUUID();
      const expiresAt = sessionExpiry();
      await tx.authSession.create({ data: { id: sessionId, empId: employee.empId, expiresAt } });
      await auditUser(tx, req.user!, 'USER_PASSWORD_CHANGED', user, null, { mustChangePassword: false });
      return { user, sessionId, expiresAt };
    });
    setSessionCookie(res, createSessionToken(result.user.empId, result.sessionId, result.expiresAt), result.expiresAt);
    res.json({ user: publicUser(result.user) });
  } catch (error) {
    if (error instanceof UserError) return res.status(error.status).json({ error: error.message });
    console.error('Password change failed:', error);
    res.status(503).json({ error: 'Password could not be changed.' });
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
