import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { originAllowed, RateLimiter, readDeployConfig } from "../deploy.js";
import { createWebServer, listen, type WebServerOptions } from "../server.js";

describe("readDeployConfig", () => {
  it("defaults to local behavior", () => {
    expect(readDeployConfig({})).toEqual({ host: "127.0.0.1", port: 4321, apiOnly: false, corsOrigins: [], rateLimitPerMinute: 0, trustProxy: false });
  });

  it("reads Railway-style settings", () => {
    const c = readDeployConfig({ HOST: "0.0.0.0", PORT: "8080", API_ONLY: "1", CORS_ORIGINS: "https://a.vercel.app/, https://replaykit-*.vercel.app", RATE_LIMIT_PER_MINUTE: "60", TRUST_PROXY: "true" });
    expect(c).toEqual({ host: "0.0.0.0", port: 8080, apiOnly: true, corsOrigins: ["https://a.vercel.app", "https://replaykit-*.vercel.app"], rateLimitPerMinute: 60, trustProxy: true });
  });

  it("rejects unsafe or malformed values", () => {
    expect(() => readDeployConfig({ CORS_ORIGINS: "*" })).toThrow(/not allowed/);
    expect(() => readDeployConfig({ CORS_ORIGINS: "replaykit.vercel.app" })).toThrow(/must be an origin/);
    expect(() => readDeployConfig({ CORS_ORIGINS: "https://a.vercel.app/path" })).toThrow(/must be an origin/);
    expect(() => readDeployConfig({ PORT: "abc" })).toThrow(/invalid PORT/);
    expect(() => readDeployConfig({ RATE_LIMIT_PER_MINUTE: "-1" })).toThrow(/RATE_LIMIT/);
  });
});

describe("originAllowed", () => {
  const patterns = ["https://replaykit.vercel.app", "https://replaykit-*-jjuliaguo.vercel.app"];
  it.each([
    ["https://replaykit.vercel.app", true],
    ["https://replaykit-git-deploy-setup-jjuliaguo.vercel.app", true],
    ["https://replaykit.vercel.app.evil.com", false],
    ["https://evil.com", false],
    ["https://replaykit-x.evil.com/-jjuliaguo.vercel.app", false],
    ["http://replaykit.vercel.app", false],
    [undefined, false],
  ])("%s -> %s", (origin, ok) => {
    expect(originAllowed(origin, patterns)).toBe(ok);
  });
});

describe("RateLimiter", () => {
  it("allows N per minute per key, then reports the wait", () => {
    let t = 0;
    const rl = new RateLimiter(2, () => t);
    expect(rl.take("a")).toBe(0);
    expect(rl.take("a")).toBe(0);
    expect(rl.take("a")).toBe(60);
    expect(rl.take("b")).toBe(0);
    t = 30_000;
    expect(rl.take("a")).toBe(30);
    t = 60_000;
    expect(rl.take("a")).toBe(0);
  });

  it("is off at 0", () => {
    const rl = new RateLimiter(0);
    for (let i = 0; i < 100; i++) expect(rl.take("a")).toBe(0);
  });
});

describe("server in deployment mode", () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
  const start = async (opts: WebServerOptions) => {
    server = createWebServer(opts);
    return listen(server, 0);
  };
  const VERCEL = "https://replaykit.vercel.app";

  it("answers CORS preflight and tags responses for allowed origins only", async () => {
    const base = await start({ apiOnly: true, corsOrigins: [VERCEL] });
    const pre = await fetch(`${base}/api/e2e`, { method: "OPTIONS", headers: { origin: VERCEL, "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(VERCEL);
    expect(pre.headers.get("access-control-allow-headers")).toContain("content-type");

    const ok = await fetch(`${base}/api/health`, { headers: { origin: VERCEL } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(VERCEL);
    expect(ok.headers.get("vary")).toBe("Origin");

    const evilPre = await fetch(`${base}/api/e2e`, { method: "OPTIONS", headers: { origin: "https://evil.com" } });
    expect(evilPre.status).toBe(403);
    const evil = await fetch(`${base}/api/health`, { headers: { origin: "https://evil.com" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves only the API in API-only mode", async () => {
    const base = await start({ apiOnly: true });
    expect(await (await fetch(`${base}/`)).json()).toMatchObject({ service: "replaykit-api" });
    expect((await fetch(`${base}/calls`)).status).toBe(404);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("rate-limits /api/* per client but never the health check", async () => {
    const base = await start({ rateLimitPerMinute: 2, trustProxy: true });
    const call = (ip: string) => fetch(`${base}/api/agents`, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
    expect((await call("1.1.1.1")).status).toBe(200);
    expect((await call("1.1.1.1")).status).toBe(200);
    const limited = await call("1.1.1.1");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call("2.2.2.2")).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("runs the golden path cross-origin, as the Vercel frontend will", async () => {
    const base = await start({ apiOnly: true, corsOrigins: [VERCEL], rateLimitPerMinute: 120 });
    const res = await fetch(`${base}/api/e2e`, { method: "POST", headers: { origin: VERCEL, "content-type": "application/json" }, body: "{}" });
    expect(res.headers.get("access-control-allow-origin")).toBe(VERCEL);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
