# Strategic Fund Allocator — Vercel Proxy Version

This package keeps the same UI design and fixes live pricing by routing quote requests through a Vercel Function instead of calling FMP directly from the browser.

## Files
- `index.html` — the app UI
- `api/prices.js` — Vercel serverless function that fetches prices from FMP

## Deploy on Vercel
1. Create a new folder on your computer and unzip this package into it.
2. Go to Vercel and create/import a new project from this folder or a Git repo containing these files.
3. In **Project Settings → Environment Variables**, add:
   - `FMP_API_KEY` = your Financial Modeling Prep API key
4. Apply that environment variable to **Production**, **Preview**, and **Development**.
5. Redeploy after saving the variable.

## Local test with Vercel CLI
```bash
npm i -g vercel
vercel login
vercel link
vercel dev
```
Then open the local URL shown by Vercel.

## How it works
- The frontend requests `/api/prices?symbols=VTI,NVDA,...`
- The Vercel function reads `process.env.FMP_API_KEY`
- The function calls FMP server-to-server and returns normalized JSON
- The browser only talks to your own Vercel domain, avoiding the direct browser→FMP problem
