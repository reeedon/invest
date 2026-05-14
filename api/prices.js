let cache = globalThis.__tdCache || { key: '', expiresAt: 0, payload: null };
globalThis.__tdCache = cache;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TWELVE_DATA_API_KEY not set in Vercel env vars.' });
  }

  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const tickers = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!tickers.length) {
    return res.status(400).json({ error: 'Provide symbols, e.g. ?symbols=VTI,NVDA' });
  }

  /* ── Cache check (5 min) ── */
  const cacheKey = tickers.join(',');
  const now = Date.now();
  if (cache.payload && cache.key === cacheKey && cache.expiresAt > now) {
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  /* ── BATCH: single HTTP call for ALL symbols ── */
  const symbolParam = tickers.join(',');
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolParam)}&apikey=${apiKey}`;

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      const txt = await response.text();
      return res.status(502).json({ error: `Twelve Data HTTP ${response.status}: ${txt.slice(0, 300)}` });
    }
    const data = await response.json();

    const prices = {};
    const errors = {};

    if (tickers.length === 1) {
      /* Single symbol → response IS the quote object directly */
      const sym = tickers[0];
      const parsed = parseQuote(data);
      if (parsed) prices[sym] = parsed;
      else errors[sym] = data.message || data.status || 'No price data';
    } else {
      /* Multiple symbols → response is { "VTI": {...}, "NVDA": {...}, ... } */
      for (const sym of tickers) {
        const d = data[sym];
        if (!d) { errors[sym] = 'Not in response'; continue; }
        const parsed = parseQuote(d);
        if (parsed) prices[sym] = parsed;
        else errors[sym] = d.message || d.status || 'No price data';
      }
    }

    const payload = { prices, errors, cached: false, debug: { requested: tickers.length, loaded: Object.keys(prices).length, failed: Object.keys(errors) } };
    cache = globalThis.__tdCache = { key: cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, payload };
    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({ error: `Fetch failed: ${err.message}` });
  }
}

function parseQuote(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.status === 'error') return null;
  const price = Number(d.close ?? d.price ?? d.previous_close ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    change: Number(d.percent_change ?? d.change_percent ?? 0),
    prev: Number(d.previous_close ?? 0)
  };
}
