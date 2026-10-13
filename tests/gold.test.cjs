const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGoldPriceService } = require('../dist/services/gold');
const { isValidPHContact } = require('../dist/validation');
const start = Date.parse('2026-10-14T01:00:00Z');
const good = { currency: 'PHP', metal: 'XAU', timestamp: start / 1000, price_gram_24k: 8000 };
const response = data => ({ ok: true, json: async () => data });

test('primary PHP quote is cached and concurrent requests are combined', async () => {
  let count = 0;
  const price = createGoldPriceService({ apiKey: () => 'test', now: () => start,
    fetch: async (url, init) => { count++; assert.equal(init.headers['x-access-token'], 'test'); return response(good); } });
  const quotes = await Promise.all([price(), price(), price()]);
  assert.equal(count, 1); assert.equal(quotes[0].ratePerGram, 8000);
  assert.equal((await price()).cached, true); assert.equal(count, 1);
});
test('troy ounce primary price converts correctly when gram field is absent', async () => {
  const price = createGoldPriceService({ apiKey: () => 'test', now: () => start,
    fetch: async () => response({ ...good, price_gram_24k: undefined, price: 311034.768 }) });
  assert.equal((await price()).ratePerGram, 10000);
});
test('missing key uses live USD backup and daily PHP conversion without sending credentials', async () => {
  const price = createGoldPriceService({ apiKey: () => undefined, now: () => start,
    fetch: async (url, init) => {
      assert.equal(init.headers, undefined);
      return response(url.includes('gold-api') ? { symbol: 'XAU', currency: 'USD', price: 3110.34768, updatedAt: new Date(start).toISOString() }
        : { result: 'success', base_code: 'USD', rates: { PHP: 60 }, time_last_update_unix: start / 1000 });
    } });
  const quote = await price();
  assert.equal(quote.ratePerGram, 6000); assert.ok(quote.fxUpdatedAt); assert.equal(quote.stale, false);
  assert.match(quote.warning, /daily exchange/);
});
test('provider failures and malformed primary quotes fall back', async () => {
  for (const primary of [{ ...good, currency: 'USD' }, { ...good, metal: 'XAG' }, { ...good, price_gram_24k: -1 }, { ...good, timestamp: 1 }, { ...good, timestamp: start / 1000 + 100000 }, null, 'timeout', 'quota']) {
    const price = createGoldPriceService({ apiKey: () => 'test', now: () => start, fetch: async url => {
      if (url.includes('goldapi.io')) {
        if (primary === 'timeout') throw new Error('timeout');
        if (primary === 'quota') return { ok: false, status: 429 };
        return response(primary);
      }
      return response(url.includes('gold-api') ? { symbol: 'XAU', currency: 'USD', price: 3100, updatedAt: new Date(start).toISOString() }
        : { result: 'success', base_code: 'USD', rates: { PHP: 60 }, time_last_update_unix: start / 1000 });
    } });
    assert.match((await price()).source, /Gold-API.com/);
  }
});
test('outage preserves timestamp as stale then stops serving quotes after 24 hours', async () => {
  let time = start; let failing = false;
  const price = createGoldPriceService({ apiKey: () => 'test', now: () => time,
    fetch: async () => { if (failing) throw new Error('offline'); return response(good); } });
  const original = await price();
  failing = true; time += 6 * 60_000;
  const stale = await price();
  assert.equal(stale.stale, true); assert.equal(stale.updatedAt, original.updatedAt); assert.equal(stale.ratePerGram, 8000);
  time += 24 * 60 * 60_000;
  await assert.rejects(price(), /unavailable/);
});
test('invalid fallback currency and FX never become a PHP quote', async () => {
  for (const broken of ['metal', 'currency', 'fx', 'oldFx']) {
    const price = createGoldPriceService({ apiKey: () => undefined, now: () => start, fetch: async url => response(url.includes('gold-api')
      ? { symbol: broken === 'metal' ? 'XAG' : 'XAU', currency: broken === 'currency' ? 'EUR' : 'USD', price: 3000, updatedAt: new Date(start).toISOString() }
      : { result: 'success', base_code: 'USD', rates: { PHP: broken === 'fx' ? 0 : 60 }, time_last_update_unix: start / 1000 - (broken === 'oldFx' ? 180000 : 0) }) });
    await assert.rejects(price(), /unavailable/);
  }
});
test('configured provider cannot send API key to an unexpected host', async () => {
  const seen = [];
  const price = createGoldPriceService({ apiKey: () => 'test', apiUrl: () => 'https://example.com/api/XAU/PHP', now: () => start,
    fetch: async url => { seen.push(url); throw new Error('offline'); } });
  await assert.rejects(price()); assert.ok(seen.every(url => !url.includes('example.com')));
});
test('phone validation accepts only 11 numeric digits beginning with 09', () => {
  assert.equal(isValidPHContact('09123456789'), true);
  for (const value of ['', '09123', '091234567890', '+639123456789', '0912-345-6789', ' 09123456789', '0912345678a', '08123456789', 9123456789]) assert.equal(isValidPHContact(value), false);
});
