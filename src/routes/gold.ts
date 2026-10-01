import { Request, Response, Router } from 'express';

const router = Router();
let cached: { ratePerGram: number; currency: string; source: string; updatedAt: string; cachedAt: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

router.get('/price', async (_req: Request, res: Response) => {
  if (cached && Date.now() - cached.cachedAt < CACHE_MS) {
    res.json({ ratePerGram: cached.ratePerGram, currency: cached.currency, source: cached.source, updatedAt: cached.updatedAt });
    return;
  }
  const apiKey = process.env.GOLD_API_KEY;
  if (!apiKey) { res.status(503).json({ error: 'Live gold pricing is not configured yet.' }); return; }
  try {
    const url = process.env.GOLD_API_URL ?? 'https://www.goldapi.io/api/XAU/PHP';
    const response = await fetch(url, {
      headers: { 'x-access-token': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) { res.status(502).json({ error: `Gold price provider returned ${response.status}.` }); return; }
    const payload = await response.json() as { price_gram_24k?: number; currency?: string; timestamp?: number; price?: number };
    const rate = Number(payload.price_gram_24k);
    if (!Number.isFinite(rate) || rate <= 0) { res.status(502).json({ error: 'Gold price provider returned an invalid PHP per-gram rate.' }); return; }
    cached = {
      ratePerGram: rate,
      currency: 'PHP',
      source: 'GoldAPI.io',
      updatedAt: payload.timestamp ? new Date(payload.timestamp * 1000).toISOString() : new Date().toISOString(),
      cachedAt: Date.now(),
    };
    res.json({ ratePerGram: cached.ratePerGram, currency: cached.currency, source: cached.source, updatedAt: cached.updatedAt });
  } catch (error) {
    console.error('Live gold rate unavailable:', error);
    res.status(502).json({ error: 'Live gold price could not be retrieved.' });
  }
});

export default router;
