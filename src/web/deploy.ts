/**
 * Deployment settings for running the API as a public service (Railway),
 * with the frontend hosted separately (Vercel). Everything is driven by
 * environment variables, and the defaults reproduce local behavior exactly:
 * bound to 127.0.0.1, frontend served from frontend/dist, no CORS, no rate limit.
 *
 *   HOST                  interface to bind. Railway needs 0.0.0.0. Default 127.0.0.1.
 *   PORT                  port. Railway sets this. Default 4321.
 *   API_ONLY              "1" to serve only /api/* (frontend lives on Vercel).
 *   CORS_ORIGINS          comma-separated allowed browser origins. "*" in a
 *                         hostname matches one label fragment, e.g.
 *                         https://replaykit-*.vercel.app. Empty = no cross-origin access.
 *   RATE_LIMIT_PER_MINUTE requests per client IP per minute on /api/*. 0 = off.
 *   TRUST_PROXY           "1" to take the client IP from X-Forwarded-For (behind
 *                         Railway's proxy). Only enable behind a trusted proxy.
 */
import type http from "node:http";

export interface DeployConfig {
  host: string;
  port: number;
  apiOnly: boolean;
  corsOrigins: string[];
  rateLimitPerMinute: number;
  trustProxy: boolean;
}

const truthy = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";

export function readDeployConfig(env: NodeJS.ProcessEnv = process.env, portOverride?: string): DeployConfig {
  const port = Number.parseInt(portOverride ?? env.PORT ?? "4321", 10);
  const rate = Number.parseInt(env.RATE_LIMIT_PER_MINUTE ?? "0", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid PORT: ${env.PORT}`);
  if (!Number.isInteger(rate) || rate < 0) throw new Error(`invalid RATE_LIMIT_PER_MINUTE: ${env.RATE_LIMIT_PER_MINUTE}`);
  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  for (const o of corsOrigins) {
    if (o === "*") throw new Error('CORS_ORIGINS="*" is not allowed; list the frontend origin(s) explicitly');
    if (!/^https?:\/\/[^/]+$/.test(o)) throw new Error(`CORS_ORIGINS entry must be an origin like https://app.vercel.app, got "${o}"`);
  }
  return {
    host: env.HOST || "127.0.0.1",
    port,
    apiOnly: truthy(env.API_ONLY),
    corsOrigins,
    rateLimitPerMinute: rate,
    trustProxy: truthy(env.TRUST_PROXY),
  };
}

/** Exact match, or "*" standing for one run of [a-z0-9-] inside the hostname. */
export function originAllowed(origin: string | undefined, patterns: string[]): boolean {
  if (!origin) return false;
  return patterns.some((p) => {
    if (!p.includes("*")) return p === origin;
    const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]*")}$`, "i");
    return re.test(origin);
  });
}

/** Apply CORS headers. Returns true if the request was a preflight that has been answered. */
export function handleCors(req: http.IncomingMessage, res: http.ServerResponse, patterns: string[]): boolean {
  const origin = req.headers.origin;
  const allowed = originAllowed(origin, patterns);
  if (allowed) {
    res.setHeader("access-control-allow-origin", origin!);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-max-age", "600");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(allowed ? 204 : 403, allowed ? {} : { "content-type": "application/json; charset=utf-8" });
    res.end(allowed ? undefined : JSON.stringify({ error: "origin not allowed" }));
    return true;
  }
  return false;
}

export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Fixed one-minute window per key. In memory: fine for a single demo instance. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns seconds to wait, or 0 if the request is allowed. */
  take(key: string): number {
    if (this.perMinute <= 0) return 0;
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) {
      this.windows.set(key, { start: t, count: 1 });
      if (this.windows.size > 10_000) this.prune(t);
      return 0;
    }
    if (w.count >= this.perMinute) return Math.ceil((w.start + 60_000 - t) / 1000);
    w.count++;
    return 0;
  }

  private prune(t: number): void {
    for (const [k, w] of this.windows) if (t - w.start >= 60_000) this.windows.delete(k);
  }
}
