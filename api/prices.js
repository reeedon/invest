export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing FMP_API_KEY environment variable in Vercel.' });
  }

  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const tickers = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!tickers.length) {
    return res.status(400).json({ error: 'Provide symbols query param, e.g. /api/prices?symbols=VTI,NVDA' });
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

  function normalize(q) {
    if (!q) return null;
    const price = Number(q.price ?? q.last ?? q.close);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      price,
      change: Number(q.changesPercentage ?? q.changePercentage ?? q.change ?? 0),
      prev: Number(q.previousClose ?? q.previous_close ?? 0)
    };
  }

  async function fetchTicker(ticker) {
    const attempts = [
      `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`,
      `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(ticker)}?apikey=${apiKey}`,
      `https://financialmodelingprep.com/api/v3/quote-short/${encodeURIComponent(ticker)}?apikey=${apiKey}`
    ];

    let lastError = 'Unknown error';
    for (const url of attempts) {
      try {
        const data = await fetchJson(url);
        if (Array.isArray(data) && data.length > 0) {
          const quote = normalize(data[0]);
          if (quote) return quote;
        }
        lastError = 'Unexpected response format';
      } catch (err) {
        lastError = err.message;
      }
    }
    throw new Error(lastError);
  }

  const prices = {};
  const errors = {};

  const results = await Promise.allSettled(tickers.map(async (ticker) => ({ ticker, quote: await fetchTicker(ticker) })));
  for (const result of results) {
    if (result.status === 'fulfilled') {
      prices[result.value.ticker] = result.value.quote;
    } else {
      // We don't have ticker on reject payload, so map from original index below if needed.
    }
  }

  // Fill errors by retrying index mapping
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      errors[tickers[i]] = result.reason?.message || 'Failed to load price';
    }
  });

  return res.status(200).json({ prices, errors });
}
