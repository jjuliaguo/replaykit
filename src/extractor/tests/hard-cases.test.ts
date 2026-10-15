/**
 * Hard cases found in review: realistic phrasings and trace shapes that a
 * naive extractor gets wrong. Each test names the risk it guards against.
 * Expectations that the extractor still MISSES are written as such, so the
 * known limitations stay visible and honest.
 */
import { describe, expect, it } from "vitest";
import { analyzeMessage, findReferences } from "../analysis/claims.js";
import { classifyToolResult } from "../analysis/tool-outcome.js";
import { detectFailures } from "../detectors/index.js";
import { extract } from "../extract.js";
import { generateFixture } from "../generate.js";
import { assistant, call, log, result, user } from "./helpers.js";

const failed = { success: false, booking_id: null, message: "Slot unavailable" };
const claims = (t: string) => analyzeMessage(t).successClaims.length;

describe("claim analysis: realistic phrasing", () => {
  it("handles typographic apostrophes (common in LLM output)", () => {
    expect(claims("You’re all set for Friday!")).toBe(1);
    expect(claims("I’ve booked you in.")).toBe(1);
    expect(claims("I couldn’t get that booked.")).toBe(0);
    expect(analyzeMessage("I couldn’t get that booked.").failureAcknowledgements).toHaveLength(1);
  });

  it("is not fooled by friendly idioms containing negation words", () => {
    expect(claims("No problem, your appointment is confirmed!")).toBe(1);
    expect(claims("No worries! You're all set.")).toBe(1);
    expect(claims("Sorry for the wait, your appointment is booked.")).toBe(1);
    expect(analyzeMessage("Sorry for the wait, your appointment is booked.").failureAcknowledgements).toHaveLength(0);
  });

  it("scopes negation to the clause making the claim", () => {
    expect(claims("I couldn't get 3 PM, but you're booked for 4 PM.")).toBe(1);
    expect(claims("Your appointment is booked, not cancelled.")).toBe(1);
    expect(claims("Your appointment isn't booked yet.")).toBe(0);
  });

  it("treats 'I can confirm' as a claim, but not future intent", () => {
    expect(claims("I can confirm your appointment is booked.")).toBe(1);
    expect(claims("I'll make sure it's booked.")).toBe(0);
    expect(claims("Let me see if it's confirmed.")).toBe(0);
  });

  it("does not split sentences on common abbreviations", () => {
    const a = analyzeMessage("Your appointment with Dr. Patel is confirmed for 3 p.m. Friday.");
    expect(a.successClaims).toHaveLength(1);
    expect(a.successClaims[0]!.sentence).toContain("appointment with Dr. Patel");
  });

  it("does not treat a question as a claim even with a claim phrase", () => {
    expect(claims("Is your appointment confirmed for Friday?")).toBe(0);
    expect(claims("Should I keep it booked for Friday?")).toBe(0);
  });

  it("KNOWN MISS: indirect claims are not detected", () => {
    // Documented limitation: precision over recall.
    expect(claims("We'll see you Friday at 3!")).toBe(0);
  });
});

describe("tool outcome: real-world response shapes", () => {
  it.each([
    [{ success: "false" }, "failure"],
    [{ status: 409, message: "Conflict" }, "failure"],
    [{ statusCode: 503 }, "failure"],
    [{ status: 200, data: { ok: true } }, "success"],
    [{ status: "pending" }, "unknown"],
    [{ code: 415 }, "unknown"],
  ] as const)("%j -> %s", (body, expected) => {
    expect(classifyToolResult({ type: "tool_result", callId: "c", response: { body } }).outcome).toBe(expected);
  });

  it("recognizes framework error strings but not ordinary text", () => {
    const err = classifyToolResult({ type: "tool_result", callId: "c", response: { body: "Error: connection refused" } });
    expect(err.outcome).toBe("failure");
    expect(err.messages).toEqual(["Error: connection refused"]);
    expect(classifyToolResult({ type: "tool_result", callId: "c", response: { body: "Booked for 3pm" } }).outcome).toBe("unknown");
    expect(classifyToolResult({ type: "tool_result", callId: "c", response: { body: "No errors found" } }).outcome).toBe("unknown");
  });
});

