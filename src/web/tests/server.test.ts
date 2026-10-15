import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebServer, listen } from "../server.js";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = createWebServer();
  base = await listen(server, 0);
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async (p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
};
// Test-only: response bodies are asserted field by field, so a loose type is fine here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const post = async (p: string, body: unknown): Promise<{ status: number; body: Json }> => {
  const res = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
};

describe("static frontend (built SPA)", () => {
  let spa: http.Server;
  let spaBase: string;
  let unbuilt: http.Server;
  let unbuiltBase: string;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "replaykit-spa-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>spa</title>");
    writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log(1)");
    spa = createWebServer({ staticDir: dir });
    spaBase = await listen(spa, 0);
    unbuilt = createWebServer({ staticDir: path.join(dir, "missing") });
    unbuiltBase = await listen(unbuilt, 0);
  });
  afterAll(async () => {
    await new Promise<void>((r) => spa.close(() => r()));
    await new Promise<void>((r) => unbuilt.close(() => r()));
  });

  it("serves index.html and hashed assets with the right types", async () => {
    const index = await fetch(spaBase + "/");
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("<title>spa</title>");
    const js = await fetch(spaBase + "/assets/app-abc.js");
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
  });

  it("falls back to index.html for client routes, but 404s missing assets", async () => {
    expect(await (await fetch(spaBase + "/calls/anything")).text()).toContain("<title>spa</title>");
    expect((await fetch(spaBase + "/assets/missing.js")).status).toBe(404);
  });

  it("never serves files outside the build directory", async () => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/assets/..%2F..%2Fpackage.json"]) {
      const res = await fetch(spaBase + p);
      expect(await res.text()).not.toContain('"name": "replaykit"');
    }
  });

  it("explains how to build when the frontend is missing", async () => {
    const res = await fetch(unbuiltBase + "/");
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/npm run build:web/);
  });
});

describe("calls endpoint", () => {
  it("runs the extractor over every example call", async () => {
    const calls = (await get("/api/calls")).body as Array<{ name: string; findings: Array<{ type: string }>; fixtureId: string | null; error: string | null }>;
    const booking = calls.find((c) => c.name === "booking-false-confirmation")!;
    expect(booking.findings.map((f) => f.type)).toEqual(["false_success_claim"]);
    expect(booking.fixtureId).toBe("synthetic-booking-false-confirmation");
    expect(calls.find((c) => c.name === "booking-handled-correctly")!.findings).toEqual([]);
    expect(calls.every((c) => c.error === null)).toBe(true);
  });

  it("returns the extractor's verdict for every tool result, including on clean calls", async () => {
    const r = await post("/api/extract", { example: "booking-handled-correctly" });
    expect(r.body.findings).toEqual([]);
    expect(r.body.outcomes["2"]).toMatchObject({ outcome: "failure", signals: [{ path: "response.body.success", value: "false" }] });
  });
});

describe("listing endpoints", () => {
  it("reports offline health", async () => {
    expect((await get("/api/health")).body).toMatchObject({ ok: true, mode: "offline" });
  });

  it("lists examples, fixtures, and offline agents only", async () => {
    const examples = (await get("/api/examples")).body as Array<{ name: string }>;
    expect(examples.map((e) => e.name)).toContain("booking-false-confirmation");
    const fixtures = (await get("/api/fixtures")).body as Array<{ ref: string; valid: boolean; origin: string }>;
    expect(fixtures.find((f) => f.ref === "generated/synthetic-booking-false-confirmation.json")).toMatchObject({ valid: true, origin: "extractor" });
    expect(fixtures.find((f) => f.ref === "booking-unavailable.json")).toMatchObject({ valid: true });
    expect(fixtures.every((f) => f.valid)).toBe(true);
    const agents = (await get("/api/agents")).body as Array<{ id: string }>;
    expect(agents.map((a) => a.id).sort()).toEqual(["honor", "naive", "original", "skip"]);
  });

  it("only serves files from its own lists (no path traversal)", async () => {
    expect((await get("/api/fixture?ref=../package.json")).status).toBe(404);
    expect((await get("/api/example?name=..%2F..%2Fpackage")).status).toBe(404);
    expect((await get("/api/fixture?ref=booking-unavailable.json")).status).toBe(200);
  });
});

describe("extract then replay, end to end", () => {
  it("detects the false confirmation and the fixed stand-in passes the generated test", async () => {
    const ex = await post("/api/extract", { example: "booking-false-confirmation" });
    expect(ex.status).toBe(200);
    expect(ex.body.findings.map((f: { type: string }) => f.type)).toEqual(["false_success_claim"]);
    expect(ex.body.fixture.source.kind).toBe("synthetic");

    const rp = await post("/api/replay", { fixture: ex.body.fixture, agents: ["original", "honor"] });
    expect(rp.status).toBe(200);
    const [original, honor] = rp.body.report.runs;
    expect(original.trace.agentId).toBe("original");
    expect(original.overall).toBe("fail");
    expect(honor.overall).toBe("pass");
    // The recorded response reached the agent unchanged.
    expect(honor.trace.toolCalls[0].result.body).toEqual({ success: false, booking_id: null, message: "Slot unavailable" });
    expect(rp.body.report.comparison.regressed).toEqual([]);
    expect(rp.body.html).toContain("<!DOCTYPE html>");
  });

  it("returns no fixture for a log where the agent behaved correctly", async () => {
    const r = await post("/api/extract", { example: "booking-handled-correctly" });
    expect(r.body.findings).toEqual([]);
    expect(r.body.fixture).toBeNull();
  });

  it("replays a saved fixture by reference", async () => {
    const r = await post("/api/replay", { fixtureRef: "synthetic-payment-declined.json", agents: ["naive", "honor"] });
    expect(r.status).toBe(200);
    expect(r.body.report.runs.map((x: { overall: string }) => x.overall)).toEqual(["fail", "pass"]);
  });
});

describe("errors", () => {
  it("rejects bad input with a clear message", async () => {
    expect((await post("/api/extract", "{oops")).status).toBe(400);
    expect((await post("/api/extract", {})).status).toBe(400);
    expect((await post("/api/extract", { log: { foo: 1 } })).body.error).toMatch(/Couldn.t find a conversation/);
    expect((await post("/api/replay", { fixture: { nope: true } })).status).toBe(422);
    const live = await post("/api/replay", { fixtureRef: "booking-unavailable.json", agents: ["live"] });
    expect(live.status).toBe(400);
    expect(live.body.error).toMatch(/Live model runs are not available/);
  });

  it("returns 404 for unknown routes", async () => {
    expect((await get("/api/nope")).status).toBe(404);
  });
});
