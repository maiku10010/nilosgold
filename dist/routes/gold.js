"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gold_1 = require("../services/gold");
const router = (0, express_1.Router)();
router.get('/price', async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        res.json(await (0, gold_1.getGoldPrice)());
    }
    catch {
        res.status(503).json({ error: 'Live gold pricing is temporarily unavailable. Enter a verified rate manually for job costing.', retryAfterSeconds: 60 });
    }
});
exports.default = router;
