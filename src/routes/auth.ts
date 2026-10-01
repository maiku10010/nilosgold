import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../db';

const router = Router();
const secret = process.env.AUTH_SECRET || 'change-this-auth-secret';
const tokenFor = (employee: { empId: string; userName: string; empRole: string }) => {
  const payload = Buffer.from(JSON.stringify({ ...employee, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

router.post('/login', async (req: Request, res: Response) => {
  const userName = String(req.body.userName ?? req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');
  if (!userName || !password) return res.status(400).json({ error: 'Username and password are required.' });
  const employee = await prisma.employee.findFirst({ where: { userName } });
  if (!employee) return res.status(401).json({ error: 'Invalid username or password.' });
  const valid = employee.password.startsWith('$2')
    ? await bcrypt.compare(password, employee.password)
    : password === employee.password;
  if (!valid) return res.status(401).json({ error: 'Invalid username or password.' });
  res.json({ token: tokenFor({ empId: employee.empId, userName: employee.userName, empRole: employee.empRole }), user: { empId: employee.empId, empName: employee.empName, userName: employee.userName, empRole: employee.empRole } });
});

export default router;
