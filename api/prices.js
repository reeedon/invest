let cache = globalThis.__tdCache || { key: '', expiresAt: 0, payload: null };
globalThis.__tdCache = cache;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing TWELVE_DATA_API_KEY environment variable in Vercel.' });
  }

  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const tickers = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!tickers.length) {
    return res.status(400).json({ error: 'Provide symbols query param, e.g. /api/prices?symbols=VTI,NVDA' });
  }

  const cacheKey = tickers.join(',');
  const now = Date.now();
  if (cache.payload && cache.key === cacheKey && cache.expiresAt > now) {
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = text; }
    if (!response.ok) {
      const snippet = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
      throw new Error(`HTTP ${response.status}: ${snippet}`);
    }
    return data;
  }

  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    const price = Number(data.close ?? data.price ?? data.previous_close ?? 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    const change = Number(data.percent_change ?? data.change_percent ?? 0);
    const prev = Number(data.previous_close ?? 0);
    return { price, change, prev };
  }

  async function fetchTicker(ticker) {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const data = await fetchJson(url);
    if (data && data.status === 'error') {
      throw new Error(data.message || 'Twelve Data returned an error');
    }
    const quote = normalize(data);
    if (!quote) {
      throw new Error('Unexpected Twelve Data response format');
    }
    return quote;
  }

  const prices = {};
  const errors = {};
  const results = await Promise.allSettled(tickers.map(async (ticker) => ({ ticker, quote: await fetchTicker(ticker) })));
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      prices[result.value.ticker] = result.value.quote;
    } else {
      errors[tickers[i]] = result.reason?.message || 'Failed to load price';
    }
  });

  const payload = { prices, errors, cached: false };
  cache = globalThis.__tdCache = { key: cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, payload };
  return res.status(200).json(payload);
}
