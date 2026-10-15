import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixtureValidationError, parseFixture } from "../types.js";

const sample = () => JSON.parse(readFileSync("fixtures/booking-unavailable.json", "utf8"));

describe("ReplayFixtureSchema", () => {
  it("accepts the sample fixture and applies defaults", () => {
    const f = parseFixture(sample());
    expect(f.source.kind).toBe("synthetic");
    expect(f.replay.interactions[0]?.response?.body).toEqual({ success: false, booking_id: null, message: "Slot unavailable" });
    const tc = f.expectations.find((e) => e.kind === "tool_called");
    expect(tc && tc.kind === "tool_called" && tc.minCalls).toBe(1);
  });
  it("rejects evidence pointing outside original.events", () => {
    const d = sample(); d.failures[0].evidence[0].eventIndex = 99;
    expect(() => parseFixture(d)).toThrow(/evidence points at event 99/);
  });
  it("rejects interactions with neither response nor error", () => {
    const d = sample(); delete d.replay.interactions[0].response;
    expect(() => parseFixture(d)).toThrow(FixtureValidationError);
  });
  it("rejects duplicate expectation ids", () => {
    const d = sample(); d.expectations[1].id = d.expectations[0].id;
    expect(() => parseFixture(d)).toThrow(/duplicate expectation id/);
  });
  it("requires at least one failure and one expectation", () => {
    const d = sample(); d.failures = [];
    expect(() => parseFixture(d)).toThrow(/failures/);
  });
});
