import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import { friendlyId } from '../friendlyId';

const router = Router();

//create operation for employee
router.post('/', async (req: Request, res: Response) => {
  try {
    if (typeof req.body.empName !== 'string' || !req.body.empName.trim() || typeof req.body.userName !== 'string' || !req.body.userName.trim() || String(req.body.password ?? '').length < 8 || !['Admin', 'Staff'].includes(req.body.empRole) || !Number.isFinite(Number(req.body.rates)) || Number(req.body.rates) < 0) {
      return res.status(400).json({ error: 'Enter a name, username, password of at least 8 characters, valid role, and non-negative rate.' });
    }
    const newEmployee = await prisma.employee.create({
      data: {
        empId: friendlyId(),
        empName: req.body.empName,
        userName: req.body.userName,
        password: await bcrypt.hash(String(req.body.password ?? ''), 12),
        empRole: req.body.empRole,
        rates: req.body.rates
      }
    });
    const { password: _password, ...safeEmployee } = newEmployee;
    res.locals.auditRecordId = newEmployee.empId;
    res.json(safeEmployee);
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//read operation for employee
router.get('/', async (req: Request, res: Response) => {
  try {
    const allEmployees = await prisma.employee.findMany({
      where: { deletedAt: null },
      select: { empId: true, empName: true, userName: true, empRole: true, rates: true, jobs: true }
    });
    res.json(allEmployees);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//update operation for employee
router.put('/:empId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.empId)
      ? req.params.empId[0]
      : req.params.empId;
    if (req.body.empRole !== undefined && !['Admin', 'Staff'].includes(req.body.empRole)) return res.status(400).json({ error: 'Choose Admin or Staff for the employee role.' });
    const currentEmployee = await prisma.employee.findFirst({ where: { empId: targetId, deletedAt: null } });
    if (!currentEmployee) return res.status(404).json({ error: 'Employee not found.' });
    if (req.body.password !== undefined && String(req.body.password).length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' });
    const updatedEmployee = await prisma.employee.update({
      where: { empId: targetId },
      data: {
        empName: req.body.empName,
        userName: req.body.userName,
        ...(req.body.password ? { password: await bcrypt.hash(String(req.body.password), 12) } : {}),
        empRole: req.body.empRole,
        rates: req.body.rates,
      }
    });
    const { password: _password, ...safeEmployee } = updatedEmployee;
    res.json(safeEmployee);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// DELETE http://localhost:3000/employee/:empId
router.delete('/:empId', async (req: Request, res: Response) => {
  try {
    const targetId = Array.isArray(req.params.empId)
      ? req.params.empId[0]
      : req.params.empId;
    const deleted = await prisma.employee.updateMany({ where: { empId: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!deleted.count) return res.status(404).json({ error: 'Employee not found or already archived.' });
    res.json({ message: 'Employee successfully removed' });
  } catch (error: any) {
    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Cannot delete employee: They are assigned to historical Job Cost records.'
      });
    }
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

export default router;
