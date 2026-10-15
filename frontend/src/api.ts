/**
 * Typed client for the local ReplayKit server. Types come straight from the
 * shared schema and the replay engine (type-only imports, erased at build),
 * so the UI cannot drift from the data it renders.
 */
import type { CallEvent, CallLog, ReplayFixture } from "../../src/shared/types.js";
import type { ReplayKitReport } from "../../src/replay/types.js";

export type { CallEvent, CallLog, ReplayFixture, ReplayKitReport };
export type { EvaluatedRun, ExpectationResult, ReplayToolCall } from "../../src/replay/types.js";
export type { DetectedFailure, Evidence, Expectation, ReplayInteraction } from "../../src/shared/types.js";

export interface Finding {
  type: "false_success_claim" | "unverified_success_claim" | "tool_result_misread" | "unhandled_tool_error";
  summary: string;
  toolName?: string;
  confidence: "high" | "medium";
  detector: string;
  evidence: Array<{ eventIndex: number; description: string; quote?: string; path?: string }>;
  messageIndex: number;
  callId?: string;
  claimPhrases?: string[];
  failureSignals?: string[];
}

export interface CallSummary {
  name: string;
  id: string;
  format: "calllog" | "openai-chat";
  kind: string;
  notes: string;
  provider: string;
  startedAt: string | null;
  events: number;
  toolCalls: number;
  tools: string[];
  findings: Array<Pick<Finding, "type" | "confidence" | "summary" | "messageIndex"> & { toolName: string | null }>;
  fixtureId: string | null;
  error: string | null;
}

export interface ToolOutcome {
  outcome: "success" | "failure" | "unknown";
  signals: Array<{ outcome: "success" | "failure"; path: string; value: string; reason: string }>;
  messages: string[];
}

export interface ExtractResponse {
  durationMs: number;
  /** Extractor verdict per tool_result, keyed by event index. */
  outcomes: Record<string, ToolOutcome>;
  callLog: Pick<CallLog, "id" | "provider" | "kind" | "events" | "tools"> & { startedAt: string | null; notes: string | null; workflow: CallLog["workflow"] | null };
  findings: Finding[];
  fixture: ReplayFixture | null;
}

export interface FixtureSummary {
  ref: string;
  id: string;
  name: string;
  kind: string;
  valid: boolean;
  failures: string[];
  origin: "extractor" | "hand-written" | "unknown";
  error?: string;
}

export interface AgentInfo {
  id: string;
  label: string;
  description: string;
}

export interface ReplayResponse {
  durationMs: number;
  agents: string[];
  report: ReplayKitReport;
  html: string;
}

export type { GoldenPathResult, Step as GoldenStep } from "../../src/e2e/golden-path.js";
import type { GoldenPathResult } from "../../src/e2e/golden-path.js";
export type E2EResponse = GoldenPathResult & { example: string | null; durationMs: number };

export class ApiError extends Error {}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("Cannot reach the ReplayKit server. Start it with `npm run web` in replaykit-integrated.");
  }
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  calls: () => request<CallSummary[]>("/api/calls"),
  example: (name: string) => request<unknown>(`/api/example?name=${encodeURIComponent(name)}`),
  extract: (body: { log: unknown } | { example: string }) => request<ExtractResponse>("/api/extract", body),
  fixtures: () => request<FixtureSummary[]>("/api/fixtures"),
  fixture: (ref: string) => request<ReplayFixture>(`/api/fixture?ref=${encodeURIComponent(ref)}`),
  agents: () => request<AgentInfo[]>("/api/agents"),
  e2e: (body: { example?: string; log?: unknown } = {}) => request<E2EResponse>("/api/e2e", body),
  replay: (body: { fixture: ReplayFixture; agents: string[] } | { fixtureRef: string; agents: string[] }) => request<ReplayResponse>("/api/replay", body),
};
