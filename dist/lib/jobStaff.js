"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeJobStaff = void 0;
exports.validateJobStaff = validateJobStaff;
exports.activeJobStaff = {
    deletedAt: null,
    empRole: { in: ['Staff', 'Admin'], mode: 'insensitive' },
};
async function validateJobStaff(db, empId, currentId) {
    if (empId === undefined && currentId)
        return;
    const error = () => Object.assign(new Error('Choose an active Staff or Admin account.'), { statusCode: 400, field: 'empId' });
    if (typeof empId !== 'string' || !empId.trim())
        throw error();
    if (empId === currentId)
        return;
    const employee = await db.employee.findFirst({ where: { ...exports.activeJobStaff, empId }, select: { empId: true } });
    if (!employee)
        throw error();
}
