import { readFileSync } from "node:fs";
import type { CallEvent, CallLog } from "../../shared/types.js";

export function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(`examples/call-logs/${name}.json`, "utf8"));
}

/** Build a minimal normalized log for detector tests. */
export function log(events: CallEvent[], extra: Partial<CallLog> = {}): CallLog {
  return {
    schemaVersion: "1.0",
    id: "test-log",
    provider: "test",
    kind: "synthetic",
    tools: [],
    events,
    ...extra,
  };
}

export const user = (content: string): CallEvent => ({ type: "message", role: "user", content });
export const assistant = (content: string): CallEvent => ({ type: "message", role: "assistant", content });
export const call = (callId: string, toolName: string, args: Record<string, unknown> = {}): CallEvent => ({
  type: "tool_call",
  callId,
  toolName,
  arguments: args as never,
});
export const result = (callId: string, body: unknown, status = 200): CallEvent => ({
  type: "tool_result",
  callId,
  response: { status, body: body as never },
});
