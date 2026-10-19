"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editableSaleJobStatuses = void 0;
exports.validSaleJobStatus = validSaleJobStatus;
exports.updateSaleJobStatus = updateSaleJobStatus;
exports.editableSaleJobStatuses = ['IN_PROGRESS', 'READY_FOR_PICKUP', 'FINISHED', 'RELEASED'];
function validSaleJobStatus(value) {
    return exports.editableSaleJobStatuses.includes(value);
}
async function updateSaleJobStatus(tx, invoiceId, status) {
    if (!validSaleJobStatus(status))
        throw Object.assign(new Error('Choose a valid job status.'), { statusCode: 400 });
    const sale = await tx.sales.findFirst({ where: { invoiceId, deletedAt: null }, include: { job: true } });
    if (!sale || !sale.job || sale.job.deletedAt)
        throw Object.assign(new Error('Active sale and job not found.'), { statusCode: 404 });
    if (sale.status === 'CANCELLED' || !validSaleJobStatus(sale.job.status)) {
        throw Object.assign(new Error('Update this job through its costing workflow.'), { statusCode: 409 });
    }
    await tx.job_Cost.update({ where: { jobCostId: sale.job.jobCostId }, data: { status } });
}
