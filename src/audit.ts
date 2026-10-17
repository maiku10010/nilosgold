import { NextFunction, Request, Response } from 'express';
import { prisma } from './db';

const privateKey = /password|token|secret|authorization|cookie|api.?key/i;
function safeValue(value: unknown, key = '', depth = 0): unknown {
  if (privateKey.test(key)) return '[REDACTED]';
  if (depth > 4) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
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

const recordModels: Record<string, { delegate: string; idField: string }> = {
  SALE: { delegate: 'sales', idField: 'invoiceId' }, JOB_COST: { delegate: 'job_Cost', idField: 'jobCostId' },
  EXPENSE: { delegate: 'expenses', idField: 'expenseId' }, INVENTORY: { delegate: 'inventory', idField: 'referenceId' },
  INQUIRY: { delegate: 'inquiries', idField: 'inquiryId' }, CLIENT: { delegate: 'client', idField: 'clientId' },
  EMPLOYEE: { delegate: 'employee', idField: 'empId' },
};

function responseRecordId(value: unknown, idField: string, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const record = value as Record<string, unknown>;
  if (typeof record[idField] === 'string' && record[idField]) return record[idField] as string;
  for (const child of Object.values(record)) {
    const id = responseRecordId(child, idField, depth + 1);
    if (id) return id;
  }
  return null;
}

function responseRecord(value: unknown, idField: string, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const record = value as Record<string, unknown>;
  if (typeof record[idField] === 'string') return value;
  for (const child of Object.values(record)) {
    const found = responseRecord(child, idField, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function auditMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || /\/(?:auth\/)?logout\/?$/.test(req.path)) { next(); return; }
  const user = req.user;
  const entity = target(req);
  const body = safeValue(req.body ?? {});
  const method = req.method;
  const path = req.path;
  let before: unknown = null;
  const model = entity.entityType ? recordModels[entity.entityType] : undefined;
  if (model && entity.entityId && method !== 'POST') {
    try { before = await (prisma as any)[model.delegate].findUnique({ where: { [model.idField]: entity.entityId } }); }
    catch (error) { console.error('Could not read previous audit record:', error); }
  }
  let responseBody: unknown;
  const sendJson = res.json.bind(res);
  res.json = ((payload: unknown) => { responseBody = payload; return sendJson(payload); }) as Response['json'];
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    const action = res.statusCode === 202 ? `${method}_REQUESTED` : method;
    const responseEntity = model ? responseRecord(responseBody, model.idField) : null;
    const recordId = entity.entityId ?? (model ? responseRecordId(responseBody, model.idField) ?? responseRecordId(body, model.idField) : null);
    void prisma.systemLog.create({
      data: {
        actorEmpId: user.empId,
        actorName: user.empName,
        actorRole: user.empRole,
        action,
        entityType: entity.entityType,
        entityId: recordId,
        details: { path, statusCode: res.statusCode, body, before: safeValue(before), after: safeValue(responseEntity ?? responseBody) } as never,
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
