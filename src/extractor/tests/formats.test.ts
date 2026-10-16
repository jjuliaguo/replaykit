/**
 * Real-world log shapes, pasted as-is. Each sample is hand-written but shaped
 * like the platform's documented output. The point is the whole chain:
 * read the format, then detect the failure, without any manual conversion.
 */
import { describe, expect, it } from "vitest";
import { detectFormat, InputFormatError, toCallLog } from "../adapters/index.js";
import { extract } from "../extract.js";

const blandCall = {
  call_id: "9c1f3e2a-0000-4000-8000-000000000001",
  started_at: "2026-10-15T14:00:00.000Z",
  concatenated_transcript: "assistant: Hi, this is Riley.\nuser: Book me Friday at 3.",
  variables: { now: "2026-10-15" },
  transcripts: [
    { id: 1, created_at: "2026-10-15T14:00:01.000Z", text: "Hi, this is Riley at Lakeside Dental. How can I help?", user: "assistant" },
    { id: 2, created_at: "2026-10-15T14:00:05.000Z", text: "Can you book me for Friday at 3 PM?", user: "user" },
    {
      id: 3,
      created_at: "2026-10-15T14:00:07.000Z",
      text: 'Webhook book_appointment response: {"success": false, "booking_id": null, "message": "Slot unavailable"}',
      user: "agent-action",
    },
    { id: 4, created_at: "2026-10-15T14:00:09.000Z", text: "You're all set! Your appointment is confirmed for Friday at 3 PM.", user: "assistant" },
  ],
};

describe("Bland call details", () => {
  it("reads transcripts, turns a JSON agent action into a tool result, and finds the false confirmation", () => {
    expect(detectFormat(blandCall)).toBe("bland");
    const r = extract(blandCall, { extractedAt: "2026-10-15T00:00:00.000Z" });
    expect(r.callLog.provider).toBe("bland");
    expect(r.callLog.id).toBe(blandCall.call_id);
    const call = r.callLog.events.find((e) => e.type === "tool_call");
    expect(call?.type === "tool_call" && call.toolName).toBe("book_appointment");
    expect(r.findings.map((f) => f.type)).toContain("false_success_claim");
    expect(r.fixture?.source.kind).toBe("recorded");
    expect(r.callLog.notes).toMatch(/Bland call details.*1 with a JSON payload/);
  });

  it("keeps agent actions without JSON as visible system notes, not invented tool calls", () => {
    const call = { ...blandCall, transcripts: [blandCall.transcripts[1], { id: 9, created_at: "2026-10-15T14:00:06.000Z", text: "Transferring call", user: "agent-action" }, blandCall.transcripts[3]] };
    const log = toCallLog(call);
    expect(log.events.some((e) => e.type === "tool_call")).toBe(false);
    expect(log.events.find((e) => e.type === "message" && e.role === "system")).toMatchObject({ content: "[agent action] Transferring call" });
  });

  it("falls back to concatenated_transcript when there is no transcripts array", () => {
    const log = toCallLog({ call_id: "abc", concatenated_transcript: "assistant: Hello\nuser: Hi there\nassistant: How can I help?" });
    expect(log.provider).toBe("bland");
    expect(log.events.map((e) => (e.type === "message" ? e.role : e.type))).toEqual(["assistant", "user", "assistant"]);
  });
});

describe("plain-text transcripts", () => {
  it("reads Speaker: text lines, including named speakers and wrapped lines", () => {
    const log = toCallLog("Riley: Hi, Lakeside Dental.\nCaller: Book Friday at 3?\nRiley: Done, you're all set\nfor Friday at 3.");
    expect(log.provider).toBe("transcript-text");
    expect(log.events).toHaveLength(3);
    expect(log.events[2]).toMatchObject({ role: "assistant", content: "Done, you're all set for Friday at 3." });
    expect(log.notes).toMatch(/"riley" as assistant/);
  });

  it("finds nothing to test in a transcript with no tool data, honestly", () => {
    const r = extract("Agent: Your appointment is confirmed.\nUser: Thanks!");
    expect(r.findings).toEqual([]);
    expect(r.fixture).toBeNull();
  });
});

describe("Retell", () => {
  it("reads transcript_with_tool_calls and finds the failure", () => {
    const r = extract({
      call_id: "retell-1",
      transcript_with_tool_calls: [
        { role: "user", content: "Book Friday at 3" },
        { role: "tool_call_invocation", tool_call_id: "t1", name: "book_appointment", arguments: '{"time":"15:00"}' },
        { role: "tool_call_result", tool_call_id: "t1", content: '{"success": false, "message": "Slot unavailable"}' },
        { role: "agent", content: "Great, your appointment is booked for Friday at 3." },
      ],
    });
    expect(r.callLog.provider).toBe("retell");
    expect(r.findings.map((f) => f.type)).toEqual(["false_success_claim"]);
  });
});

describe("Vapi", () => {
  it("reads bot / tool_calls / tool_call_result messages", () => {
    const r = extract({
      id: "vapi-1",
      artifact: {
        messages: [
          { role: "system", message: "You book appointments." },
          { role: "user", message: "Book Friday at 3" },
          { role: "tool_calls", toolCalls: [{ id: "c1", type: "function", function: { name: "book_appointment", arguments: '{"time":"15:00"}' } }] },
          { role: "tool_call_result", toolCallId: "c1", name: "book_appointment", result: '{"ok": false, "error": "Slot unavailable"}' },
          { role: "bot", message: "You're booked for Friday at 3!" },
        ],
      },
    });
    expect(r.callLog.provider).toBe("vapi");
    expect(r.findings.map((f) => f.type)).toEqual(["false_success_claim"]);
  });
});

