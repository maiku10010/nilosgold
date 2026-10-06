"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const take = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const logs = await db_1.prisma.systemLog.findMany({
        ...(typeof req.query.actorEmpId === 'string' ? { where: { actorEmpId: req.query.actorEmpId } } : {}),
        orderBy: { createdAt: 'desc' }, take,
    });
    res.json(logs);
});
exports.default = router;
