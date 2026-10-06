"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
let cached = null;
const CACHE_MS = 5 * 60 * 1000;
router.get('/price', async (_req, res) => {
    if (cached && Date.now() - cached.cachedAt < CACHE_MS) {
        res.json({ ratePerGram: cached.ratePerGram, currency: cached.currency, source: cached.source, updatedAt: cached.updatedAt });
        return;
    }
    const apiKey = process.env.GOLD_API_KEY;
    if (!apiKey) {
        res.status(503).json({ error: 'Live gold pricing is not configured yet.' });
        return;
    }
    try {
        const url = process.env.GOLD_API_URL ?? 'https://www.goldapi.io/api/XAU/PHP';
        const response = await fetch(url, {
            headers: { 'x-access-token': apiKey, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            res.status(502).json({ error: `Gold price provider returned ${response.status}.` });
            return;
        }
        const payload = await response.json();
        const rate = Number(payload.price_gram_24k);
        if (!Number.isFinite(rate) || rate <= 0) {
            res.status(502).json({ error: 'Gold price provider returned an invalid PHP per-gram rate.' });
            return;
        }
        cached = {
            ratePerGram: rate,
            currency: 'PHP',
            source: 'GoldAPI.io',
            updatedAt: payload.timestamp ? new Date(payload.timestamp * 1000).toISOString() : new Date().toISOString(),
            cachedAt: Date.now(),
        };
        res.json({ ratePerGram: cached.ratePerGram, currency: cached.currency, source: cached.source, updatedAt: cached.updatedAt });
    }
    catch (error) {
        console.error('Live gold rate unavailable:', error);
        res.status(502).json({ error: 'Live gold price could not be retrieved.' });
    }
});
exports.default = router;
