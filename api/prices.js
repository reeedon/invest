let cache = globalThis.__cache || { key: '', expiresAt: 0, payload: null };
globalThis.__cache = cache;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const tdKey = process.env.TWELVE_DATA_API_KEY;
  const fhKey = process.env.FINNHUB_API_KEY;

  if (!tdKey) {
    return res.status(500).json({ error: "Missing TWELVE_DATA_API_KEY" });
  }

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
    const t = await r.text();
    return JSON.parse(t);
  }

  // ✅ Twelve Data
  async function fetchTwelve(t) {
    try {
      const data = await fetchJSON(
        `https://api.twelvedata.com/quote?symbol=${t}&apikey=${tdKey}`
      );

      if (data.status === "error") return null;

      const price = Number(data.close);
      if (!price || price <= 0) return null;

      return {
        price,
        change: Number(data.percent_change || 0),
        prev: Number(data.previous_close || 0)
      };
    } catch {
      return null;
    }
  }

  // ✅ Finnhub fallback
  async function fetchFinnhub(t) {
    if (!fhKey) return null;

    try {
      const data = await fetchJSON(
        `https://finnhub.io/api/v1/quote?symbol=${t}&token=${fhKey}`
      );

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

  for (const t of tickers) {
    let q = await fetchTwelve(t);

    // fallback
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
``