describe("detector attribution: avoiding false positives", () => {
  it("does not blame an acknowledged failure for an unrelated claim turns later", () => {
    const f = detectFailures(
      log([
        user("Book Friday 3pm"),
        call("c1", "book_appointment"),
        result("c1", failed),
        assistant("Sorry, that slot is unavailable."),
        user("Never mind. Can you update my email to j@x.com?"),
        assistant("Done, your email has been updated."),
      ]),
    );
    expect(f.filter((x) => x.toolName === "book_appointment")).toEqual([]);
  });

  it("still catches a topical claim after an intervening user turn", () => {
    const f = detectFailures(
      log([
        call("c1", "book_appointment"),
        result("c1", failed),
        assistant("One moment."),
        user("So am I booked?"),
        assistant("Yes, your appointment is booked for Friday."),
      ]),
    );
    expect(f.map((x) => x.type)).toEqual(["false_success_claim"]);
  });

  it("considers the whole agent turn for unhandled errors (filler first)", () => {
    const timeout = { type: "tool_result" as const, callId: "c1", error: { kind: "timeout" as const, message: "timed out" } };
    expect(
      detectFailures(log([call("c1", "get_status"), timeout, assistant("Hmm, one second."), assistant("Sorry, I'm having trouble reaching our system.")])),
    ).toEqual([]);
    const f = detectFailures(log([call("c1", "get_status"), timeout, assistant("Hmm, one second."), assistant("It ships tomorrow.")]));
    expect(f.map((x) => x.type)).toEqual(["unhandled_tool_error"]);
    expect(f[0]!.evidence).toHaveLength(3);
  });

  it("downgrades confidence when the claim matches only the tool description", () => {
    const f = detectFailures(
      log([call("c1", "submit_form"), result("c1", { ok: false }), assistant("Your appointment request is completed.")], {
        tools: [{ name: "submit_form", description: "Submits an appointment request." }],
      }),
    );
    expect(f[0]).toMatchObject({ type: "false_success_claim", confidence: "medium" });
  });

  it("does not flag a reference that differs only in formatting", () => {
    expect(findReferences("Your booking ID is BK-2291.")).toHaveLength(1);
    const f = detectFailures(log([call("c1", "book"), result("c1", { success: true, booking_id: "BK2291" }), assistant("Your booking ID is BK-2291.")]));
    expect(f).toEqual([]);
  });

  it("reports an invented reference once even if repeated", () => {
    const f = detectFailures(
      log([
        call("c1", "book"),
        result("c1", { success: true, booking_id: null }),
        assistant("Your confirmation number is X-55531."),
        user("Can you repeat that?"),
        assistant("Sure, your confirmation number is X-55531."),
      ]),
    );
    expect(f.filter((x) => x.type === "tool_result_misread")).toHaveLength(1);
  });

  it("does not flag a reference from the system prompt", () => {
    const f = detectFailures(
      log([{ type: "message", role: "system", content: "Office reference code 7781." }, assistant("Our reference code is 7781.")]),
    );
    expect(f).toEqual([]);
  });

  it("does nothing on a 200 response with no recognizable status, whatever the agent says", () => {
    const f = detectFailures(log([call("c1", "book_appointment"), result("c1", { slot: "15:00", room: 4 }), assistant("You're booked!")]));
    expect(f).toEqual([]);
  });
});

describe("fixture generation: real-world trace hazards", () => {
  it("redacts credential headers but keeps the response body verbatim", () => {
    const r = extract(
      {
        schemaVersion: "1.0",
        id: "secret-test",
        provider: "test",
        kind: "synthetic",
        events: [
          user("Book me"),
          call("c1", "book_appointment"),
          {
            type: "tool_result",
            callId: "c1",
            request: { headers: { Authorization: "Bearer sk-live-123", "content-type": "application/json", "X-Webhook-Secret": "abc" } },
            response: { status: 200, headers: { "set-cookie": "sid=1" }, body: { success: false, token: "keep-me-body-is-verbatim" } },
          },
          assistant("Your appointment is confirmed."),
        ],
      },
      { extractedAt: "2026-10-15T00:00:00.000Z" },
    );
    const text = JSON.stringify(r.fixture);
    expect(text).not.toContain("sk-live-123");
    expect(text).not.toContain("sid=1");
    expect(text).not.toContain('"abc"');
    expect(r.fixture!.replay.interactions[0]!.request?.headers?.["content-type"]).toBe("application/json");
    expect(r.fixture!.replay.interactions[0]!.response?.body).toEqual({ success: false, token: "keep-me-body-is-verbatim" });
    expect(r.fixture!.metadata?.redactedHeaders).toHaveLength(3);
  });

  it("adds minimal tool definitions when the log has none", () => {
    const r = extract(
      log([user("Book me"), call("c1", "book_appointment", { date: "2026-10-16", party: 2 }), result("c1", failed), assistant("You're booked!")]),
      { extractedAt: "2026-10-15T00:00:00.000Z" },
    );
    expect(r.fixture!.tools).toEqual([
      { name: "book_appointment", parameters: { type: "object", properties: { date: { type: "string" }, party: { type: "integer" } } } },
    ]);
    expect(r.fixture!.metadata?.inferredTools).toEqual(["book_appointment"]);
  });

  it("starts multi-turn replays at the first user turn and keeps later turns in order", () => {
    const r = extract(
      log(
        [
          user("Hi"),
          assistant("Hello! How can I help?"),
          user("Book Friday 3pm"),
          call("c1", "book_appointment"),
          result("c1", failed),
          assistant("Your appointment is confirmed."),
          user("Thanks"),
        ],
      ),
      { extractedAt: "2026-10-15T00:00:00.000Z" },
    );
    expect(r.fixture!.scenario.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(r.fixture!.scenario.userTurns).toEqual(["Hi", "Book Friday 3pm", "Thanks"]);
  });

  it("refuses to produce a fixture with nothing for the agent to respond to", () => {
    const l = log([assistant("Your confirmation number is Q-9912.")]);
    const findings = detectFailures(l);
    expect(findings).toHaveLength(1);
    expect(() => generateFixture(l, findings)).toThrow(/scenario\.messages|not replayable/);
  });
});

describe("OpenAI adapter: content part arrays", () => {
  it("accepts array content and tool results as parts", () => {
    const r = extract({
      messages: [
        { role: "user", content: [{ type: "text", text: "Book Friday" }] },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "book", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: [{ type: "text", text: '{"success": false}' }] },
        { role: "assistant", content: [{ type: "text", text: "You’re booked for Friday!" }] },
      ],
    });
    expect(r.findings.map((f) => f.type)).toEqual(["false_success_claim"]);
  });
});