describe("generic message lists", () => {
  it("reads Anthropic tool_use / tool_result blocks", () => {
    const r = extract({
      messages: [
        { role: "user", content: "Book Friday at 3" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "book_appointment", input: { time: "15:00" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: '{"success": false, "message": "Slot unavailable"}' }] },
        { role: "assistant", content: [{ type: "text", text: "Your appointment is confirmed for Friday at 3." }] },
      ],
    });
    expect(r.callLog.provider).toBe("messages");
    expect(r.findings.map((f) => f.type)).toEqual(["false_success_claim"]);
  });

  it("reads a bare array with speaker/text keys", () => {
    const log = toCallLog([
      { speaker: "customer", text: "Hi" },
      { speaker: "agent", text: "Hello! How can I help?" },
    ]);
    expect(log.events.map((e) => (e.type === "message" ? e.role : ""))).toEqual(["user", "assistant"]);
  });

  it("unwraps one level, e.g. {call: {transcript: [...]}}", () => {
    const log = toCallLog({ call: { id: "w1", transcript: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] } });
    expect(log.id).toBe("w1");
    expect(log.events).toHaveLength(2);
  });

  it("still reads strict OpenAI chat logs with the original adapter", () => {
    expect(detectFormat({ messages: [{ role: "user", content: "hi" }] })).toBe("openai-chat");
  });
});

describe("unreadable input", () => {
  it("explains what it got and what it accepts", () => {
    expect(() => toCallLog({ foo: 1, bar: [1, 2] })).toThrow(InputFormatError);
    expect(() => toCallLog({ foo: 1, bar: [1, 2] })).toThrow(/keys: foo, bar.*Accepted: Bland call details/s);
    expect(() => toCallLog("just some words")).toThrow(/plain text without speaker lines/);
    expect(() => toCallLog([1, 2, 3])).toThrow(/don't look like messages/);
  });

  it("parses JSON sent as a string", () => {
    expect(toCallLog(JSON.stringify(blandCall)).provider).toBe("bland");
  });
});

describe("generic event logs (pasted by a user)", () => {
  // The exact log a user pasted into the live demo: tool payloads inline on each event.
  const pasted = {
    call_id: "call_8f29a1",
    agent_id: "appointment_assistant_v2.4",
    status: "completed_with_error",
    events: [
      { timestamp: "00:08", type: "user_message", content: "Can you move my appointment from Thursday to Friday at 2 PM?" },
      { timestamp: "00:19", type: "tool_response", tool: "check_availability", http_status: 200, available: true },
      { timestamp: "00:34", type: "tool_request", tool: "reschedule_appointment", appointment_id: "apt_7192", new_time: "2026-10-16T14:00:00-04:00" },
      { timestamp: "00:44", type: "tool_error", tool: "reschedule_appointment", error: "TIMEOUT_ERROR", elapsed_ms: 10000, operation_status: "unknown" },
      { timestamp: "00:48", type: "agent_message", content: "Perfect! I've moved your appointment to Friday at 2 PM. You're all set." },
      { timestamp: "01:42", type: "verification", appointment_rescheduled: false },
    ],
    failure: { type: "false_confirmation", severity: "high" },
  };

  it("reads inline payloads, pairs the error with its request, and keeps other events as notes", () => {
    expect(detectFormat(pasted)).toBe("event-log");
    const log = toCallLog(pasted);
    const calls = log.events.filter((e) => e.type === "tool_call");
    expect(calls.map((c) => c.type === "tool_call" && [c.toolName, c.arguments])).toEqual([
      ["check_availability", {}],
      ["reschedule_appointment", { appointment_id: "apt_7192", new_time: "2026-10-16T14:00:00-04:00" }],
    ]);
    const results = log.events.filter((e) => e.type === "tool_result");
    expect(results[0]).toMatchObject({ response: { status: 200, body: { available: true } } });
    expect(results[1]).toMatchObject({ toolName: "reschedule_appointment", error: { kind: "timeout" } });
    expect(results[1]?.type === "tool_result" && results[1].error?.message).toMatch(/TIMEOUT_ERROR.*operation_status: unknown/);
    expect(log.events.at(-1)).toMatchObject({ role: "system", content: "[verification] appointment_rescheduled: false" });
    expect(log.notes).toMatch(/check_availability had a response but no request event/);
    expect(log.notes).toMatch(/"failure" label was ignored/);
  });

  it("finds the false confirmation from evidence, with high confidence", () => {
    const r = extract(pasted);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ type: "false_success_claim", toolName: "reschedule_appointment", confidence: "high" });
  });

  it("does not flag the same log when the agent is honest", () => {
    const honest = structuredClone(pasted);
    honest.events[4] = { timestamp: "00:48", type: "agent_message", content: "I'm sorry, the system timed out and I couldn't confirm the change. Let me try again." };
    expect(extract(honest).findings).toEqual([]);
  });
});
