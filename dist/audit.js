"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditMutations = auditMutations;
exports.writeSystemLog = writeSystemLog;
const db_1 = require("./db");
const privateKey = /password|token|secret|authorization|cookie|api.?key/i;
function safeValue(value, key = '', depth = 0) {
    if (privateKey.test(key))
        return '[REDACTED]';
    if (depth > 4)
        return '[TRUNCATED]';
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.slice(0, 20).map(item => safeValue(item, '', depth + 1));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).slice(0, 40).map(([childKey, child]) => [childKey, safeValue(child, childKey, depth + 1)]));
    }
    if (typeof value === 'string' && value.length > 500)
        return `${value.slice(0, 500)}…`;
    return value;
}
function target(req) {
    const [entity = '', entityId = ''] = req.path.split('/').filter(Boolean);
    if (!entity)
        return { entityType: null, entityId: null };
    const types = { 'job-cost': 'JOB_COST', job_costing: 'JOB_COST', sales: 'SALE', expenses: 'EXPENSE', inventory: 'INVENTORY', inquiries: 'INQUIRY', client: 'CLIENT', employee: 'EMPLOYEE', approvals: 'APPROVAL' };
    return { entityType: types[entity] ?? entity.toUpperCase(), entityId: entityId || null };
}
const recordModels = {
    SALE: { delegate: 'sales', idField: 'invoiceId' }, JOB_COST: { delegate: 'job_Cost', idField: 'jobCostId' },
    EXPENSE: { delegate: 'expenses', idField: 'expenseId' }, INVENTORY: { delegate: 'inventory', idField: 'referenceId' },
    INQUIRY: { delegate: 'inquiries', idField: 'inquiryId' }, CLIENT: { delegate: 'client', idField: 'clientId' },
    EMPLOYEE: { delegate: 'employee', idField: 'empId' },
};
function responseRecordId(value, idField, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5)
        return null;
    const record = value;
    if (typeof record[idField] === 'string' && record[idField])
        return record[idField];
    for (const child of Object.values(record)) {
        const id = responseRecordId(child, idField, depth + 1);
        if (id)
            return id;
    }
    return null;
}
function responseRecord(value, idField, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5)
        return null;
    const record = value;
    if (typeof record[idField] === 'string')
        return value;
    for (const child of Object.values(record)) {
        const found = responseRecord(child, idField, depth + 1);
        if (found)
            return found;
    }
    return null;
}
async function auditMutations(req, res, next) {
    if (!req.user || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || /\/(?:auth\/)?logout\/?$/.test(req.path)) {
        next();
        return;
    }
    const user = req.user;
    const entity = target(req);
    const body = safeValue(req.body ?? {});
    const method = req.method;
    const path = req.path;
    let before = null;
    const model = entity.entityType ? recordModels[entity.entityType] : undefined;
    if (model && entity.entityId && method !== 'POST') {
        try {
            before = await db_1.prisma[model.delegate].findUnique({ where: { [model.idField]: entity.entityId } });
        }
        catch (error) {
            console.error('Could not read previous audit record:', error);
        }
    }
    let responseBody;
    const sendJson = res.json.bind(res);
    res.json = ((payload) => { responseBody = payload; return sendJson(payload); });
    res.once('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 400)
            return;
        const action = res.statusCode === 202 ? `${method}_REQUESTED` : method;
        const responseEntity = model ? responseRecord(responseBody, model.idField) : null;
        const recordId = entity.entityId ?? (model ? responseRecordId(responseBody, model.idField) ?? responseRecordId(body, model.idField) : null);
        void db_1.prisma.systemLog.create({
            data: {
                actorEmpId: user.empId,
                actorName: user.empName,
                actorRole: user.empRole,
                action,
                entityType: entity.entityType,
                entityId: recordId,
                details: { path, statusCode: res.statusCode, body, before: safeValue(before), after: safeValue(responseEntity ?? responseBody) },
                ipAddress: req.ip,
                userAgent: req.header('user-agent')?.slice(0, 400),
            },
        }).catch(error => console.error('Could not write activity log:', error));
    });
    next();
}
async function writeSystemLog(input) {
    try {
        await db_1.prisma.systemLog.create({
            data: {
                actorEmpId: input.actorEmpId ?? null,
                actorName: input.actorName,
                actorRole: input.actorRole,
                action: input.action,
                entityType: input.entityType ?? null,
                entityId: input.entityId ?? null,
                details: input.details === undefined ? undefined : safeValue(input.details),
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent?.slice(0, 400) ?? null,
            },
        });
    }
    catch (error) {
        console.error('Could not write activity log:', error);
    }
}
