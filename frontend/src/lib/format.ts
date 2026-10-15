import type { CallEvent, Finding } from "../api";

export const FAILURE_LABEL: Record<Finding["type"], string> = {
  false_success_claim: "False success claim",
  unverified_success_claim: "Unverified success claim",
  tool_result_misread: "Contradicts tool result",
  unhandled_tool_error: "Unhandled tool error",
};

export const EXPECTATION_LABEL: Record<string, string> = {
  tool_called: "tool_called",
  no_success_claim: "no_success_claim",
  acknowledges_failure: "acknowledges_failure",
  consistent_with_tool_result: "consistent_with_tool_result",
  rubric: "rubric",
};

/** Structural JSON equality (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Read a dot path ("response.body.success") from a value. */
export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function statusTone(status: number | undefined): "ok" | "err" | "warn" | "none" {
  if (status === undefined) return "none";
  if (status >= 500 || status >= 400) return "err";
  if (status >= 300) return "warn";
  return "ok";
}

export const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Unavailable",
  504: "Gateway Timeout",
};

/** Build a shell command that re-sends a recorded request, for reproducing against a real endpoint. */
export function toCurl(request: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown } | undefined): string | null {
  if (!request?.url) return null;
  const parts = [`curl -X ${request.method ?? "POST"} '${request.url}'`];
  for (const [k, v] of Object.entries(request.headers ?? {})) {
    parts.push(v === "[REDACTED]" ? `-H '${k}: <redacted: supply your own>'` : `-H '${k}: ${v.replaceAll("'", "'\\''")}'`);
  }
  if (request.body !== undefined) parts.push(`--data '${JSON.stringify(request.body).replaceAll("'", "'\\''")}'`);
  return parts.join(" \\\n  ");
}

export interface ToolPair {
  callIndex: number;
  resultIndex: number | null;
  call: Extract<CallEvent, { type: "tool_call" }>;
  result: Extract<CallEvent, { type: "tool_result" }> | null;
}

/** Group a call log into display rows: messages, and tool calls paired with their results. */
export type TraceRow = { kind: "message"; index: number; event: Extract<CallEvent, { type: "message" }> } | { kind: "tool"; pair: ToolPair } | { kind: "orphan"; index: number; event: CallEvent };

export function traceRows(events: CallEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  const resultFor = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.type === "tool_result" && !resultFor.has(e.callId)) resultFor.set(e.callId, i);
  });
  // A result is shown inside its call's row; results with no call stay visible as orphans.
  const callIds = new Set(events.flatMap((e) => (e.type === "tool_call" ? [e.callId] : [])));
  const consumed = new Set([...resultFor.entries()].filter(([id]) => callIds.has(id)).map(([, i]) => i));
  events.forEach((e, i) => {
    if (e.type === "message") rows.push({ kind: "message", index: i, event: e });
    else if (e.type === "tool_call") {
      const ri = resultFor.get(e.callId);
      const r = ri !== undefined ? events[ri] : undefined;
      rows.push({ kind: "tool", pair: { callIndex: i, resultIndex: ri ?? null, call: e, result: r && r.type === "tool_result" ? r : null } });
    } else if (!consumed.has(i)) rows.push({ kind: "orphan", index: i, event: e });
  });
  return rows;
}
