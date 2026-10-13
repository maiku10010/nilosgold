const GRAMS_PER_TROY_OUNCE = 31.1034768;
const CACHE_MS = 5 * 60_000;
const MAX_QUOTE_AGE_MS = 72 * 60 * 60_000;
const MAX_FALLBACK_MS = 24 * 60 * 60_000;
type Quote = { ratePerGram: number; currency: 'PHP'; source: string; updatedAt: string; fetchedAt: string; fxUpdatedAt?: string };
export type GoldRate = Quote & { stale: boolean; cached: boolean; warning?: string };

export function createGoldPriceService(options: { fetch?: typeof fetch; now?: () => number; apiKey?: () => string | undefined; apiUrl?: () => string | undefined } = {}) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: Quote | null = null;
  let nextRefresh = 0;
  let pending: Promise<GoldRate> | null = null;
  let lastWarning: string | undefined;
  let fxCache: { rate: number; updatedAt: string; expires: number } | null = null;

  function timestamp(value: unknown): string {
    const ms = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms) || ms > now() + 5 * 60_000 || now() - ms > MAX_QUOTE_AGE_MS) throw new Error('Invalid or outdated market timestamp.');
    return new Date(ms).toISOString();
  }
  function positive(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Invalid market rate.');
    return value;
  }
  async function json(url: string, headers?: Record<string, string>) {
    const response = await request(url, { headers, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`Market provider returned ${response.status}.`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid market response.');
    return data;
  }
  function output(quote: Quote, fromCache: boolean, warning?: string): GoldRate {
    const stale = now() - Date.parse(quote.updatedAt) > 15 * 60_000 || Boolean(warning?.includes('Last known'));
    return { ...quote, stale, cached: fromCache, ...(warning ? { warning } : {}) };
  }
  async function primary(key: string): Promise<Quote> {
    const url = options.apiUrl?.() ?? process.env.GOLD_API_URL ?? 'https://www.goldapi.io/api/XAU/PHP';
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'www.goldapi.io' || endpoint.pathname !== '/api/XAU/PHP' || endpoint.search || endpoint.username || endpoint.password) throw new Error('Invalid GoldAPI endpoint configuration.');
    const data = await json(url, { 'x-access-token': key });
    if (data.currency !== 'PHP' || data.metal !== 'XAU') throw new Error('Expected a PHP gold quote.');
    const rate = data.price_gram_24k === undefined ? positive(data.price) / GRAMS_PER_TROY_OUNCE : positive(data.price_gram_24k);
    return { ratePerGram: rate, currency: 'PHP', source: 'GoldAPI.io', updatedAt: timestamp(data.timestamp), fetchedAt: new Date(now()).toISOString() };
  }
  async function exchangeRate() {
    if (fxCache && now() < fxCache.expires) return fxCache;
    const data = await json('https://open.er-api.com/v6/latest/USD');
    if (data.result !== 'success' || data.base_code !== 'USD') throw new Error('Invalid USD exchange rate.');
    const updatedAt = timestamp(data.time_last_update_unix);
    if (now() - Date.parse(updatedAt) > 48 * 60 * 60_000) throw new Error('Exchange rate is too old.');
    fxCache = { rate: positive(data.rates?.PHP), updatedAt, expires: now() + 60 * 60_000 };
    return fxCache;
  }
  async function backup(): Promise<Quote> {
    const [data, fx] = await Promise.all([json('https://api.gold-api.com/price/XAU'), exchangeRate()]);
    if (data.symbol !== 'XAU' || data.currency !== 'USD') throw new Error('Expected a USD gold quote.');
    return { ratePerGram: positive(data.price) * fx.rate / GRAMS_PER_TROY_OUNCE, currency: 'PHP',
      source: 'Gold-API.com + ExchangeRate-API', updatedAt: timestamp(data.updatedAt),
      fetchedAt: new Date(now()).toISOString(), fxUpdatedAt: fx.updatedAt };
  }
  async function refresh(): Promise<GoldRate> {
    try {
      const key = options.apiKey ? options.apiKey() : process.env.GOLD_API_KEY;
      let quote: Quote | undefined;
      if (key) { try { quote = await primary(key); } catch { /* Try the independent provider. */ } }
      if (!quote) quote = await backup();
      cached = quote;
      nextRefresh = now() + CACHE_MS;
      lastWarning = quote.fxUpdatedAt ? 'Backup gold feed converted to PHP using the daily exchange rate.' : undefined;
      return output(quote, false, lastWarning);
    } catch {
      nextRefresh = now() + 60_000;
      if (cached && now() - Date.parse(cached.fetchedAt) <= MAX_FALLBACK_MS && now() - Date.parse(cached.updatedAt) <= MAX_QUOTE_AGE_MS) {
        lastWarning = 'Last known rate: live market providers are temporarily unavailable.';
        return output(cached, true, lastWarning);
      }
      cached = null;
      throw new Error('Live gold pricing is temporarily unavailable. Enter a verified rate manually for job costing.');
    }
  }
  return async (): Promise<GoldRate> => {
    if (now() < nextRefresh) {
      if (cached) return output(cached, true, lastWarning);
      throw new Error('Live gold pricing is temporarily unavailable. Please try again shortly.');
    }
    if (!pending) pending = refresh().finally(() => { pending = null; });
    return pending;
  };
}

export const getGoldPrice = createGoldPriceService();
