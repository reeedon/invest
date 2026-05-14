let cache = globalThis.__cache || { key: '', expiresAt: 0, payload: null };
globalThis.__cache = cache;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const tdKey = process.env.TWELVE_DATA_API_KEY;
  const fhKey = process.env.FINNHUB_API_KEY;

  const raw = req.query.symbols || '';
  const tickers = [...new Set(
    raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  )];

  const cacheKey = tickers.join(',');
  const now = Date.now();

  if (cache.payload && cache.key === cacheKey && cache.expiresAt > now) {
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  async function fetchJSON(url) {
    const r = await fetch(url);
    return await r.json();
  }

  async function fetchTwelve(ticker) {
    try {
      const data = await fetchJSON(
        `https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${tdKey}`
      );

      if (data.status === "error") return null;

      return {
        price: Number(data.close),
        change: Number(data.percent_change || 0),
        prev: Number(data.previous_close || 0)
      };
    } catch {
      return null;
    }
  }

  async function fetchFinnhub(ticker) {
    if (!fhKey) return null;

    try {
      const data = await fetchJSON(
        `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${fhKey}`
      );

      if (!data.c) return null;

      return {
        price: Number(data.c),
        change: ((data.c - data.pc) / data.pc) * 100 || 0,
        prev: Number(data.pc)
      };
    } catch {
      return null;
    }
  }

  const prices = {};
  const errors = {};

  for (const t of tickers) {
    let q = await fetchTwelve(t);
    if (!q) q = await fetchFinnhub(t);

    if (q) prices[t] = q;
    else errors[t] = "Missing";
  }

  const payload = { prices, errors };

  cache = globalThis.__cache = {
    key: cacheKey,
    expiresAt: Date.now() + 5 * 60 * 1000,
    payload
  };

  res.status(200).json(payload);
}
