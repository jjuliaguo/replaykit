import { describe, expect, it } from "vitest";
import { detectFailures } from "../detectors/index.js";
import { assistant, call, log, result, user } from "./helpers.js";

const failed = { success: false, booking_id: null, message: "Slot unavailable" };

describe("false_success_claim", () => {
  it("fires with high confidence when the claim names the tool's topic", () => {
    const f = detectFailures(
      log([user("Book me Friday"), call("c1", "book_appointment"), result("c1", failed), assistant("Your appointment is confirmed!")]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: "false_success_claim", toolName: "book_appointment", confidence: "high", callId: "c1" });
    expect(f[0]?.evidence.map((e) => e.eventIndex)).toEqual([2, 3]);
    expect(f[0]?.claimPhrases).toEqual(["is confirmed"]);
    expect(f[0]?.failureSignals).toEqual(["Slot unavailable"]);
  });

  it("drops to medium when the reply also acknowledges a problem", () => {
    const f = detectFailures(
      log([call("c1", "book_appointment"), result("c1", failed), assistant("Sorry, 3 PM was unavailable. Your appointment is booked for 4 PM.")]),
    );
    expect(f[0]?.confidence).toBe("medium");
  });

  it("does not fire when the agent tells the truth", () => {
    expect(detectFailures(log([call("c1", "book_appointment"), result("c1", failed), assistant("Sorry, that slot is unavailable.")]))).toEqual([]);
  });

  it("does not fire when the tool succeeded", () => {
    expect(
      detectFailures(log([call("c1", "book_appointment"), result("c1", { success: true, booking_id: "B1" }), assistant("Your appointment is confirmed.")])),
    ).toEqual([]);
  });

  it("does not fire on an unknown outcome (no recognizable result field)", () => {
    expect(detectFailures(log([call("c1", "book_appointment"), result("c1", { slot: "15:00" }), assistant("You're all set!")]))).toEqual([]);
  });

  it("does not blame a failed tool for a claim about a different tool that succeeded", () => {
    const f = detectFailures(
      log([
        call("c1", "send_sms"),
        result("c1", { ok: false, error: "carrier rejected" }),
        call("c2", "create_ticket"),
        result("c2", { ok: true, id: "T-1" }),
        assistant("You're all set!"),
      ]),
    );
    expect(f.filter((x) => x.type === "false_success_claim")).toEqual([]);
  });

  it("does not fire when a retry of the same tool happens before the reply", () => {
    const f = detectFailures(
      log([
        call("c1", "book_appointment"),
        result("c1", failed),
        call("c2", "book_appointment"),
        result("c2", { success: true, booking_id: "B2" }),
        assistant("Your appointment is booked for 4 PM."),
      ]),
    );
    expect(f).toEqual([]);
  });
});

describe("unverified_success_claim", () => {
  const events = [user("Refund order 5"), assistant("I've issued your refund.")];

  it("fires only when the workflow requires the tool", () => {
    expect(detectFailures(log(events))).toEqual([]);
    const f = detectFailures(log(events, { workflow: { requiredTools: ["issue_refund"] } }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: "unverified_success_claim", toolName: "issue_refund", confidence: "high" });
  });

  it("does not fire when the required tool was called", () => {
    const f = detectFailures(
      log([call("c1", "issue_refund"), result("c1", { success: true }), assistant("I've issued your refund.")], {
        workflow: { requiredTools: ["issue_refund"] },
      }),
    );
    expect(f).toEqual([]);
  });

  it("does not attribute an unrelated claim when several tools are required", () => {
    const f = detectFailures(log([assistant("You're all set!")], { workflow: { requiredTools: ["issue_refund", "send_email"] } }));
    expect(f).toEqual([]);
  });
});

describe("unhandled_tool_error", () => {
  it("fires when a timeout is followed by a reply that ignores it", () => {
    const f = detectFailures(
      log([
        call("c1", "get_status"),
        { type: "tool_result", callId: "c1", error: { kind: "timeout", message: "timed out" } },
        assistant("It should arrive soon."),
      ]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: "unhandled_tool_error", confidence: "medium" });
  });

  it("does not fire when the agent mentions the problem or retries", () => {
    const timeout = { type: "tool_result" as const, callId: "c1", error: { kind: "timeout" as const, message: "t" } };
    expect(detectFailures(log([call("c1", "get_status"), timeout, assistant("Sorry, I'm having trouble reaching the system.")]))).toEqual([]);
    expect(
      detectFailures(log([call("c1", "get_status"), timeout, call("c2", "get_status"), result("c2", { status: "ok" }), assistant("It ships today.")])),
    ).toEqual([]);
  });

  it("does not fire when the call ends without a reply", () => {
    expect(detectFailures(log([call("c1", "x"), result("c1", { ok: false })]))).toEqual([]);
  });
});

describe("fabricated reference (tool_result_misread)", () => {
  it("fires with high confidence when the tool returned a null id", () => {
    const f = detectFailures(
      log([call("c1", "create_reservation"), result("c1", { status: "failed", reservation_id: null }), assistant("Your confirmation number is RSV-48213.")]),
    );
    const misread = f.find((x) => x.type === "tool_result_misread");
    expect(misread).toMatchObject({ confidence: "high", toolName: "create_reservation", resultPath: { path: "reservation_id", expectedValue: null } });
  });

  it("does not fire when the reference came from a tool or the user", () => {
    expect(
      detectFailures(log([call("c1", "book"), result("c1", { success: true, booking_id: "BK-2291" }), assistant("Your booking ID is BK-2291.")])),
    ).toEqual([]);
    expect(detectFailures(log([user("My order number is 55120"), assistant("Thanks, your order number is 55120.")]))).toEqual([]);
  });
});
