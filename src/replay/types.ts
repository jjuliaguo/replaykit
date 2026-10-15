import type { JsonValue } from "../shared/json.js";
import type { ToolError } from "../shared/call-log.js";
import type { ExpectationKind } from "../shared/fixture.js";

export type MatchKind = "sequence" | "arguments" | "unmatched";

export type MatchedToolResult = {
  matched: true;
  kind: "response" | "error";
  interactionId: string;
  strategy: "sequence" | "arguments";
  status?: number;
  headers?: Record<string, string>;
  body?: JsonValue;
  error?: ToolError;
};

export type UnmatchedToolResult = {
  matched: false;
  kind: "unmatched";
  status: number;
  body: JsonValue;
};

export type FailRunResult = {
  matched: false;
  kind: "fail_run";
  reason: string;
};

export type ToolInvokeResult = MatchedToolResult | UnmatchedToolResult | FailRunResult;

export type ReplayToolCall = {
  callId: string;
  toolName: string;
  arguments: JsonValue;
  result: ToolInvokeResult;
};

export type ReplayMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};

export type ReplayTrace = {
  agentId: string;
  agentKind: "scripted" | "policy" | "live";
  startedAt: string;
  durationMs: number;
  status: "completed" | "aborted" | "error";
  error?: string;
  messages: ReplayMessage[];
  toolCalls: ReplayToolCall[];
  finalMessage?: string;
};

export type Outcome = "pass" | "fail" | "skipped";

export type ExpectationResult = {
  id: string;
  kind: ExpectationKind;
  description: string;
  outcome: Outcome;
  reason: string;
  evidence: string[];
};

export type EvaluatedRun = {
  trace: ReplayTrace;
  expectationResults: ExpectationResult[];
  passed: number;
  failed: number;
  skipped: number;
  /** True only when every non-skipped expectation passed and the run completed. */
  overall: "pass" | "fail";
};

export type ExpectationDelta = {
  id: string;
  description: string;
  from: Outcome;
  to: Outcome;
};

export type RunComparison = {
  baselineId: string;
  candidateId: string;
  improved: ExpectationDelta[];
  stillFailing: ExpectationDelta[];
  regressed: ExpectationDelta[];
  unchangedPass: string[];
};

export type ReplayKitReport = {
  schemaVersion: "1.0";
  generatedAt: string;
  mode: "offline" | "live";
  fixture: {
    id: string;
    name: string;
    description?: string;
    sourceKind: "synthetic" | "recorded";
    sourceProvider: string;
  };
  recordedInteractions: Array<{
    id: string;
    toolName: string;
    status?: number;
    body?: JsonValue;
    error?: ToolError;
  }>;
  original: {
    finalAgentMessage?: string;
    failures: Array<{ type: string; summary: string; confidence: string }>;
  };
  runs: EvaluatedRun[];
  comparison?: RunComparison;
};
