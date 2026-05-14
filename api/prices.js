// Simple in-memory cache (5 minutes)
let cache = globalThis.__cache || { key: '', expiresAt: 0, payload: null };
globalThis.__cache = cache;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const tdKey = process.env.TWELVE_DATA_API_KEY;
  const fhKey = process.env.FINNHUB_API_KEY;

  if (!tdKey) {
    return res.status(500).json({ error: 'Missing TWELVE_DATA_API_KEY' });
  }

  const raw = req.query.symbols || '';
  const tickers = [...new Set(
    raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  )];

  const cacheKey = tickers.join(',');
  const now = Date.now();

  // ✅ Return cached if valid
  if (cache.payload && cache.key === cacheKey && cache.expiresAt > now) {
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  async function fetchJSON(url) {
    const r = await fetch(url);
    const t = await r.text();
    return JSON.parse(t);
  }

  // ✅ PRIMARY: Twelve Data
async function fetchTwelve(ticker) {
  try {
    // 1️⃣ Try quote first
    let url = `https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${tdKey}`;
    let data = await fetchJSON(url);

    if (data.status !== "error" && data.close) {
      return {
        price: Number(data.close),
        change: Number(data.percent_change || 0),
        prev: Number(data.previous_close || 0)
      };
    }

    // 2️⃣ FALLBACK: use /price endpoint (works better for ETFs)
    url = `https://api.twelvedata.com/price?symbol=${ticker}&apikey=${tdKey}`;
    data = await fetchJSON(url);

    const price = Number(data.price);
    if (!price || price <= 0) return null;

    return {
      price,
      change: 0,
      prev: price
    };

  } catch {
    return null;
  }
}

  // ✅ FALLBACK: Finnhub
  async function fetchFinnhub(ticker) {
    if (!fhKey) return null;

    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${fhKey}`;
      const data = await fetchJSON(url);

      const price = Number(data.c);
      if (!price || price <= 0) return null;

      return {
        price,
        change: ((data.c - data.pc) / data.pc) * 100 || 0,
        prev: Number(data.pc)
      };
    } catch {
      return null;
    }
  }

  const prices = {};
  const errors = {};

  for (const ticker of tickers) {
    let quote = null;

    // ✅ Try Twelve Data first
    quote = await fetchTwelve(ticker);

    // ✅ If missing → fallback to Finnhub
    if (!quote) {
      quote = await fetchFinnhub(ticker);
    }

    if (quote) {
      prices[ticker] = quote;
    } else {
      errors[ticker] = 'Not found in both APIs';
    }
  }

  const payload = { prices, errors, cached: false };

  // ✅ Cache result (5 min)
  cache = globalThis.__cache = {
    key: cacheKey,
    expiresAt: Date.now() + 5 * 60 * 1000,
    payload
  };

  res.status(200).json(payload);
}
``
