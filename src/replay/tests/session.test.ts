import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFixture } from "../../shared/types.js";
import { ReplaySession } from "../session.js";

const booking = () => parseFixture(JSON.parse(readFileSync("fixtures/booking-unavailable.json", "utf8")));
const payment = () => parseFixture(JSON.parse(readFileSync("fixtures/synthetic-payment-declined.json", "utf8")));

describe("ReplaySession", () => {
  it("returns the recorded HTTP 200 body byte-for-byte, including application-level failure", () => {
    const fixture = booking();
    const session = new ReplaySession(fixture);
    const recorded = fixture.replay.interactions[0]!.response!.body;
    const result = session.invoke("book_appointment", { date: "2026-10-16", time: "15:00", name: "Jordan" });
    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.status).toBe(200);
    expect(result.body).toEqual(recorded);
    expect(JSON.stringify(result.body)).toBe(JSON.stringify(recorded));
  });

  it("matches the first unused sequence interaction per tool", () => {
    const fixture = booking();
    const session = new ReplaySession(fixture);
    const first = session.invoke("book_appointment", { date: "x" });
    const second = session.invoke("book_appointment", { date: "y" });
    expect(first.matched).toBe(true);
    expect(second.matched).toBe(false);
    expect(second.kind).toBe("unmatched");
  });

  it("matches argument keys without requiring unused fields to be equal", () => {
    const fixture = payment();
    const session = new ReplaySession(fixture);
    const hit = session.invoke("capture_payment", { invoice_id: "4412", amount_cents: 1 });
    expect(hit.matched).toBe(true);
    const miss = session.invoke("capture_payment", { invoice_id: "9999" });
    expect(miss.matched).toBe(false);
  });

  it("aborts the run when onUnmatchedCall is fail_run", () => {
    const fixture = booking();
    fixture.replay.onUnmatchedCall = "fail_run";
    const session = new ReplaySession(fixture);
    session.invoke("book_appointment", {});
    const second = session.invoke("other_tool", {});
    expect(second.kind).toBe("fail_run");
    expect(session.aborted).toBe(true);
  });

  it("never invents a recorded body for unmatched calls", () => {
    const fixture = booking();
    const session = new ReplaySession(fixture);
    session.invoke("book_appointment", {});
    const result = session.invoke("book_appointment", {});
    expect(result.kind).toBe("unmatched");
    if (result.kind !== "unmatched") return;
    expect(result.body).toMatchObject({ replaykit: true, unmatched: true });
  });
});
