/**
 * Classifies a tool result as success, failure, or unknown, using only
 * generic conventions (HTTP status, transport errors, and common result
 * fields such as success/ok/status/error). Nothing here knows about any
 * specific tool.
 *
 * "unknown" is a first-class answer. A 200 response with no recognizable
 * result field is NOT assumed to be a success or a failure, so detectors
 * that need an explicit failure will not fire on it. This trades recall for
 * precision: we would rather miss a failure than invent one.
 */
import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json.js";
import type { ToolResultEvent } from "../../shared/types.js";

export type Outcome = "success" | "failure" | "unknown";

export interface OutcomeSignal {
  outcome: "success" | "failure";
  /** Path inside the tool_result event, e.g. "response.body.success". */
  path: string;
  value: string;
  reason: string;
}

export interface ToolOutcome {
  outcome: Outcome;
  signals: OutcomeSignal[];
  /** Human-readable strings from the response (message, error, reason...). */
  messages: string[];
}

const FLAG_KEYS = new Set(["success", "ok", "succeeded", "successful"]);
const STATUS_KEYS = new Set(["status", "state", "result", "outcome"]);
const ERROR_KEYS = new Set(["error", "errors", "error_message", "errormessage", "error_code", "errorcode", "failure_reason"]);
const MESSAGE_KEYS = new Set(["message", "error", "error_message", "errormessage", "reason", "detail", "details", "failure_reason"]);
const NESTED_KEYS = new Set(["data", "result", "response", "payload"]);
/** Numeric HTTP-style codes inside the body, e.g. {"status": 409} or {"statusCode": 500}. */
const STATUS_CODE_KEYS = new Set(["status", "status_code", "statuscode", "http_status"]);
/**
 * Plain-text tool results that start like an error. Agent frameworks commonly
 * return tool exceptions this way ("Error: connection refused").
 */
const ERROR_TEXT = /^\s*(?:error|exception|failed|failure)\b\s*[:\-]?/i;

const FAILURE_STATUS =
  /^(error|errored|fail|failed|failure|rejected|declined|denied|unavailable|invalid|not_found|timeout|timed_out|conflict)$/i;
const SUCCESS_STATUS = /^(ok|success|succeeded|successful|confirmed|completed|complete|created|booked|done|approved|accepted)$/i;

function render(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isEmpty(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === false || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isJsonObject(value)) return Object.keys(value).length === 0;
  return false;
}

function scanObject(obj: JsonObject, basePath: string, signals: OutcomeSignal[], messages: string[], depth: number): void {
  for (const [rawKey, value] of Object.entries(obj)) {
    const key = rawKey.toLowerCase();
    const path = `${basePath}.${rawKey}`;
    const flag = typeof value === "boolean" ? value : typeof value === "string" && /^(true|false)$/i.test(value) ? value.toLowerCase() === "true" : null;
    if (FLAG_KEYS.has(key) && flag !== null) {
      signals.push({ outcome: flag ? "success" : "failure", path, value: String(value), reason: `${rawKey} is ${JSON.stringify(value)}` });
    } else if (STATUS_CODE_KEYS.has(key) && typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) {
      signals.push({ outcome: "failure", path, value: String(value), reason: `${rawKey} is ${value}` });
    } else if (STATUS_KEYS.has(key) && typeof value === "string") {
      if (FAILURE_STATUS.test(value)) signals.push({ outcome: "failure", path, value, reason: `${rawKey} is "${value}"` });
      else if (SUCCESS_STATUS.test(value)) signals.push({ outcome: "success", path, value, reason: `${rawKey} is "${value}"` });
    } else if (ERROR_KEYS.has(key) && !isEmpty(value)) {
      signals.push({ outcome: "failure", path, value: render(value), reason: `${rawKey} is present` });
    }
    if (MESSAGE_KEYS.has(key) && typeof value === "string" && value.trim()) messages.push(value.trim());
    if (key === "error" && isJsonObject(value)) {
      for (const inner of ["message", "detail", "reason"]) {
        const v = value[inner];
        if (typeof v === "string" && v.trim()) messages.push(v.trim());
      }
    }
    if (depth === 0 && NESTED_KEYS.has(key) && isJsonObject(value)) scanObject(value, path, signals, messages, depth + 1);
  }
}

export function classifyToolResult(result: ToolResultEvent | null): ToolOutcome {
  const signals: OutcomeSignal[] = [];
  const messages: string[] = [];
  if (result === null) return { outcome: "unknown", signals, messages };

  if (result.error) {
    signals.push({ outcome: "failure", path: "error.kind", value: result.error.kind, reason: `tool call failed: ${result.error.kind}` });
    messages.push(result.error.message);
  }
  const status = result.response?.status;
  if (status !== undefined && status >= 400) {
    signals.push({ outcome: "failure", path: "response.status", value: String(status), reason: `HTTP ${status}` });
  }
  const body = result.response?.body;
  if (isJsonObject(body)) scanObject(body, "response.body", signals, messages, 0);
  else if (typeof body === "string" && body.trim()) {
    if (ERROR_TEXT.test(body)) {
      signals.push({ outcome: "failure", path: "response.body", value: body.trim().slice(0, 200), reason: "result text reports an error" });
      messages.push(body.trim());
    } else if (status !== undefined && status >= 400) messages.push(body.trim());
  }

  const hasFailure = signals.some((s) => s.outcome === "failure");
  const hasSuccess = signals.some((s) => s.outcome === "success");
  // Any explicit failure wins: an app-level failure inside an HTTP 200 is still a failure.
  const outcome: Outcome = hasFailure ? "failure" : hasSuccess ? "success" : "unknown";
  return { outcome, signals, messages: [...new Set(messages)] };
}
