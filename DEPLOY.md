# Deploying the ReplayKit demo

## Live now: Vercel only

**https://replaykit.vercel.app**: the frontend and API run on one Vercel project (`replaykit`). It was deployed from the `deploy-setup` branch with the Vercel CLI and is not connected to Git, so pushes don't redeploy it.

- `npm run build:vercel` writes `.vercel/output`, using the Build Output API. It contains the static UI, one Node 22 function that bundles the same request handler as the local server (`src/web/vercel-function.ts`) with copies of `examples/` and `fixtures/`, and the routes. Because the UI and API share one origin, no CORS is needed.
- Redeploy from `replaykit-integrated` on this branch:

```bash
npx vercel@64.2.0 deploy --prod --scope <your-vercel-scope>
```

- Railway was the original plan for the API. The account's Railway trial has expired, so the API runs on Vercel instead. The Railway setup below still works once a Railway plan is active.


### Reading any log format (optional LLM fallback)

The built-in readers handle common formats for free. For anything they can't read, ReplayKit can ask an LLM to read the log. It does this only as a fallback: a paste the built-in readers handle never reaches the model. Every value the model returns is checked against the original log, and anything not found there is dropped.

To turn it on, add these in Vercel under **Project replaykit > Settings > Environment Variables**, for Production:

| Name | Value |
| --- | --- |
| `OPENAI_API_KEY` | your OpenAI key |
| `REPLAYKIT_LLM_MAPPING` | `1` |
| `OPENAI_MODEL` | optional. Defaults to `gpt-4.1-mini`, with one retry on `gpt-4o-mini` if that id is unavailable. |

Then redeploy, because environment variables apply only to new deployments. Each fallback is one paid API call. To turn it off, remove `REPLAYKIT_LLM_MAPPING`.

---

## Alternative: API on Railway, frontend on Vercel

Branch: `deploy-setup`. It is short-lived: test the deployment from this branch, then merge it into `main` if it works.

```
browser ──> Vercel (static frontend) ──HTTPS + CORS──> Railway (API: extractor + replay engine)
```

The frontend and API are deployed separately. The frontend is built with the API's URL baked in (`VITE_API_BASE`), and the API only accepts browser requests from the frontend's origin (`CORS_ORIGINS`). Because each side needs the other's URL, deploy Railway first, then Vercel, then go back and finish the Railway setting.

## What is on this branch

| File | Purpose |
| --- | --- |
| `Dockerfile`, `.dockerignore` | Railway image: Node 22, runs `src/web/server.ts` with tsx, API only |
| `railway.json` | Railway build and deploy settings: Dockerfile builder, health check on `/api/health`, restart on failure |
| `vercel.json` | Vercel build: `npm run build:web`, output `frontend/dist`, security and cache headers |
| `src/web/deploy.ts` | Environment-driven settings: bind host, API-only mode, CORS allowlist, per-IP rate limit, proxy-aware client IP |
| `src/web/tests/deploy.test.ts` | Tests for all of the above, including a cross-origin end-to-end run |
| `frontend/src/api.ts`, `frontend/vite.config.ts` | Optional `VITE_API_BASE`. The build fails on a malformed URL, or on `http://` on Vercel |

With no environment variables set, everything behaves exactly as it does locally.

## 1. Railway (API)

1. In Railway, create a **New Project**, choose **Deploy from GitHub repo**, and pick `jjuliaguo/replaykit`.
2. In the service's **Settings > Source**, set the branch to `deploy-setup`. Railway reads `railway.json` and builds the `Dockerfile`.
3. Under **Settings > Networking**, select **Generate Domain**. Railway provides `PORT`, and the server listens on it. Copy the URL, for example `https://replaykit-api-production.up.railway.app`.
4. Leave the variables for now. The Dockerfile already sets `HOST=0.0.0.0`, `API_ONLY=1`, `TRUST_PROXY=1`, and `RATE_LIMIT_PER_MINUTE=120`. You'll add `CORS_ORIGINS` in step 3.
5. Check it:

```bash
curl https://YOUR-RAILWAY-URL/api/health
```

Expected response: `{"ok":true,...}`.

## 2. Vercel (frontend)

1. In Vercel, select **Add New > Project** and import `jjuliaguo/replaykit`. Keep the **Root Directory** as the repo root. `vercel.json` sets the build.
2. Under **Environment Variables**, add `VITE_API_BASE` set to the Railway URL from step 1, with `https://` and no trailing slash. Enable it for **Preview** at least, since `deploy-setup` deploys as a preview.
3. Deploy. Pushes to `deploy-setup` create preview deployments, and Vercel gives the branch a stable alias like `https://replaykit-git-deploy-setup-<your-scope>.vercel.app`. Copy that URL.

## 3. Connect them

In Railway, add this variable to the service and redeploy:

```
CORS_ORIGINS=https://replaykit-git-deploy-setup-<your-scope>.vercel.app
```

Several origins are comma-separated. To also allow Vercel's per-commit preview URLs, add a pattern. `*` matches letters, digits, and hyphens inside the hostname only:

```
CORS_ORIGINS=https://replaykit-git-deploy-setup-<your-scope>.vercel.app,https://replaykit-*-<your-scope>.vercel.app
```

`CORS_ORIGINS=*` is refused on purpose.

## 4. Test

Open the Vercel URL. The Overview page runs the end-to-end test on load and should show **End-to-end pass, 5/5 steps**.
If it fails:

| Symptom | Likely cause |
| --- | --- |
| "Cannot reach the ReplayKit API at …" | Railway is asleep or crashed, so check its logs. Or `CORS_ORIGINS` doesn't include the exact Vercel origin, which you can see in the browser console as a CORS error. |
| Vercel build error mentioning `VITE_API_BASE` | The value isn't an `https://` URL. |
| Railway health check fails | Check the deploy logs. The server prints its settings on start: `apiOnly=true cors=… rateLimit=120/min`. |
| "Too many requests" | You hit the per-IP limit of 120 requests a minute. Raise `RATE_LIMIT_PER_MINUTE` if needed. |

## Verified locally before pushing

The production split was simulated on one machine:

- The API ran with the exact Docker command and Railway environment.
- The frontend was built with `VITE_API_BASE` and served from a different origin.
- In the browser, the CORS preflight returned 204 and `/api/e2e` returned 200. The Overview showed End-to-end pass, 5/5.
- A disallowed origin's preflight returned 403.
- A malformed `VITE_API_BASE` failed the build.

Not verified: the Docker image itself, since Docker isn't installed here, and a real Vercel or Railway deploy.

## Public-demo notes

- **No secrets in the code.** If the LLM fallback is on, the OpenAI key lives only in Vercel's environment variables.
- **Endpoints visitors can call.** Anyone can call the API's read endpoints, plus `extract`, `replay`, and `e2e`. Request bodies are capped at 2 MB, and calls are rate-limited per IP. The limiter is in memory, so it is per instance and resets on redeploy.
- **Imports stay in the browser.** Pasted call logs are analyzed by the API and stored only in the visitor's tab.
- **Recommended Railway setting.** Use one instance. Scaling out would give each instance its own rate-limit counters.
