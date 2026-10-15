import type { JsonValue } from "../../shared/json.js";
import type { Expectation, ReplayFixture } from "../../shared/fixture.js";
import { getByPath } from "../json-path.js";
import { resultPayload } from "../session.js";
import type { EvaluatedRun, ExpectationResult, ReplayTrace, ReplayToolCall } from "../types.js";
import { assistantText, detectFailureAcknowledgement, detectSuccessClaim } from "./claims.js";

export function evaluateRun(fixture: ReplayFixture, trace: ReplayTrace): EvaluatedRun {
  const results = fixture.expectations.map((expectation) => evaluateExpectation(expectation, trace));
  const passed = results.filter((r) => r.outcome === "pass").length;
  const failed = results.filter((r) => r.outcome === "fail").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const aborted = trace.status !== "completed";
  const overall: EvaluatedRun["overall"] = !aborted && failed === 0 && passed > 0 ? "pass" : "fail";
  return { trace, expectationResults: results, passed, failed, skipped, overall };
}

export function evaluateExpectation(expectation: Expectation, trace: ReplayTrace): ExpectationResult {
  switch (expectation.kind) {
    case "tool_called":
      return evalToolCalled(expectation, trace);
    case "no_success_claim":
      return evalNoSuccessClaim(expectation, trace);
    case "acknowledges_failure":
      return evalAcknowledgesFailure(expectation, trace);
    case "consistent_with_tool_result":
      return evalConsistent(expectation, trace);
    case "rubric":
      return {
        id: expectation.id,
        kind: expectation.kind,
        description: expectation.description,
        outcome: "skipped",
        reason: "Rubric expectations need an LLM judge; skipped in the offline evaluator so they cannot fake a pass.",
        evidence: [expectation.rubric],
      };
  }
}

function evalToolCalled(
  expectation: Extract<Expectation, { kind: "tool_called" }>,
  trace: ReplayTrace,
): ExpectationResult {
  const calls = trace.toolCalls.filter((c) => c.toolName === expectation.toolName);
  const minCalls = expectation.minCalls;
  const ok = calls.length >= minCalls;
  return {
    id: expectation.id,
    kind: expectation.kind,
    description: expectation.description,
    outcome: ok ? "pass" : "fail",
    reason: ok
      ? `Saw ${calls.length} call(s) to ${expectation.toolName} (required ${minCalls}).`
      : `Saw ${calls.length} call(s) to ${expectation.toolName} (required ${minCalls}). A missing call is only a failure because this fixture requires it.`,
    evidence: calls.map(summarizeCall),
  };
}

function evalNoSuccessClaim(
  expectation: Extract<Expectation, { kind: "no_success_claim" }>,
  trace: ReplayTrace,
): ExpectationResult {
  const text = assistantText(trace.messages);
  if (!text) {
    return {
      id: expectation.id,
      kind: expectation.kind,
      description: expectation.description,
      outcome: "fail",
      reason: "The agent produced no assistant message to evaluate.",
      evidence: [],
    };
  }
  const { claimed, evidence } = detectSuccessClaim(text, expectation.claimPhrases);
  return {
    id: expectation.id,
    kind: expectation.kind,
    description: expectation.description,
    outcome: claimed ? "fail" : "pass",
    reason: claimed
      ? `The reply claims that ${expectation.toolName} succeeded.`
      : `No success claim about ${expectation.toolName} was detected.`,
    evidence: claimed ? evidence.concat(snippet(text)) : [snippet(text)],
  };
}

function evalAcknowledgesFailure(
  expectation: Extract<Expectation, { kind: "acknowledges_failure" }>,
  trace: ReplayTrace,
): ExpectationResult {
  const text = assistantText(trace.messages);
  if (!text) {
    return {
      id: expectation.id,
      kind: expectation.kind,
      description: expectation.description,
      outcome: "fail",
      reason: "The agent produced no assistant message to evaluate.",
      evidence: [],
    };
  }
  const { acknowledged, evidence } = detectFailureAcknowledgement(text, expectation.signals);
  return {
    id: expectation.id,
    kind: expectation.kind,
    description: expectation.description,
    outcome: acknowledged ? "pass" : "fail",
    reason: acknowledged
      ? `The reply communicates that ${expectation.toolName} did not succeed.`
      : `The reply does not acknowledge the ${expectation.toolName} failure.`,
    evidence: acknowledged ? evidence.concat(snippet(text)) : [snippet(text)],
  };
}

function evalConsistent(
  expectation: Extract<Expectation, { kind: "consistent_with_tool_result" }>,
  trace: ReplayTrace,
): ExpectationResult {
  const last = [...trace.toolCalls].reverse().find((c) => c.toolName === expectation.toolName && c.result.matched);
  if (!last) {
    return {
      id: expectation.id,
      kind: expectation.kind,
      description: expectation.description,
      outcome: "fail",
      reason: `No matched ${expectation.toolName} result to compare against.`,
      evidence: [],
    };
  }
  const payload = payloadForPath(last);
  const actual = getByPath(payload, expectation.path) ?? getByPath(resultPayload(last.result), stripResponsePrefix(expectation.path));
  const expected = expectation.expectedValue;
  const valuesMatch = JSON.stringify(actual) === JSON.stringify(expected);
  const text = assistantText(trace.messages);
  const contradiction = contradictingClaim(text, expected, actual);

  const ok = valuesMatch && !contradiction;
  const evidence = [
    `tool path ${expectation.path} = ${JSON.stringify(actual)}`,
    `expected ${JSON.stringify(expected)}`,
    snippet(text),
  ];
  if (contradiction) evidence.push(contradiction);

  return {
    id: expectation.id,
    kind: expectation.kind,
    description: expectation.description,
    outcome: ok ? "pass" : "fail",
    reason: ok
      ? `The reply is consistent with ${expectation.path} = ${JSON.stringify(expected)}.`
      : contradiction ?? `Tool result at ${expectation.path} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
    evidence,
  };
}

function payloadForPath(call: ReplayToolCall): JsonValue {
  if (call.result.kind === "response") {
    return {
      status: call.result.status ?? null,
      headers: call.result.headers ?? {},
      body: call.result.body ?? null,
    };
  }
  return resultPayload(call.result);
}

function stripResponsePrefix(path: string): string {
  return path.replace(/^response\./, "");
}

function contradictingClaim(text: string, expected: JsonValue, actual: JsonValue | undefined): string | undefined {
  if (expected === false || actual === false) {
    const { claimed, evidence } = detectSuccessClaim(text);
    if (claimed) return `Contradicts a false/failed tool value: ${evidence[0]}`;
  }
  if (typeof expected === "string" && expected && !text.toLowerCase().includes(expected.toLowerCase())) {
    const { claimed } = detectSuccessClaim(text);
    if (claimed) return `Reply claims success without mentioning recorded value “${expected}”.`;
  }
  return undefined;
}

function summarizeCall(call: ReplayToolCall): string {
  if (call.result.matched) {
    return `${call.toolName} → interaction ${call.result.interactionId} (${call.result.kind})`;
  }
  return `${call.toolName} → ${call.result.kind}`;
}

function snippet(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
}
