import express, { Request, Response, Router } from 'express';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import { friendlyId } from '../friendlyId';

const router = Router();

//create operation for employee
router.post('/', async (req: Request, res: Response) => {
  try {
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
    await prisma.employee.delete({
      where: { empId: targetId }
    });
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
