/**
 * The MVP guarantee: one complete regression test, end to end, across the
 * extractor (Claude), the mock webhook and replay engine (Cursor), and the
 * web API the frontend calls.
 */
import { readFileSync } from "node:fs";
import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebServer, listen } from "../web/server.js";
import { runGoldenPath } from "./golden-path.js";

const booking = () => JSON.parse(readFileSync("examples/call-logs/booking-false-confirmation.json", "utf8"));

describe("golden path: booking false confirmation", () => {
  it("passes every step with evidence", async () => {
    const r = await runGoldenPath({ log: booking() });
    expect(r.steps.map((s) => [s.id, s.status])).toEqual([
      ["capture", "pass"],
      ["extract", "pass"],
      ["webhook", "pass"],
      ["reproduce", "pass"],
      ["verify", "pass"],
    ]);
    expect(r.ok).toBe(true);
    for (const s of r.steps) expect(s.checks.every((c) => c.ok), s.id).toBe(true);
  });

  it("serves the exact recorded response over real HTTP", async () => {
    const r = await runGoldenPath({ log: booking() });
    expect(r.webhook).toMatchObject({ method: "POST", path: "/book-appointment", status: 200, body: { success: false, booking_id: null, message: "Slot unavailable" } });
  });

  it("reproduces the bug with the original agent and recognizes the fix", async () => {
    const r = await runGoldenPath({ log: booking() });
    const [base, cand] = r.report!.runs;
    expect(base!.trace.finalMessage).toContain("confirmed");
    expect(base!.overall).toBe("fail");
    expect(cand!.overall).toBe("pass");
    expect(r.report!.comparison!.improved.length).toBeGreaterThan(0);
    expect(r.report!.comparison!.regressed).toEqual([]);
  });

  it("fails honestly when there is nothing to test", async () => {
    const clean = JSON.parse(readFileSync("examples/call-logs/booking-handled-correctly.json", "utf8"));
    const r = await runGoldenPath({ log: clean });
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.id === "extract")!.status).toBe("fail");
    expect(r.steps.filter((s) => s.status === "skipped").map((s) => s.id)).toEqual(["webhook", "reproduce", "verify"]);
  });

  it("fails honestly when the baseline does not reproduce the failure", async () => {
    // A baseline that behaves correctly cannot demonstrate the bug, so the
    // reproduce step must fail and the whole run must fail with it.
    const r = await runGoldenPath({ log: booking(), baseline: "honor" });
    const reproduce = r.steps.find((s) => s.id === "reproduce")!;
    expect(reproduce.status).toBe("fail");
    expect(reproduce.detail).toMatch(/does not catch the original failure/);
    expect(r.ok).toBe(false);
  });

  it("reproduces the failure with every buggy baseline", async () => {
    for (const baseline of ["original", "naive", "skip"] as const) {
      const r = await runGoldenPath({ log: booking(), baseline });
      expect(r.steps.find((s) => s.id === "reproduce")!.status, baseline).toBe("pass");
    }
  });
});

describe("golden path through the web API (what the frontend calls)", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = createWebServer();
    base = await listen(server, 0);
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("POST /api/e2e runs the default golden test", async () => {
    const res = await fetch(`${base}/api/e2e`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = (await res.json()) as { ok: boolean; example: string; steps: Array<{ status: string }> };
    expect(res.status).toBe(200);
    expect(body.example).toBe("booking-false-confirmation");
    expect(body.ok).toBe(true);
    expect(body.steps.every((s) => s.status === "pass")).toBe(true);
  });
});
