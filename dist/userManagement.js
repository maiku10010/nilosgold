"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicUser = exports.userSelect = exports.UserError = void 0;
exports.userTransaction = userTransaction;
exports.checkActor = checkActor;
exports.checkAdmin = checkAdmin;
exports.auditUser = auditUser;
exports.temporaryCredential = temporaryCredential;
exports.guardAdminRemoval = guardAdminRemoval;
const node_crypto_1 = __importDefault(require("node:crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./db");
const auth_1 = require("./auth");
class UserError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.UserError = UserError;
exports.userSelect = { empId: true, empName: true, userName: true, empRole: true, deletedAt: true, mustChangePassword: true, lastLoginAt: true, rates: true };
const publicUser = (user) => ({ empId: user.empId, empName: user.empName, userName: user.userName, empRole: user.empRole, mustChangePassword: user.mustChangePassword });
exports.publicUser = publicUser;
// All credential/lifecycle writes share a transaction lock, including login.
// Read after acquiring the lock so simultaneous changes cannot remove both admins
// or redeem the same temporary password twice.
async function userTransaction(work) {
    return db_1.prisma.$transaction(async (tx) => {
        await tx.$queryRaw `SELECT pg_advisory_xact_lock(18092026)::text`;
        return work(tx);
    }, { timeout: 15000 });
}
async function checkActor(tx, actor) {
    const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, empId: actor.empId, revokedAt: null, expiresAt: { gt: new Date() } }, include: { employee: true } });
    if (!session || session.employee.deletedAt)
        throw new UserError(401, 'Your session has ended.');
    return session.employee;
}
async function checkAdmin(tx, actor) {
    const user = await checkActor(tx, actor);
    if (!(0, auth_1.isAdminRole)(user.empRole) || user.mustChangePassword)
        throw new UserError(403, 'Administrator access is required.');
    return user;
}
async function auditUser(tx, actor, action, target, before, after) {
    await tx.systemLog.create({ data: { actorEmpId: actor.empId, actorName: actor.empName, actorRole: actor.empRole, action, entityType: 'EMPLOYEE', entityId: target.empId, details: { targetName: target.empName, targetUsername: target.userName, before: before ?? null, after: after ?? null } } });
}
async function temporaryCredential() {
    const temporaryPassword = node_crypto_1.default.randomBytes(24).toString('base64url');
    return { temporaryPassword, password: await bcryptjs_1.default.hash(temporaryPassword, 12), mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
}
async function guardAdminRemoval(tx, actor, target, role, active) {
    if (target.empId === actor.empId && (!active || !(0, auth_1.isAdminRole)(role)))
        throw new UserError(400, 'You cannot deactivate or demote yourself.');
    if (!target.deletedAt && (0, auth_1.isAdminRole)(target.empRole) && (!active || !(0, auth_1.isAdminRole)(role))) {
        const count = await tx.employee.count({ where: { deletedAt: null, empRole: { equals: 'Admin', mode: 'insensitive' } } });
        if (count <= 1)
            throw new UserError(400, 'At least one active administrator is required.');
    }
}
