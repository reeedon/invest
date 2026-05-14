# Strategic Fund Allocator — Vercel + Twelve Data Version

This package keeps the same UI design and switches live pricing from FMP to Twelve Data.

## Why this version
- Twelve Data's official free Basic plan includes 800 API credits/day.
- The official quote endpoint costs 1 credit per symbol.
- Auto-refresh is disabled to preserve free-tier credits.
- The Vercel function caches responses for 5 minutes.

## Files
- `index.html` — the app UI
- `api/prices.js` — Vercel serverless function using Twelve Data

## Environment Variable
Set this in Vercel Project Settings → Environment Variables:
- `TWELVE_DATA_API_KEY` = your Twelve Data API key

Apply it to Production, Preview, and Development.
Then redeploy.

## Deploy on Vercel
1. Unzip this package.
2. Create/import a Vercel project from this folder or a Git repo containing these files.
3. Add `TWELVE_DATA_API_KEY` in Vercel.
4. Redeploy.

## Local testing with Vercel CLI
```bash
npm i -g vercel
vercel login
vercel link
vercel dev
```

## Notes
- Frontend requests: `/api/prices?symbols=VTI,NVDA,...`
- The Vercel function calls Twelve Data server-to-server.
- Browser never calls Twelve Data directly.
- Cache TTL: 5 minutes.
