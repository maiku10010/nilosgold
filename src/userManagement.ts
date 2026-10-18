import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { AuthUser, isAdminRole } from './auth';

export class UserError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const userSelect = { empId: true, empName: true, userName: true, empRole: true, deletedAt: true, mustChangePassword: true, lastLoginAt: true, rates: true } as const;
export const publicUser = (user: { empId: string; empName: string; userName: string; empRole: string; mustChangePassword: boolean }) => ({ empId: user.empId, empName: user.empName, userName: user.userName, empRole: user.empRole, mustChangePassword: user.mustChangePassword });
// All credential/lifecycle writes share a transaction lock, including login.
// Read after acquiring the lock so simultaneous changes cannot remove both admins
// or redeem the same temporary password twice.
export async function userTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(18092026)::text`;
    return work(tx);
  }, { timeout: 15000 });
}
export async function checkActor(tx: Prisma.TransactionClient, actor: AuthUser) {
  const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, empId: actor.empId, revokedAt: null, expiresAt: { gt: new Date() } }, include: { employee: true } });
  if (!session || session.employee.deletedAt) throw new UserError(401, 'Your session has ended.');
  return session.employee;
}
export async function checkAdmin(tx: Prisma.TransactionClient, actor: AuthUser) {
  const user = await checkActor(tx, actor);
  if (!isAdminRole(user.empRole) || user.mustChangePassword) throw new UserError(403, 'Administrator access is required.');
  return user;
}
export async function auditUser(tx: Prisma.TransactionClient, actor: AuthUser, action: string, target: { empId: string; empName: string; userName: string }, before?: unknown, after?: unknown) {
  await tx.systemLog.create({ data: { actorEmpId: actor.empId, actorName: actor.empName, actorRole: actor.empRole, action, entityType: 'EMPLOYEE', entityId: target.empId, details: { targetName: target.empName, targetUsername: target.userName, before: before ?? null, after: after ?? null } as Prisma.InputJsonValue } });
}
export async function temporaryCredential() {
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');
  return { temporaryPassword, password: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
}
export async function guardAdminRemoval(tx: Prisma.TransactionClient, actor: AuthUser, target: { empId: string; empRole: string; deletedAt: Date | null }, role: string, active: boolean) {
  if (target.empId === actor.empId && (!active || !isAdminRole(role))) throw new UserError(400, 'You cannot deactivate or demote yourself.');
  if (!target.deletedAt && isAdminRole(target.empRole) && (!active || !isAdminRole(role))) {
    const count = await tx.employee.count({ where: { deletedAt: null, empRole: { equals: 'Admin', mode: 'insensitive' } } });
    if (count <= 1) throw new UserError(400, 'At least one active administrator is required.');
  }
}
