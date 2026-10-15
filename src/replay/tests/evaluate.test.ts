import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFixture } from "../../shared/types.js";
import { originalFailureScript, runScriptedAgent } from "../agent/scripted.js";
import { runPolicyAgent } from "../agent/policy.js";
import { evaluateRun } from "../evaluate/evaluate.js";
import { detectSuccessClaim } from "../evaluate/claims.js";

const booking = () => parseFixture(JSON.parse(readFileSync("fixtures/booking-unavailable.json", "utf8")));

describe("evaluators", () => {
  it("fails the original booking reply for claiming success after a failed tool", async () => {
    const fixture = booking();
    const trace = await runScriptedAgent(fixture, originalFailureScript(fixture));
    const evaluated = evaluateRun(fixture, trace);
    expect(evaluated.overall).toBe("fail");
    expect(evaluated.expectationResults.find((r) => r.id === "no-false-success-book_appointment")?.outcome).toBe("fail");
    expect(evaluated.expectationResults.find((r) => r.id === "acknowledges-book_appointment-failure")?.outcome).toBe("fail");
    expect(evaluated.expectationResults.find((r) => r.id === "calls-book_appointment")?.outcome).toBe("pass");
  });

  it("passes the honor policy on the booking fixture from actual tool results", async () => {
    const fixture = booking();
    const trace = await runPolicyAgent(fixture, "honor");
    const evaluated = evaluateRun(fixture, trace);
    expect(evaluated.overall).toBe("pass");
    expect(trace.finalMessage).toMatch(/Slot unavailable/);
  });

  it("treats a missing required tool call as a failure only when the fixture requires the tool", async () => {
    const fixture = booking();
    const trace = await runPolicyAgent(fixture, "skip");
    const evaluated = evaluateRun(fixture, trace);
    expect(evaluated.expectationResults.find((r) => r.kind === "tool_called")?.outcome).toBe("fail");
    expect(evaluated.expectationResults.find((r) => r.kind === "no_success_claim")?.outcome).toBe("fail");
  });

  it("does not treat negated confirmation language as a success claim", () => {
    expect(detectSuccessClaim("Nothing is confirmed. The slot is unavailable.").claimed).toBe(false);
    expect(detectSuccessClaim("Great news, Jordan! Your appointment is confirmed.").claimed).toBe(true);
  });

  it("skips rubric expectations instead of inventing an LLM judgment", () => {
    const fixture = booking();
    fixture.expectations.push({
      id: "rubric-tone",
      kind: "rubric",
      description: "Be kind",
      rationale: "Optional judge",
      evidence: [],
      rubric: "The agent should be polite.",
    });
    const evaluated = evaluateRun(fixture, {
      agentId: "empty",
      agentKind: "scripted",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: "completed",
      messages: [{ role: "assistant", content: "The slot is unavailable. Nothing is confirmed." }],
      toolCalls: [
        {
          callId: "c1",
          toolName: "book_appointment",
          arguments: {},
          result: { matched: true, kind: "response", interactionId: "call_1", strategy: "sequence", status: 200, body: { success: false } },
        },
      ],
      finalMessage: "The slot is unavailable. Nothing is confirmed.",
    });
    expect(evaluated.expectationResults.find((r) => r.kind === "rubric")?.outcome).toBe("skipped");
    expect(evaluated.overall).toBe("pass");
  });
});
