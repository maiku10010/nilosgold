import { Prisma } from '@prisma/client';

export const editableSaleJobStatuses = ['IN_PROGRESS', 'READY_FOR_PICKUP', 'FINISHED'] as const;
export function validSaleJobStatus(value: unknown): value is typeof editableSaleJobStatuses[number] {
  return editableSaleJobStatuses.includes(value as typeof editableSaleJobStatuses[number]);
}
export async function updateSaleJobStatus(tx: Prisma.TransactionClient, invoiceId: string, status: unknown) {
  if (!validSaleJobStatus(status)) throw Object.assign(new Error('Choose a valid job status.'), { statusCode: 400 });
  const sale = await tx.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: { job: true } });
  if (!sale || !sale.job || sale.job.deletedAt) throw Object.assign(new Error('Active sale and job not found.'), { statusCode: 404 });
  if (sale.status === 'PENDING' || sale.status === 'CANCELLED' || !validSaleJobStatus(sale.job.status)) {
    throw Object.assign(new Error('Update this job through its costing workflow.'), { statusCode: 409 });
  }
  await tx.job_Cost.update({ where: { jobCostId: sale.job.jobCostId }, data: { status } });
}
