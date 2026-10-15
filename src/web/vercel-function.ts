/**
 * Vercel serverless entry for the ReplayKit API. Bundled by
 * scripts/build-vercel.ts into .vercel/output/functions/api.func/index.mjs,
 * next to copies of examples/ and fixtures/.
 *
 * It runs the same request handler as the local server. Vercel serves the
 * frontend from the same origin, so no CORS is needed. The routing rule
 * forwards /api/<path> as /api?__path=<path>; the original path is restored
 * here, so the handler sees the URL the browser requested.
 */
import type http from "node:http";
import { readDeployConfig } from "./deploy.js";
import { createRequestHandler } from "./server.js";

const config = readDeployConfig({
  ...process.env,
  API_ONLY: "1",
  TRUST_PROXY: "1",
  RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE ?? "120",
});
const handle = createRequestHandler(config);

export function restorePath(rawUrl: string): string {
  const url = new URL(rawUrl, "http://internal");
  const forwarded = url.searchParams.get("__path");
  if (forwarded === null) return rawUrl;
  url.searchParams.delete("__path");
  const rest = url.searchParams.toString();
  return `/api/${forwarded.replace(/^\/+/, "")}${rest ? `?${rest}` : ""}`;
}

export default async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  req.url = restorePath(req.url ?? "/");
  await handle(req, res);
}
