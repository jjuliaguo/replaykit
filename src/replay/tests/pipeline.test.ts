import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixtureFile } from "../load.js";
import { runReplaySuite, writeReports } from "../pipeline.js";
import { liveRunBlockReason } from "../agent/openai-runner.js";

describe("pipeline", () => {
  it("compares original vs honor on the shared booking fixture and writes reports from real runs", async () => {
    const fixture = loadFixtureFile("fixtures/booking-unavailable.json");
    const report = await runReplaySuite(fixture, [{ type: "original" }, { type: "policy", policy: "honor" }]);
    expect(report.mode).toBe("offline");
    expect(report.runs).toHaveLength(2);
    expect(report.runs[0]?.overall).toBe("fail");
    expect(report.runs[1]?.overall).toBe("pass");
    expect(report.comparison?.improved.length).toBeGreaterThan(0);
    expect(report.recordedInteractions[0]?.body).toEqual({
      success: false,
      booking_id: null,
      message: "Slot unavailable",
    });

    const dir = mkdtempSync(join(tmpdir(), "replaykit-"));
    const { jsonPath, htmlPath } = writeReports(report, dir, "booking");
    const json = JSON.parse(readFileSync(jsonPath, "utf8"));
    const html = readFileSync(htmlPath, "utf8");
    expect(json.runs[1].overall).toBe("pass");
    expect(html).toContain("Slot unavailable");
    expect(html).toContain("false_success_claim");
    expect(html).toContain("policy:honor");
  });

  it("handles a non-booking payment fixture the same way", async () => {
    const fixture = loadFixtureFile("fixtures/payment-declined.json");
    const report = await runReplaySuite(fixture, [{ type: "original" }, { type: "policy", policy: "honor" }]);
    expect(report.runs[0]?.overall).toBe("fail");
    expect(report.runs[1]?.overall).toBe("pass");
    expect(report.runs[1]?.trace.finalMessage).toMatch(/Card declined/);
  });

  it("flags unverified success when the workflow required a tool that was never called", async () => {
    const fixture = loadFixtureFile("fixtures/unverified-cancel.json");
    const report = await runReplaySuite(fixture, [{ type: "original" }, { type: "policy", policy: "honor" }]);
    expect(report.runs[0]?.expectationResults.find((r) => r.kind === "tool_called")?.outcome).toBe("fail");
    expect(report.runs[1]?.expectationResults.find((r) => r.kind === "tool_called")?.outcome).toBe("pass");
    expect(report.runs[1]?.overall).toBe("pass");
  });

  it("refuses live OpenAI calls without an explicit flag and key", () => {
    expect(liveRunBlockReason(false, "sk-test")).toMatch(/--live/);
    expect(liveRunBlockReason(true, undefined)).toMatch(/OPENAI_API_KEY/);
    expect(liveRunBlockReason(true, "sk-test")).toMatch(/approval/);
  });
});
