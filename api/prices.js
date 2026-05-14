const CACHE_TTL = 5 * 60 * 1000;
let symCache = globalThis.__tdSymCache || {};
globalThis.__tdSymCache = symCache;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseQuote(d) {
  if (!d || typeof d !== 'object' || d.status === 'error') return null;
  const price = Number(d.close ?? d.price ?? d.previous_close ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, change: Number(d.percent_change ?? 0), prev: Number(d.previous_close ?? 0) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'TWELVE_DATA_API_KEY not set.' });

  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const tickers = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!tickers.length) return res.status(400).json({ error: 'Provide symbols' });

  const now = Date.now();
  const prices = {};
  const errors = {};
  const toFetch = [];

  for (const t of tickers) {
    const c = symCache[t];
    if (c && c.expiresAt > now) prices[t] = c.data;
    else toFetch.push(t);
  }

  if (toFetch.length > 0) {
    const BATCH = 2;
    const chunks = [];
    for (let i = 0; i < toFetch.length; i += BATCH) chunks.push(toFetch.slice(i, i + BATCH));

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(800);
      const chunk = chunks[i];
      try {
        const url = `https://api.twelvedata.com/quote?symbol=${chunk.join(',')}&apikey=${apiKey}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (resp.status === 429) {
          for (let j = i; j < chunks.length; j++) chunks[j].forEach(s => { errors[s] = 'Rate limited'; });
          break;
        }
        if (!resp.ok) { chunk.forEach(s => { errors[s] = `HTTP ${resp.status}`; }); continue; }
        const data = await resp.json();
        if (chunk.length === 1) {
          const p = parseQuote(data);
          if (p) { prices[chunk[0]] = p; symCache[chunk[0]] = { data: p, expiresAt: now + CACHE_TTL }; }
          else errors[chunk[0]] = data.message || 'No data';
        } else {
          for (const sym of chunk) {
            const d = data[sym];
            if (!d) { errors[sym] = 'Not in response'; continue; }
            const p = parseQuote(d);
            if (p) { prices[sym] = p; symCache[sym] = { data: p, expiresAt: now + CACHE_TTL }; }
            else errors[sym] = d.message || 'No data';
          }
        }
      } catch (err) { chunk.forEach(s => { errors[s] = err.message; }); }
    }
    globalThis.__tdSymCache = symCache;
  }

  return res.status(200).json({
    prices, errors, cached: toFetch.length === 0,
    debug: { requested: tickers.length, loaded: Object.keys(prices).length, fromCache: tickers.length - toFetch.length, fetched: toFetch.length, failed: Object.keys(errors) }
  });
}
