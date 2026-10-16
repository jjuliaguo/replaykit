/**
 * Formats no reader was written for. Each is a plausible export from some
 * agent platform or homegrown logger, with different key names, nesting, and
 * layout. The bar: read it, keep every value verbatim, and catch the planted
 * false success claim (or report "nothing to test" when there is no tool data).
 */
import { describe, expect, it } from "vitest";
import { toCallLog, toCallLogAsync } from "../adapters/index.js";
import type { LlmClient } from "../adapters/llm-client.js";
import { extract, extractAsync } from "../extract.js";

const failed = (r: ReturnType<typeof extract>) => r.findings.map((f) => f.type);

describe("structure inference on unseen formats", () => {
  it("deeply nested timeline with unfamiliar key names", () => {
    const log = {
      data: {
        call: {
          ref: "cx-991",
          timeline: [
            { at: "2026-10-15T10:00:01Z", actor: "customer", kind: "speech", words: "I need to cancel my gym membership please." },
            { at: "2026-10-15T10:00:03Z", actor: "voice_bot", kind: "function_call", function: "cancel_membership", params: { member_id: "m_44" } },
            { at: "2026-10-15T10:00:05Z", actor: "system", kind: "function_result", function: "cancel_membership", output: { ok: false, error: "Contract minimum term not met" } },
            { at: "2026-10-15T10:00:07Z", actor: "voice_bot", kind: "speech", words: "All done, your membership has been cancelled." },
          ],
        },
      },
    };
    const r = extract(log);
    expect(r.callLog.provider).toBe("inferred");
    expect(r.callLog.events.find((e) => e.type === "tool_call")).toMatchObject({ toolName: "cancel_membership", arguments: { member_id: "m_44" } });
    expect(failed(r)).toEqual(["false_success_claim"]);
    expect(r.callLog.notes).toMatch(/inferred the structure from the "data.call.timeline" list/);
  });

  it("named speakers with descriptive labels", () => {
    const log = {
      conversation_log: [
        { speaker: "Jordan (caller)", text: "Is my refund processed?" },
        { speaker: "Ava", text: "Let me check that for you right now." },
      ],
    };
    const roles = toCallLog(log).events.map((e) => (e.type === "message" ? e.role : e.type));
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("tool call and result attached to the agent's own turn", () => {
    const log = {
      turns: [
        { role: "user", text: "Book a table for two at 8." },
        { role: "agent", text: null, function: { name: "create_booking", arguments: { size: 2, time: "20:00" } }, function_response: { status: "rejected", reason: "Fully booked" } },
        { role: "agent", text: "Great news, you're booked for two at 8 tonight!" },
      ],
    };
    const r = extract(log);
    expect(r.callLog.events.filter((e) => e.type === "tool_call")).toHaveLength(1);
    expect(failed(r)).toEqual(["false_success_claim"]);
  });

  it("an array of plain strings is read as transcript lines", () => {
    const r = extract({ lines: ["Agent: Hi there!", "User: Can you update my email?", "Agent: Sure, done."] });
    expect(r.callLog.events).toHaveLength(3);
    expect(r.fixture).toBeNull();
  });

  it("text logs with timestamps and tool lines", () => {
    const text = [
      "[00:08] USER: Can you cancel my subscription?",
      '[00:10] TOOL_CALL cancel_subscription {"user_id": "u_1"}',
      '[00:12] TOOL_RESPONSE cancel_subscription {"status": "error", "message": "Payment processor unavailable"}',
      "[00:13] AGENT: Done! Your subscription is cancelled.",
    ].join("\n");
    const r = extract(text);
    expect(r.callLog.events.map((e) => e.type)).toEqual(["message", "tool_call", "tool_result", "message"]);
    expect(failed(r)).toEqual(["false_success_claim"]);
  });

  it("text log tool errors without JSON", () => {
    const text = ["14:02:01 Caller: Move me to Friday.", "14:02:03 Tool request: reschedule {}", "14:02:13 Tool error: reschedule TIMEOUT after 10s", "14:02:14 Agent: You're all set for Friday!"].join("\n");
    const r = extract(text);
    expect(r.callLog.events.find((e) => e.type === "tool_result")).toMatchObject({ error: { kind: "timeout" } });
    expect(failed(r)).toEqual(["false_success_claim"]);
  });

  it("an application log with no conversation structure yields nothing to test, not an invented one", () => {
    const r = extract({ entries: [{ ts: 1, level: "info", msg: "call connected to the agent" }, { ts: 2, level: "info", msg: "call ended after 30 seconds" }] });
    expect(r.findings).toEqual([]);
    expect(r.fixture).toBeNull();
    expect(r.callLog.events.every((e) => e.type === "message" && e.role === "system")).toBe(true);
  });

  it("copies every value verbatim: no text in the result that isn't in the input", () => {
    const log = { data: { items: [{ who: "client", said: "Change my plan to Pro." }, { who: "assistant", said: "Your plan has been upgraded to Pro." }] } };
    const input = JSON.stringify(log);
    for (const e of toCallLog(log).events) if (e.type === "message") expect(input).toContain(e.content);
  });
});

describe("LLM normalizer (grounded)", () => {
  // A format with no recognizable role or type words, which inference can't read.
  const weird = { session: { rows: [{ p: "C", v: "Please book Friday at 3." }, { p: "X", fn: "book_slot", a: { t: "15:00" } }, { p: "Y", fn: "book_slot", r: { ok: false } }, { p: "B", v: "You're booked for Friday at 3!" }] } };
  const fake = (reply: unknown): LlmClient & { calls: number } => {
    const c = {
      calls: 0,
      async complete() {
        c.calls++;
        return JSON.stringify(reply);
      },
    };
    return c;
  };
  const honest = {
    id: null,
    events: [
      { type: "message", role: "user", content: "Please book Friday at 3." },
      { type: "tool_call", callId: "c1", toolName: "book_slot", arguments: { t: "15:00" } },
      { type: "tool_result", callId: "c1", toolName: "book_slot", status: null, body: { ok: false }, error: null },
      { type: "message", role: "assistant", content: "You're booked for Friday at 3!" },
    ],
  };

  it("reads an unfamiliar format and the failure is detected", async () => {
    const r = await extractAsync(weird, { llm: fake(honest) });
    expect(r.callLog.provider).toBe("read-by-llm");
    expect(r.findings.map((f) => f.type)).toEqual(["false_success_claim"]);
  });

  it("drops anything the model wrote that isn't in the log", async () => {
    const invented = structuredClone(honest);
    invented.events.push({ type: "message", role: "assistant", content: "Your confirmation number is ZZ-0000." } as never);
    const log = await toCallLogAsync(weird, { llm: fake(invented) });
    expect(log.events.some((e) => e.type === "message" && e.content.includes("ZZ-0000"))).toBe(false);
    expect(log.notes).toMatch(/1 dropped because their content was not found/);
  });

  it("rejects a reading that is mostly invented", async () => {
    const fiction = { events: [{ type: "message", role: "user", content: "Cancel my flight." }, { type: "message", role: "assistant", content: "Done, it's cancelled." }] };
    // With nothing usable from either path, the result is an error rather than an invented call.
    await expect(toCallLogAsync({ nothing: { here: 1 } }, { llm: fake(fiction) })).rejects.toThrow(/could not be found in the original log|Couldn't find a conversation/);
  });

  it("rejects invented tool responses", async () => {
    const forged = structuredClone(honest);
    forged.events[2] = { type: "tool_result", callId: "c1", toolName: "book_slot", status: 200, body: { ok: true, booking_id: "B-1" }, error: null } as never;
    const log = await toCallLogAsync(weird, { llm: fake(forged) });
    expect(JSON.stringify(log)).not.toContain("B-1");
  });

  it("is not called when the log is already readable", async () => {
    const llm = fake(honest);
    await extractAsync({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }, { llm });
    expect(llm.calls).toBe(0);
  });

  it("stays off by default without configuration", async () => {
    const r = await extractAsync({ session: { rows: [{ p: "C", v: "hello there friend, call the api" }] } }, {});
    expect(r.callLog.provider).not.toBe("read-by-llm");
  });
});

describe("tool-only event logs", () => {
  const toolOnly = {
    call_id: "test_001",
    events: [
      { type: "tool_call", tool: "reschedule_appointment", request: { appointment_id: "apt_123", new_date: "2026-10-16" } },
      { type: "tool_response", tool: "reschedule_appointment", status: "error", error: "TIMEOUT", http_status: 504 },
    ],
  };

  it("keeps the real tool name and doesn't mistake an argument for a call id", () => {
    const log = toCallLog(toolOnly);
    const call = log.events.find((e) => e.type === "tool_call");
    expect(call).toMatchObject({ toolName: "reschedule_appointment", arguments: { appointment_id: "apt_123", new_date: "2026-10-16" } });
    expect(call?.type === "tool_call" && call.callId).not.toBe("apt_123");
    expect(log.events.find((e) => e.type === "tool_result")).toMatchObject({ toolName: "reschedule_appointment", error: { kind: "timeout" } });
  });

  it("finds the false claim once the agent's reply is in the log", () => {
    const full = structuredClone(toolOnly) as { call_id: string; events: Array<Record<string, unknown>> };
    full.events.unshift({ type: "user_message", content: "Can you move my appointment to October 16th?" });
    full.events.push({ type: "agent_message", content: "Done! Your appointment has been moved to October 16th." });
    const r = extract(full);
    expect(r.findings[0]).toMatchObject({ type: "false_success_claim", toolName: "reschedule_appointment", confidence: "high" });
  });
});
