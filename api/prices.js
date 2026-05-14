/* ── Per-symbol cache on globalThis (persists across warm invocations) ── */
const CACHE_TTL = 5 * 60 * 1000;          // 5 minutes
let symCache = globalThis.__tdSymCache || {};
globalThis.__tdSymCache = symCache;

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

  const now = Date.now();
  const prices  = {};
  const errors  = {};
  const toFetch = [];

  /* ── 1. Serve from cache where possible ── */
  for (const t of tickers) {
    const c = symCache[t];
    if (c && c.expiresAt > now) {
      prices[t] = c.data;
    } else {
      toFetch.push(t);
    }
  }

  /* ── 2. Fetch uncached symbols in batches of 2 (known to work) ── */
  if (toFetch.length > 0) {
    const BATCH = 2;
    const chunks = [];
    for (let i = 0; i < toFetch.length; i += BATCH) {
      chunks.push(toFetch.slice(i, i + BATCH));
    }

    for (const chunk of chunks) {
      try {
        const symbolParam = chunk.join(',');
        const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolParam)}&apikey=${apiKey}`;
        const resp = await fetch(url, { cache: 'no-store' });

        /* Rate-limited → stop hitting the API, remaining go to errors */
        if (resp.status === 429) {
          chunk.forEach(s => { errors[s] = 'Rate limited — hit ↻ Prices again in ~30s'; });
          break;
        }
        if (!resp.ok) {
          chunk.forEach(s => { errors[s] = `HTTP ${resp.status}`; });
          continue;
        }

        const data = await resp.json();

        if (chunk.length === 1) {
          /* Single symbol → response IS the quote object */
          const parsed = parseQuote(data);
          if (parsed) {
            prices[chunk[0]] = parsed;
            symCache[chunk[0]] = { data: parsed, expiresAt: now + CACHE_TTL };
          } else {
            errors[chunk[0]] = data.message || data.status || 'No price data';
          }
        } else {
          /* Multi-symbol → { "VTI": {...}, "NVDA": {...} } */
          for (const sym of chunk) {
            const d = data[sym];
            if (!d) { errors[sym] = 'Not in API response'; continue; }
            const parsed = parseQuote(d);
            if (parsed) {
              prices[sym] = parsed;
              symCache[sym] = { data: parsed, expiresAt: now + CACHE_TTL };
            } else {
              errors[sym] = d.message || d.status || 'No price data';
            }
          }
        }
      } catch (err) {
        chunk.forEach(s => { errors[s] = err.message; });
      }
    }
    globalThis.__tdSymCache = symCache;
  }

  const cachedCount = tickers.length - toFetch.length;
  return res.status(200).json({
    prices,
    errors,
    cached: toFetch.length === 0,
    debug: {
      requested: tickers.length,
      loaded:    Object.keys(prices).length,
      fromCache: cachedCount,
      fetched:   toFetch.length,
      failed:    Object.keys(errors)
    }
  });
}

function parseQuote(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.status === 'error') return null;
  const price = Number(d.close ?? d.price ?? d.previous_close ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    change: Number(d.percent_change ?? d.change_percent ?? 0),
    prev:   Number(d.previous_close ?? 0)
  };
}
