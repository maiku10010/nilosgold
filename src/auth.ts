import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { prisma } from './db';

export interface AuthUser {
  empId: string;
  empName: string;
  userName: string;
  empRole: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

const COOKIE_NAME = 'nilo_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

export function isAdminRole(role: string | undefined): boolean {
  return role?.trim().toLowerCase() === 'admin';
}

export function authCookieName(): string { return COOKIE_NAME; }
export function sessionExpiry(): Date { return new Date(Date.now() + SESSION_MS); }

function signingSecret(): string | null {
  const value = process.env.AUTH_SECRET;
  return value && value.length >= 32 ? value : null;
}

export function createSessionToken(empId: string, sessionId: string, expiresAt: Date): string {
  const secret = signingSecret();
  if (!secret) throw new Error('AUTH_SECRET must be configured with at least 32 characters.');
  const payload = Buffer.from(JSON.stringify({ sub: empId, jti: sessionId, exp: expiresAt.getTime() })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(req: Request): string | null {
  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  const cookieHeader = req.header('cookie') ?? '';
  const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : null;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.append('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=${Math.floor(maxAge / 1000)}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=0${secure ? '; Secure' : ''}`);
}

function validPayload(token: string): { sub: string; jti: string; exp: number } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(suppliedSignature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; jti?: unknown; exp?: unknown };
    if (typeof parsed.sub !== 'string' || typeof parsed.jti !== 'string' || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
    return { sub: parsed.sub, jti: parsed.jti, exp: parsed.exp };
  } catch { return null; }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req);
  if (!token) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
  const payload = validPayload(token);
  if (!payload) { res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' }); return; }
  try {
    const session = await prisma.authSession.findFirst({
      where: { id: payload.jti, empId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { employee: { select: { empId: true, empName: true, userName: true, empRole: true, deletedAt: true } } },
    });
    if (!session || session.employee.deletedAt) { res.status(401).json({ error: 'Your session has ended. Please sign in again.' }); return; }
    req.user = { ...session.employee, sessionId: session.id };
    next();
  } catch (error) {
    console.error('Session verification failed:', error);
    res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !isAdminRole(req.user.empRole)) { res.status(403).json({ error: 'Administrator access is required.' }); return; }
  next();
}

const vercelUiDeploymentOrigin = /^https:\/\/nilosgoldui-[a-z0-9-]+-myk-paul-edison-fugatas-projects\.vercel\.app$/i;

export function isAllowedOrigin(origin: string): boolean {
  const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,https://nilosgoldui.vercel.app')
    .split(',').map(item => item.trim()).filter(Boolean);
  return allowed.includes(origin) || vercelUiDeploymentOrigin.test(origin);
}

export function assertAllowedOrigin(req: Request, res: Response): boolean {
  const origin = req.header('origin');
  if (!origin || isAllowedOrigin(origin)) return true;
  res.status(403).json({ error: 'Request origin is not allowed.' });
  return false;
}
