import { describe, expect, it } from "vitest";
import { analyzeMessage, findReferences, splitSentences } from "../analysis/claims.js";
import { mentionedKeywords, toolKeywords } from "../analysis/keywords.js";
import { classifyToolResult } from "../analysis/tool-outcome.js";
import type { ToolResultEvent } from "../../shared/types.js";

const res = (body: unknown, status?: number, error?: ToolResultEvent["error"]): ToolResultEvent => ({
  type: "tool_result",
  callId: "c",
  ...(body !== undefined || status !== undefined ? { response: { ...(status !== undefined ? { status } : {}), ...(body !== undefined ? { body: body as never } : {}) } } : {}),
  ...(error ? { error } : {}),
});

describe("classifyToolResult", () => {
  it("treats success:false inside HTTP 200 as failure", () => {
    const o = classifyToolResult(res({ success: false, message: "Slot unavailable" }, 200));
    expect(o.outcome).toBe("failure");
    expect(o.signals[0]).toMatchObject({ path: "response.body.success", value: "false" });
    expect(o.messages).toEqual(["Slot unavailable"]);
  });

  it.each([
    [{ ok: false }, "failure"],
    [{ status: "failed" }, "failure"],
    [{ state: "REJECTED" }, "failure"],
    [{ error: "card declined" }, "failure"],
    [{ errors: [{ code: 1 }] }, "failure"],
    [{ data: { success: false } }, "failure"],
    [{ success: true, id: "x" }, "success"],
    [{ status: "confirmed" }, "success"],
    [{ errors: [], success: true }, "success"],
    [{ error: null, status: "ok" }, "success"],
    [{ temperature: 21 }, "unknown"],
    ["plain text", "unknown"],
  ] as const)("%j -> %s", (body, expected) => {
    expect(classifyToolResult(res(body, 200)).outcome).toBe(expected);
  });

  it("explicit failure wins over a success-looking status", () => {
    expect(classifyToolResult(res({ status: "ok", success: false })).outcome).toBe("failure");
  });

  it("uses HTTP status and transport errors", () => {
    expect(classifyToolResult(res("Internal Server Error", 500)).outcome).toBe("failure");
    expect(classifyToolResult(res("Internal Server Error", 500)).messages).toEqual(["Internal Server Error"]);
    const t = classifyToolResult(res(undefined, undefined, { kind: "timeout", message: "timed out" }));
    expect(t.outcome).toBe("failure");
    expect(t.signals[0]?.path).toBe("error.kind");
  });

  it("returns unknown for a missing result", () => {
    expect(classifyToolResult(null).outcome).toBe("unknown");
  });
});

describe("analyzeMessage", () => {
  it.each([
    "Your appointment is confirmed for Friday at 3 PM.",
    "I've booked you in for Friday.",
    "You're all set!",
    "Your address has been updated.",
    "The payment went through.",
    "I have successfully cancelled your order.",
    "Your confirmation number is ABC-1234.",
  ])("detects a success claim: %s", (text) => {
    expect(analyzeMessage(text).successClaims).toHaveLength(1);
  });

  it.each([
    "I'm sorry, that slot is unavailable.",
    "I couldn't book that time.",
    "Your appointment is not confirmed yet.",
    "Would you like me to book Friday at 4 instead?",
    "Once your appointment is confirmed, you'll get a text.",
    "I'll book that for you now.",
    "Let me check whether it's booked.",
    "What time works for you?",
    "Unfortunately the booking wasn't completed.",
  ])("does not treat as a success claim: %s", (text) => {
    expect(analyzeMessage(text).successClaims).toHaveLength(0);
  });

  it("finds failure acknowledgements", () => {
    const a = analyzeMessage("Sorry, Friday is fully booked. Would another day work?");
    expect(a.failureAcknowledgements.length).toBeGreaterThanOrEqual(2);
  });

  it("splits sentences without breaking on times or abbreviations mid-sentence", () => {
    expect(splitSentences("Booked for 3 p.m. today. See you!")).toHaveLength(2);
  });
});

describe("findReferences", () => {
  it("finds identifier-like references with digits only", () => {
    expect(findReferences("Your confirmation number is RSV-48213.").map((r) => r.value)).toEqual(["RSV-48213"]);
    expect(findReferences("Your booking ID: BK2291")).toHaveLength(1);
    expect(findReferences("Your confirmation number is pending.")).toHaveLength(0);
  });
});

describe("keywords", () => {
  it("derives stems from tool name and description", () => {
    const k = toolKeywords("book_appointment", { name: "book_appointment", description: "Books an appointment slot." });
    expect(k).toContain("book");
    expect(k).toContain("appoint");
    expect(mentionedKeywords("Your appointment is confirmed", k)).toEqual(["appoint"]);
    expect(toolKeywords("updateCustomerAddress")).toEqual(["update", "customer", "address"]);
  });
});
