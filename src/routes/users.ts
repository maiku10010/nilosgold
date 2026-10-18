import { Router } from 'express';
import { prisma } from '../db';
import { auditUser, checkAdmin, guardAdminRemoval, temporaryCredential, UserError, userSelect, userTransaction } from '../userManagement';
import crypto from 'node:crypto';
const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', async (_req, res, next) => {
  try { res.json(await prisma.employee.findMany({ select: userSelect, orderBy: { empName: 'asc' } })); } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const { empName, userName, empRole } = req.body;
    if (typeof empName !== 'string' || !empName.trim() || empName.length > 100 || typeof userName !== 'string' || !/^[a-zA-Z0-9._-]{3,100}$/.test(userName) || !['Admin', 'Staff'].includes(empRole)) throw new UserError(400, 'Enter a name, username (3–100 letters, numbers, dots, underscores or hyphens), and valid role.');
    const credential = await temporaryCredential();
    const user = await userTransaction(async tx => {
      await checkAdmin(tx, req.user!);
      const { temporaryPassword, ...stored } = credential;
      const user = await tx.employee.create({ data: { empId: crypto.randomUUID(), empName: empName.trim(), userName, empRole, rates: 0, ...stored }, select: userSelect });
      await auditUser(tx, req.user!, 'USER_CREATED', user, null, { empName: user.empName, userName, empRole, active: true });
      return user;
    });
    res.status(201).json({ user, temporaryPassword: credential.temporaryPassword, expiresAt: credential.tempPasswordExpiresAt });
  } catch (error: any) { if (error.code === 'P2002') return res.status(409).json({ error: 'That username is already in use.' }); next(error); }
});
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const credential = await temporaryCredential();
    const user = await userTransaction(async tx => {
      await checkAdmin(tx, req.user!);
      const target = await tx.employee.findUnique({ where: { empId: String(req.params.id) } });
      if (!target || target.deletedAt) throw new UserError(400, 'Reactivate this user before resetting their password.');
      const { temporaryPassword, ...stored } = credential;
      const user = await tx.employee.update({ where: { empId: target.empId }, data: stored, select: userSelect });
      await tx.authSession.updateMany({ where: { empId: target.empId, revokedAt: null }, data: { revokedAt: new Date() } });
      await auditUser(tx, req.user!, 'USER_PASSWORD_RESET', user, null, { mustChangePassword: true });
      return user;
    });
    res.json({ user, temporaryPassword: credential.temporaryPassword, expiresAt: credential.tempPasswordExpiresAt });
  } catch (error) { next(error); }
});
router.patch('/:id', async (req, res, next) => {
  try {
    const { empRole, active } = req.body;
    if ((empRole !== undefined && !['Admin', 'Staff'].includes(empRole)) || (active !== undefined && typeof active !== 'boolean') || (empRole === undefined && active === undefined)) throw new UserError(400, 'Choose a valid role or status.');
    const user = await userTransaction(async tx => {
      await checkAdmin(tx, req.user!);
      const target = await tx.employee.findUnique({ where: { empId: String(req.params.id) } });
      if (!target) throw new UserError(404, 'User not found.');
      await guardAdminRemoval(tx, req.user!, target, empRole ?? target.empRole, active ?? !target.deletedAt);
      const user = await tx.employee.update({ where: { empId: target.empId }, data: { empRole, ...(active !== undefined ? { deletedAt: active ? null : new Date() } : {}) }, select: userSelect });
      if (active === false || (empRole !== undefined && empRole !== target.empRole)) await tx.authSession.updateMany({ where: { empId: target.empId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (empRole !== undefined && empRole !== target.empRole) await auditUser(tx, req.user!, 'USER_ROLE_CHANGED', user, { empRole: target.empRole }, { empRole });
      if (active !== undefined && active !== !target.deletedAt) await auditUser(tx, req.user!, active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', user, { active: !target.deletedAt }, { active });
      return user;
    });
    res.json({ user });
  } catch (error) { next(error); }
});
router.use((error: any, _req: any, res: any, next: any) => { if (error instanceof UserError) return res.status(error.status).json({ error: error.message }); next(error); });
export default router;
