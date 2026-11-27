import type { Prisma } from '@prisma/client';

export const activeJobStaff = {
  deletedAt: null,
  empRole: { in: ['Staff', 'Admin'], mode: 'insensitive' },
} satisfies Prisma.EmployeeWhereInput;

export async function validateJobStaff(db: Pick<Prisma.TransactionClient, 'employee'>, empId: unknown, currentId?: string | null) {
  if (empId === undefined && currentId) return;
  const error = () => Object.assign(new Error('Choose an active Staff or Admin account.'), { statusCode: 400, field: 'empId' });
  if (typeof empId !== 'string' || !empId.trim()) throw error();
  if (empId === currentId) return;
  const employee = await db.employee.findFirst({ where: { ...activeJobStaff, empId }, select: { empId: true } });
  if (!employee) throw error();
}
