"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const router = (0, express_1.Router)();
const secret = process.env.AUTH_SECRET || 'change-this-auth-secret';
const tokenFor = (employee) => {
    const payload = Buffer.from(JSON.stringify({ ...employee, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
    const signature = crypto_1.default.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
};
router.post('/login', async (req, res) => {
    const userName = String(req.body.userName ?? req.body.username ?? '').trim();
    const password = String(req.body.password ?? '');
    if (!userName || !password)
        return res.status(400).json({ error: 'Username and password are required.' });
    const employee = await db_1.prisma.employee.findFirst({ where: { userName } });
    if (!employee)
        return res.status(401).json({ error: 'Invalid username or password.' });
    const valid = employee.password.startsWith('$2')
        ? await bcryptjs_1.default.compare(password, employee.password)
        : password === employee.password;
    if (!valid)
        return res.status(401).json({ error: 'Invalid username or password.' });
    res.json({ token: tokenFor({ empId: employee.empId, userName: employee.userName, empRole: employee.empRole }), user: { empId: employee.empId, empName: employee.empName, userName: employee.userName, empRole: employee.empRole } });
});
exports.default = router;
