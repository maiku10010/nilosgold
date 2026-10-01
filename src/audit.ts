import { NextFunction, Request, Response } from 'express';
import { prisma } from './db';

const privateKey = /password|token|secret|authorization|cookie|api.?key/i;
function safeValue(value: unknown, key = '', depth = 0): unknown {
  if (privateKey.test(key)) return '[REDACTED]';
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([childKey, child]) => [childKey, safeValue(child, childKey, depth + 1)]));
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function target(req: Request): { entityType: string | null; entityId: string | null } {
  const [entity = '', entityId = ''] = req.path.split('/').filter(Boolean);
  if (!entity) return { entityType: null, entityId: null };
  const types: Record<string, string> = { 'job-cost': 'JOB_COST', job_costing: 'JOB_COST', sales: 'SALE', expenses: 'EXPENSE', inventory: 'INVENTORY', inquiries: 'INQUIRY', client: 'CLIENT', employee: 'EMPLOYEE', approvals: 'APPROVAL' };
  return { entityType: types[entity] ?? entity.toUpperCase(), entityId: entityId || null };
}

export function auditMutations(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return; }
  const user = req.user;
  const entity = target(req);
  const details = safeValue(req.body ?? {}) as object;
  const method = req.method;
  const path = req.path;
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    const action = res.statusCode === 202 ? `${method}_REQUESTED` : method;
    void prisma.systemLog.create({
      data: {
        actorEmpId: user.empId,
        actorName: user.empName,
        actorRole: user.empRole,
        action,
        entityType: entity.entityType,
        entityId: entity.entityId,
        details: { path, statusCode: res.statusCode, body: details } as never,
        ipAddress: req.ip,
        userAgent: req.header('user-agent')?.slice(0, 400),
      },
    }).catch(error => console.error('Could not write activity log:', error));
  });
  next();
}

export async function writeSystemLog(input: {
  actorEmpId?: string | null; actorName: string; actorRole: string; action: string;
  entityType?: string | null; entityId?: string | null; details?: unknown; ipAddress?: string | null; userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: {
        actorEmpId: input.actorEmpId ?? null,
        actorName: input.actorName,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        details: input.details === undefined ? undefined : safeValue(input.details) as never,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
      },
    });
  } catch (error) { console.error('Could not write activity log:', error); }
}
