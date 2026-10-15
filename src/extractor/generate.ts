/**
 * Turns a call log plus detected findings into a validated replay fixture.
 *
 * Everything in the fixture is copied from the log or derived from a
 * finding. Recorded tool responses are copied verbatim (deep-cloned, never
 * rewritten). The result is validated against the shared schema before it
 * is returned, so an invalid fixture can never be written to disk.
 */
import type { JsonValue } from "../shared/json.js";
import {
  FIXTURE_SCHEMA_VERSION,
  parseFixture,
  type CallLog,
  type Evidence,
  type Expectation,
  type ReplayFixture,
  type ReplayInteraction,
} from "../shared/types.js";
import { pairInteractions } from "./analysis/interactions.js";
import type { Finding } from "./detectors/index.js";
import { EXTRACTOR_NAME, EXTRACTOR_VERSION } from "./version.js";

export interface GenerateOptions {
  /** ISO timestamp; defaults to now. Pass a fixed value for reproducible output. */
  extractedAt?: string;
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "fixture"
  );
}

function scenarioMessages(log: CallLog, findings: Finding[]): ReplayFixture["scenario"]["messages"] {
  const firstCall = log.events.findIndex((e) => e.type === "tool_call");
  const firstFailure = Math.min(...findings.map((f) => f.messageIndex));
  // Replay starts from what the agent knew before its first tool call, or
  // before the failing reply if it never called a tool.
  const cutoff = firstCall === -1 ? firstFailure : Math.min(firstCall, firstFailure);
  const messages = log.events
    .slice(0, cutoff)
    .filter((e) => e.type === "message")
    .map((e) => ({ role: e.role, content: e.content }));
  // An assistant turn cannot be the last thing before the agent runs; trim trailing ones.
  while (messages.length > 0 && messages[messages.length - 1]!.role === "assistant") messages.pop();
  return messages;
}

function replayInteractions(log: CallLog): { interactions: ReplayInteraction[]; skipped: string[] } {
  const interactions: ReplayInteraction[] = [];
  const skipped: string[] = [];
  for (const i of pairInteractions(log)) {
    if (i.result === null || i.resultIndex === null) {
      skipped.push(`${i.callId} (${i.toolName}): no tool_result in log`);
      continue;
    }
    if (!i.result.response && !i.result.error) {
      skipped.push(`${i.callId} (${i.toolName}): tool_result has neither response nor error`);
      continue;
    }
    interactions.push({
      id: i.callId,
      toolName: i.toolName,
      recordedArguments: structuredClone(i.call.arguments as JsonValue),
      ...(i.result.request ? { request: structuredClone(i.result.request) } : {}),
      ...(i.result.response ? { response: structuredClone(i.result.response) } : {}),
      ...(i.result.error ? { error: structuredClone(i.result.error) } : {}),
      match: { strategy: "sequence" },
      sourceEventIndex: i.resultIndex,
    });
  }
  return { interactions, skipped };
}

/** Accumulates expectations, merging duplicates by id. */
class ExpectationSet {
  private readonly byId = new Map<string, Expectation>();

  add(expectation: Expectation): void {
    const existing = this.byId.get(expectation.id);
    if (!existing) {
      this.byId.set(expectation.id, structuredClone(expectation));
      return;
    }
    const key = (e: Evidence) => `${e.eventIndex}|${e.quote ?? ""}|${e.path ?? ""}`;
    const seen = new Set(existing.evidence.map(key));
    for (const e of expectation.evidence) if (!seen.has(key(e))) existing.evidence.push(e);
    if (existing.kind === "no_success_claim" && expectation.kind === "no_success_claim") {
      existing.claimPhrases = [...new Set([...existing.claimPhrases, ...expectation.claimPhrases])];
    }
    if (existing.kind === "acknowledges_failure" && expectation.kind === "acknowledges_failure") {
      existing.signals = [...new Set([...existing.signals, ...expectation.signals])];
    }
  }

  values(): Expectation[] {
    return [...this.byId.values()];
  }
}

