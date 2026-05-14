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

  const prices = {};
  const errors = {};

  // ── BATCH REQUEST: single HTTP call for all tickers ──
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${tickers.join(',')}&apikey=${apiKey}`;
    const response = await fetch(url, { cache: 'no-store' });
    const text = await response.text();

    let data;
    try { data = text ? JSON.parse(text) : null; } catch {
      throw new Error('Invalid JSON: ' + (text || '').slice(0, 200));
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }

    // Single symbol → response is the quote object directly
    // Multiple symbols → response is { TICKER: {...}, TICKER2: {...} }
    if (tickers.length === 1) {
      const quote = normalize(data);
      if (quote) {
        prices[tickers[0]] = quote;
      } else {
        errors[tickers[0]] = data?.message || 'Unexpected response format';
      }
    } else {
      for (const ticker of tickers) {
        const entry = data[ticker];
        if (!entry) {
          errors[ticker] = 'No data returned';
          continue;
        }
        if (entry.status === 'error') {
          errors[ticker] = entry.message || 'API error';
          continue;
        }
        const quote = normalize(entry);
        if (quote) {
          prices[ticker] = quote;
        } else {
          errors[ticker] = 'Could not parse quote';
        }
      }
    }
  } catch (err) {
    // If batch fails entirely, return the error
    return res.status(200).json({ prices, errors: { _batch: err.message }, cached: false });
  }

  const payload = { prices, errors, cached: false };
  cache = globalThis.__tdCache = { key: cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, payload };
  return res.status(200).json(payload);
}

function normalize(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.status === 'error') return null;
  const price = Number(data.close ?? data.price ?? data.previous_close ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  const change = Number(data.percent_change ?? data.change_percent ?? 0);
  const prev = Number(data.previous_close ?? 0);
  return { price, change, prev };
}
