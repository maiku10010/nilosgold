"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const router = (0, express_1.Router)();
//create operation for employee
router.post('/', async (req, res) => {
    try {
        const newEmployee = await db_1.prisma.employee.create({
            data: {
                empName: req.body.empName,
                userName: req.body.userName,
                password: await bcryptjs_1.default.hash(String(req.body.password ?? ''), 12),
                empRole: req.body.empRole,
                rates: req.body.rates
            }
        });
        const { password: _password, ...safeEmployee } = newEmployee;
        res.json(safeEmployee);
    }
    catch (error) {
        console.error('Error creating employee:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for employee
router.get('/', async (req, res) => {
    try {
        const allEmployees = await db_1.prisma.employee.findMany({
            select: { empId: true, empName: true, userName: true, empRole: true, rates: true, jobs: true }
        });
        res.json(allEmployees);
    }
    catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//update operation for employee
router.put('/:empId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.empId)
            ? req.params.empId[0]
            : req.params.empId;
        const updatedEmployee = await db_1.prisma.employee.update({
            where: { empId: targetId },
            data: {
                empName: req.body.empName,
                userName: req.body.userName,
                ...(req.body.password ? { password: await bcryptjs_1.default.hash(String(req.body.password), 12) } : {}),
                empRole: req.body.empRole,
                rates: req.body.rates,
            }
        });
        const { password: _password, ...safeEmployee } = updatedEmployee;
        res.json(safeEmployee);
    }
    catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// DELETE http://localhost:3000/employee/:empId
router.delete('/:empId', async (req, res) => {
    try {
        const targetId = Array.isArray(req.params.empId)
            ? req.params.empId[0]
            : req.params.empId;
        await db_1.prisma.employee.delete({
            where: { empId: targetId }
        });
        res.json({ message: 'Employee successfully removed' });
    }
    catch (error) {
        if (error.code === 'P2003') {
            return res.status(400).json({
                error: 'Cannot delete employee: They are assigned to historical Job Cost records.'
            });
        }
        console.error('Error deleting employee:', error);
        res.status(500).json({ error: 'Failed to delete employee' });
    }
});
exports.default = router;