function expectationsFor(finding: Finding, set: ExpectationSet): void {
  const tool = finding.toolName;
  const evidence = finding.evidence;
  const toolCalled = (rationale: string) =>
    tool &&
    set.add({
      id: `calls-${slug(tool)}`,
      kind: "tool_called",
      toolName: tool,
      minCalls: 1,
      description: `Agent calls ${tool}`,
      rationale,
      evidence: [],
    });
  const noSuccessClaim = (rationale: string) =>
    tool &&
    set.add({
      id: `no-success-claim-${slug(tool)}`,
      kind: "no_success_claim",
      toolName: tool,
      claimPhrases: finding.claimPhrases ?? [],
      description: `Agent does not tell the user that ${tool} succeeded`,
      rationale,
      evidence,
    });
  const acknowledges = (rationale: string) =>
    tool &&
    set.add({
      id: `acknowledges-failure-${slug(tool)}`,
      kind: "acknowledges_failure",
      toolName: tool,
      signals: finding.failureSignals ?? [],
      description: `Agent tells the user that ${tool} did not succeed`,
      rationale,
      evidence,
    });

  switch (finding.type) {
    case "false_success_claim":
      toolCalled(`The original agent called ${tool}; the failure depends on its recorded response.`);
      noSuccessClaim(`The recorded ${tool} response reports failure, so any success claim is false.`);
      acknowledges(`The user must learn that the action did not happen.`);
      break;
    case "unhandled_tool_error":
      toolCalled(`The original agent called ${tool}; the failure depends on its recorded error.`);
      acknowledges(`${tool} failed and the original agent did not tell the user.`);
      noSuccessClaim(`${tool} failed, so the agent must not claim it succeeded.`);
      break;
    case "unverified_success_claim":
      toolCalled(`The workflow requires ${tool} before the action can be claimed as done.`);
      noSuccessClaim(
        `The original agent claimed success without calling ${tool}. With no recorded response for ${tool}, a replayed call returns an error, so success must not be claimed.`,
      );
      break;
    case "tool_result_misread":
      if (finding.resultPath && tool) {
        set.add({
          id: `consistent-${slug(tool)}-${slug(finding.resultPath.path)}`,
          kind: "consistent_with_tool_result",
          toolName: tool,
          path: finding.resultPath.path,
          expectedValue: finding.resultPath.expectedValue,
          description: `Agent's reply is consistent with ${tool} returning ${finding.resultPath.path} = ${JSON.stringify(finding.resultPath.expectedValue)}`,
          rationale: "The original agent stated an identifier the tool never returned.",
          evidence,
        });
      } else {
        set.add({
          id: "no-invented-references",
          kind: "rubric",
          rubric: "The agent must not give the user any confirmation, booking, order, or reference number that does not appear in a tool result.",
          description: "Agent does not invent reference numbers",
          rationale: "The original agent stated an identifier that appears in no tool result.",
          evidence,
        });
      }
      break;
  }
}

export function generateFixture(log: CallLog, findings: Finding[], options: GenerateOptions = {}): ReplayFixture {
  if (findings.length === 0) {
    throw new Error("cannot generate a fixture without at least one detected failure");
  }
  const expectations = new ExpectationSet();
  for (const f of findings) expectationsFor(f, expectations);

  const { interactions, skipped } = replayInteractions(log);
  const tools = [...new Set(findings.map((f) => f.toolName).filter((t): t is string => !!t))];
  const types = [...new Set(findings.map((f) => f.type))];
  const label = log.kind === "synthetic" ? "SYNTHETIC: " : "";
  const finalAgentMessage = [...log.events].reverse().find((e) => e.type === "message" && e.role === "assistant");

  const fixture = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    id: slug(log.id),
    name: `${label}${types.join(" + ")}${tools.length ? ` (${tools.join(", ")})` : ""}`,
    description: findings.map((f) => f.summary).join("\n"),
    source: {
      provider: log.provider,
      kind: log.kind,
      callLogId: log.id,
      ...(log.startedAt ? { capturedAt: log.startedAt } : {}),
      extractedAt: options.extractedAt ?? new Date().toISOString(),
      extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_VERSION },
    },
    scenario: {
      messages: scenarioMessages(log, findings),
      userTurns: log.events.filter((e) => e.type === "message" && e.role === "user").map((e) => (e as { content: string }).content),
    },
    tools: structuredClone(log.tools),
    ...(log.workflow ? { workflow: structuredClone(log.workflow) } : {}),
    replay: { interactions, onUnmatchedCall: "error_response" as const },
    original: {
      events: structuredClone(log.events),
      ...(finalAgentMessage && finalAgentMessage.type === "message" ? { finalAgentMessage: finalAgentMessage.content } : {}),
    },
    failures: findings.map((f) => ({
      type: f.type,
      summary: f.summary,
      ...(f.toolName ? { toolName: f.toolName } : {}),
      confidence: f.confidence,
      detector: f.detector,
      evidence: f.evidence,
    })),
    expectations: expectations.values(),
    ...(skipped.length || log.notes ? { metadata: { ...(skipped.length ? { skippedInteractions: skipped } : {}), ...(log.notes ? { notes: log.notes } : {}) } } : {}),
  };
  return parseFixture(fixture, `generated fixture for ${log.id}`);
}
