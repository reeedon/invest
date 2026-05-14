let cache = globalThis.__tdCache || { key: '', expiresAt: 0, payload: null };
globalThis.__tdCache = cache;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const tdKey = process.env.TWELVE_DATA_API_KEY;
  const fhKey = process.env.FINNHUB_API_KEY;

  if (!tdKey) {
    return res.status(500).json({ error: 'Missing TWELVE_DATA_API_KEY' });
  }

  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const tickers = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];

  const cacheKey = tickers.join(',');
  const now = Date.now();

  if (cache.payload && cache.key === cacheKey && cache.expiresAt > now) {
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    const txt = await res.text();
    return JSON.parse(txt);
  }

  // -------- Twelve Data primary --------
  async function fetchTwelve(ticker) {
    const url = `https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${tdKey}`;
    const data = await fetchJSON(url);

    if (data.status === "error") return null;

    const price = Number(data.close);
    if (!price) return null;

    return {
      price,
      change: Number(data.percent_change || 0),
      prev: Number(data.previous_close || 0)
    };
  }

  // -------- Finnhub fallback --------
  async function fetchFinnhub(ticker) {
    if (!fhKey) return null;

    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${fhKey}`;
      const data = await fetchJSON(url);

      const price = Number(data.c);
      if (!price) return null;

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

    // 1️⃣ Try Twelve Data first
    let quote = await fetchTwelve(ticker);

    // 2️⃣ If missing → fallback to Finnhub
    if (!quote) {
      quote = await fetchFinnhub(ticker);
    }

    if (quote) {
      prices[ticker] = quote;
    } else {
      errors[ticker] = "Not found in both APIs";
    }
  }

  const payload = { prices, errors };

  cache = globalThis.__tdCache = {
    key: cacheKey,
    expiresAt: Date.now() + 5 * 60 * 1000,
    payload
  };

  res.status(200).json(payload);
}
