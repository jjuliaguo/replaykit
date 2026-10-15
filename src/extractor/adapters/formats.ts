/**
 * Readers for call logs as real platforms produce them. Each reader:
 *   - recognizes its shape with `detect` (cheap, no throwing),
 *   - converts to the normalized CallLog,
 *   - records how it interpreted the log in `notes`, so a reader of the
 *     trace knows what came from where.
 *
 * Rules (from CONTEXT.md): tool calls and tool results are created only
 * where the log itself records them. Nothing is inferred from what the
 * agent said. A transcript with no tool data yields a call log with
 * messages only, which the detectors treat honestly (usually: no finding).
 *
 * Bland: fields follow the documented call-details response
 * (GET /v1/calls/{id}): `transcripts[]` with `user` in
 * user | assistant | robot | agent-action, plus `concatenated_transcript`.
 * Bland does not document structured tool-call fields; `agent-action`
 * entries whose text contains a JSON object are read as a tool result,
 * and the rest are kept as visible system notes.
 */
import type { CallEvent, CallLog, ToolDefinition } from "../../shared/types.js";
import type { JsonValue } from "../../shared/json.js";
import { isObject, isoTime, parseMaybeJson, pick, roleOf, textOf, type Role } from "./common.js";

export interface FormatReader {
  id: string;
  label: string;
  detect(data: unknown): boolean;
  read(data: unknown, fallbackId: string): CallLog;
}

function baseLog(id: string, provider: string, events: CallEvent[], extra: Partial<CallLog> = {}): CallLog {
  return { schemaVersion: "1.0", id, provider, kind: "recorded", tools: [], events, ...extra };
}

function idOf(obj: Record<string, unknown>, fallback: string): string {
  return pick(obj, ["call_id", "callId", "id", "c_id", "conversation_id", "session_id"]) ?? (typeof obj.call_id === "number" ? String(obj.call_id) : fallback);
}

/** Collect tool names seen in calls into minimal definitions. */
function toolsFrom(events: CallEvent[]): ToolDefinition[] {
  return [...new Set(events.flatMap((e) => (e.type === "tool_call" ? [e.toolName] : [])))].map((name) => ({ name }));
}

// ---------------------------------------------------------------------------
// Plain-text transcripts: "Agent: hello\nUser: hi". Common when copying from
// a dashboard, or Bland's concatenated_transcript.

/** Leading timestamps: "[00:08]", "14:02:11.5", "(2:03 PM)", "2026-10-15T14:00:01Z", "2026-10-15 14:00:01 -". */
const TIME_PREFIX = /^\s*[\[(]?(?:\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*(?:[AP]M)?)[\])]?\s*[-–|]?\s*/i;
const LINE = /^\s*[\[<]?([A-Za-z][\w .'-]{0,30}?)[\]>]?\s*[:：>]\s*(.*)$/;
/** Tool lines, with or without a colon: "TOOL_CALL book_appointment {...}", "Tool response (check_availability): {...}". */
const TOOL_LINE =
  /^\s*[\[<]?((?:tool|function|api|webhook|action)[ _-]?(?:call|request|invocation|invoke|response|result|output|returned|error|failure|timeout)?|tool)[\]>]?\b\s*((?:>>|<<|->|<-|→|←)?)\s*[:：>\-]?\s*(.*)$/i;

function stripTime(line: string): string {
  return line.replace(TIME_PREFIX, "");
}

function toolKindOf(label: string, rest: string, arrow = ""): "call" | "result" | "error" {
  const s = `${label} ${rest.slice(0, 60)}`.toLowerCase();
  const status = rest.match(/\b([45]\d\d)\b/);
  if (/(<<|<-|←)/.test(arrow)) return status || /(error|fail|timeout|timed.?out|exception)/.test(s) ? "error" : "result";
  if (/(>>|->|→)/.test(arrow)) return "call";
  if (/(error|fail|timeout|timed.?out|exception)/.test(s)) return "error";
  if (/(response|result|output|return|reply)/.test(s)) return "result";
  return "call";
}

export function readTranscriptText(text: string, id: string, provider = "transcript-text"): CallLog {
  const events: CallEvent[] = [];
  const unknownSpeakers = new Map<string, Role>();
  const open: Array<{ callId: string; toolName: string }> = [];
  let n = 0;
  let current: { role: Role; parts: string[] } | null = null;
  const flush = () => {
    if (current && current.parts.join(" ").trim()) events.push({ type: "message", role: current.role, content: current.parts.join(" ").trim() });
    current = null;
  };
  for (const original of text.split(/\r?\n/)) {
    const raw = stripTime(original);
    const tool = raw.match(TOOL_LINE);
    if (tool && (embeddedJson(tool[3] ?? "") || /^[A-Za-z_0-9][\w.-]*\b/.test(tool[3] ?? ""))) {
      flush();
      const rest = tool[3] ?? "";
      const arrow = tool[2] ?? "";
      const found = embeddedJson(rest);
      const before = found ? found.before : rest;
      const nameMatch = before.match(/([A-Za-z_][\w.-]{1,60})/);
      const kind = toolKindOf(tool[1]!, rest, arrow);
      const named = nameMatch && !/^(response|result|returned|error|call|request|with|the)$/i.test(nameMatch[1]!) ? nameMatch[1]! : undefined;
      if (kind === "call") {
        const callId = `line_${++n}`;
        const toolName = named ?? "tool";
        open.push({ callId, toolName });
        events.push({ type: "tool_call", callId, toolName, arguments: (found?.json ?? {}) as JsonValue });
      } else {
        const idx = named ? open.map((o) => o.toolName).lastIndexOf(named) : open.length - 1;
        const match = idx >= 0 ? open.splice(idx, 1)[0] : undefined;
        const callId = match?.callId ?? `line_${++n}`;
        const toolName = match?.toolName ?? named ?? "tool";
        if (!match) events.push({ type: "tool_call", callId, toolName, arguments: {} });
        const statusMatch = rest.match(/\b([1-5]\d\d)\b/);
        const status = statusMatch ? Number(statusMatch[1]) : undefined;
        if (found && status !== undefined) {
          // An HTTP response line: keep the recorded status and body as they are.
          events.push({ type: "tool_result", callId, toolName, response: { status, body: found.json } });
        } else if (kind === "error" || !found) {
          const message = found ? JSON.stringify(found.json) : rest.replace(named ?? "", "").replace(/^[\s:,-]+/, "") || "error";
          events.push({ type: "tool_result", callId, toolName, error: { kind: /time.?out/i.test(rest + tool[1]) ? "timeout" : "unknown", message } });
        } else {
          events.push({ type: "tool_result", callId, toolName, response: { body: found.json } });
        }
      }
      continue;
    }
    const m = raw.match(LINE);
    if (m) {
      const speaker = m[1]!.trim();
      let role = roleOf(speaker);
      if (!role) {
        // A named speaker ("Riley: ...") we can't classify: first unknown name is the agent.
        role = unknownSpeakers.get(speaker.toLowerCase()) ?? (unknownSpeakers.size === 0 ? "assistant" : "user");
        unknownSpeakers.set(speaker.toLowerCase(), role);
      }
      flush();
      current = { role, parts: [m[2] ?? ""] };
    } else if (raw.trim() && current) {
      (current as { parts: string[] }).parts.push(raw.trim());
    }
  }
  flush();
  const named = [...unknownSpeakers.entries()].map(([s, r]) => `"${s}" as ${r}`);
  const tools = events.filter((e) => e.type === "tool_call").length;
  return baseLog(id, provider, events, {
    tools: toolsFrom(events),
    notes:
      `Read as a plain-text transcript: ${events.filter((e) => e.type === "message").length} turns, ${tools ? `${tools} tool call(s) from tool lines` : "no tool data"}.` +
      (named.length ? ` Speakers mapped: ${named.join(", ")}.` : ""),
  });
}

export const transcriptText: FormatReader = {
  id: "transcript-text",
  label: "Plain-text transcript",
  detect: (d) => typeof d === "string" && d.split(/\r?\n/).map(stripTime).filter((l) => LINE.test(l) || TOOL_LINE.test(l)).length >= 2,
  read: (d, fallbackId) => readTranscriptText(d as string, fallbackId),
};

// ---------------------------------------------------------------------------
// Bland call details.

const BLAND_SPEAKERS = new Set(["user", "assistant", "robot", "agent-action"]);

function blandEntries(d: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const t = d.transcripts;
  if (!Array.isArray(t) || t.length === 0) return null;
  const ok = t.every((e) => isObject(e) && typeof e.text === "string" && typeof e.user === "string" && BLAND_SPEAKERS.has(e.user));
  return ok ? (t as Array<Record<string, unknown>>) : null;
}

/** First balanced {...} JSON object inside a string, if any. */
function embeddedJson(text: string): { json: JsonValue; before: string } | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return { json: JSON.parse(text.slice(start, i + 1)) as JsonValue, before: text.slice(0, start) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function blandToolName(before: string, index: number): string {
  const m = before.match(/(?:tool|webhook|function|action|api)\s*(?:call(?:ed)?|response|result)?\s*[:\-"'`(]?\s*([A-Za-z_][\w-]{1,60})/i);
  const name = m?.[1];
  return name && !/^(response|result|returned|called|with|the|a)$/i.test(name) ? name : `agent_action_${index}`;
}

export const bland: FormatReader = {
  id: "bland",
  label: "Bland call details",
  detect: (d) => isObject(d) && (blandEntries(d) !== null || (typeof d.concatenated_transcript === "string" && ("call_id" in d || "c_id" in d))),
  read: (d, fallbackId) => {
    const obj = d as Record<string, unknown>;
    const id = idOf(obj, fallbackId);
    const entries = blandEntries(obj);
    if (!entries) {
      const log = readTranscriptText(String(obj.concatenated_transcript), id, "bland");
      log.startedAt = isoTime(obj.started_at) ?? isoTime(obj.created_at);
      log.notes = `Read as Bland call details from concatenated_transcript (no transcripts array): ${log.events.length} turns, no tool data.`;
      return log;
    }
    const events: CallEvent[] = [];
    let actions = 0;
    let toolResults = 0;
    const sorted = [...entries].sort((a, b) => (isoTime(a.created_at) ?? "").localeCompare(isoTime(b.created_at) ?? "") || Number(a.id ?? 0) - Number(b.id ?? 0));
    sorted.forEach((e, i) => {
      const at = isoTime(e.created_at);
      const text = String(e.text);
      if (e.user === "agent-action") {
        actions++;
        const found = embeddedJson(text);
        if (found && isObject(found.json)) {
          // The log records an action with a structured payload: keep it as a tool result.
          toolResults++;
          const callId = `bland-action-${e.id ?? i}`;
          const toolName = blandToolName(found.before, toolResults);
          events.push({ type: "tool_call", callId, toolName, arguments: {}, ...(at ? { at } : {}) });
          events.push({ type: "tool_result", callId, toolName, response: { body: found.json }, ...(at ? { at } : {}) });
        } else {
          events.push({ type: "message", role: "system", content: `[agent action] ${text}`, ...(at ? { at } : {}) });
        }
        return;
      }
      const role: Role = e.user === "user" ? "user" : "assistant";
      events.push({ type: "message", role, content: text, ...(at ? { at } : {}) });
    });
    const robot = sorted.some((e) => e.user === "robot");
    return baseLog(id, "bland", events, {
      startedAt: isoTime(obj.started_at) ?? isoTime(obj.created_at),
      tools: toolsFrom(events),
      notes:
        `Read as Bland call details: ${sorted.length} transcript entries.` +
        (actions ? ` ${actions} agent action(s): ${toolResults} with a JSON payload read as tool results, the rest kept as system notes.` : " No agent actions, so no tool data.") +
        (robot ? ' Entries from "robot" were treated as the agent.' : "") +
        (isObject(obj.variables) && Object.keys(obj.variables).length ? " Bland's variables object is not read: it does not say which tool produced each value." : ""),
    });
  },
};

// ---------------------------------------------------------------------------
// Retell: transcript_with_tool_calls.

export const retell: FormatReader = {
  id: "retell",
  label: "Retell call",
  detect: (d) => isObject(d) && Array.isArray(d.transcript_with_tool_calls),
  read: (d, fallbackId) => {
    const obj = d as Record<string, unknown>;
    const events: CallEvent[] = [];
    for (const e of obj.transcript_with_tool_calls as unknown[]) {
      if (!isObject(e)) continue;
      const callId = pick(e, ["tool_call_id", "id"]) ?? `retell-${events.length}`;
      if (e.role === "tool_call_invocation") {
        events.push({ type: "tool_call", callId, toolName: pick(e, ["name"]) ?? "tool", arguments: parseMaybeJson(e.arguments ?? {}) });
      } else if (e.role === "tool_call_result") {
        events.push({ type: "tool_result", callId, response: { body: parseMaybeJson(e.content) } });
      } else {
        const role = roleOf(e.role);
        const text = textOf(e.content);
        if (role && text) events.push({ type: "message", role, content: text });
      }
    }
    return baseLog(pick(obj, ["call_id"]) ?? fallbackId, "retell", events, { tools: toolsFrom(events), notes: "Read as a Retell call (transcript_with_tool_calls)." });
  },
};

// ---------------------------------------------------------------------------
// Vapi: messages with role bot/user/tool_calls/tool_call_result.

function vapiMessages(d: unknown): unknown[] | null {
  if (!isObject(d)) return null;
  const msgs = (isObject(d.artifact) && Array.isArray(d.artifact.messages) ? d.artifact.messages : d.messages) as unknown;
  if (!Array.isArray(msgs)) return null;
  return msgs.some((m) => isObject(m) && (m.role === "bot" || m.role === "tool_calls" || m.role === "tool_call_result")) ? msgs : null;
}

export const vapi: FormatReader = {
  id: "vapi",
  label: "Vapi call",
  detect: (d) => vapiMessages(d) !== null,
  read: (d, fallbackId) => {
    const events: CallEvent[] = [];
    for (const m of vapiMessages(d)!) {
      if (!isObject(m)) continue;
      if (m.role === "tool_calls" && Array.isArray(m.toolCalls)) {
        for (const c of m.toolCalls) {
          if (!isObject(c) || !isObject(c.function)) continue;
          events.push({ type: "tool_call", callId: pick(c, ["id"]) ?? `vapi-${events.length}`, toolName: pick(c.function, ["name"]) ?? "tool", arguments: parseMaybeJson(c.function.arguments ?? {}) });
        }
      } else if (m.role === "tool_call_result") {
        events.push({ type: "tool_result", callId: pick(m, ["toolCallId", "tool_call_id"]) ?? `vapi-${events.length}`, ...(pick(m, ["name"]) ? { toolName: pick(m, ["name"]) } : {}), response: { body: parseMaybeJson(m.result) } });
      } else {
        const role = m.role === "bot" ? "assistant" : roleOf(m.role);
        const text = pick(m, ["message", "content"]);
        if (role && text) events.push({ type: "message", role, content: text });
      }
    }
    return baseLog(idOf(d as Record<string, unknown>, fallbackId), "vapi", events, { tools: toolsFrom(events), notes: "Read as a Vapi call (messages with bot / tool_calls / tool_call_result)." });
  },
};

// ---------------------------------------------------------------------------
// Generic message lists: a bare array, or an object holding one under a
// common key. Handles OpenAI-style tool_calls / role "tool", legacy
// function_call, and Anthropic tool_use / tool_result content blocks.

const LIST_KEYS = ["messages", "transcript", "conversation", "turns", "dialog", "dialogue", "utterances", "history", "chat", "events"];
const SPEAKER_KEYS = ["role", "speaker", "from", "author", "sender", "participant", "user", "party"];
const TEXT_KEYS = ["content", "text", "message", "utterance", "transcript", "body"];

function findList(d: unknown): { list: unknown[]; key: string | null; container: Record<string, unknown> | null } | null {
  if (Array.isArray(d)) return { list: d, key: null, container: null };
  if (!isObject(d)) return null;
  for (const k of LIST_KEYS) if (Array.isArray(d[k]) && (d[k] as unknown[]).length) return { list: d[k] as unknown[], key: k, container: d };
  // One level of wrapping: {call: {...}}, {data: {...}}.
  for (const v of Object.values(d)) {
    if (isObject(v)) for (const k of LIST_KEYS) if (Array.isArray(v[k]) && (v[k] as unknown[]).length) return { list: v[k] as unknown[], key: k, container: v };
  }
  return null;
}

function looksLikeMessages(list: unknown[]): boolean {
  const sample = list.filter(isObject).slice(0, 20);
  if (sample.length === 0) return false;
  const hits = sample.filter((m) => SPEAKER_KEYS.some((k) => typeof m[k] === "string") && (TEXT_KEYS.some((k) => m[k] !== undefined) || Array.isArray(m.tool_calls)));
  return hits.length / sample.length >= 0.6;
}

export const genericMessages: FormatReader = {
  id: "messages",
  label: "Message list",
  detect: (d) => {
    const f = findList(d);
    return !!f && looksLikeMessages(f.list);
  },
  read: (d, fallbackId) => {
    const { list, key, container } = findList(d)!;
    const events: CallEvent[] = [];
    const names = new Map<string, string>();
    const unknown = new Set<string>();
    let n = 0;
    const nextId = () => `call_${++n}`;
    for (const m of list) {
      if (!isObject(m)) continue;
      const speaker = SPEAKER_KEYS.map((k) => m[k]).find((v) => typeof v === "string") as string | undefined;
      const at = isoTime(m.created_at ?? m.timestamp ?? m.time ?? m.at);
      const stamp = at ? { at } : {};

      // OpenAI tool result / legacy function result.
      if (speaker === "tool" || speaker === "function") {
        const callId = pick(m, ["tool_call_id", "toolCallId", "id"]) ?? [...names.keys()].at(-1) ?? nextId();
        const toolName = pick(m, ["name"]) ?? names.get(callId);
        events.push({ type: "tool_result", callId, ...(toolName ? { toolName } : {}), response: { body: parseMaybeJson(textOf(m.content) ?? m.content) }, ...stamp });
        continue;
      }
      const role = roleOf(speaker) ?? (speaker ? (unknown.add(speaker), "assistant" as Role) : null);
      if (!role) continue;

      const content = TEXT_KEYS.map((k) => m[k]).find((v) => v !== undefined);
      // Anthropic content blocks.
      if (Array.isArray(content) && content.some((b) => isObject(b) && (b.type === "tool_use" || b.type === "tool_result"))) {
        for (const b of content) {
          if (!isObject(b)) continue;
          if (b.type === "text" && typeof b.text === "string" && b.text.trim()) events.push({ type: "message", role, content: b.text, ...stamp });
          else if (b.type === "tool_use") {
            const callId = pick(b, ["id"]) ?? nextId();
            const toolName = pick(b, ["name"]) ?? "tool";
            names.set(callId, toolName);
            events.push({ type: "tool_call", callId, toolName, arguments: (b.input ?? {}) as JsonValue, ...stamp });
          } else if (b.type === "tool_result") {
            const callId = pick(b, ["tool_use_id"]) ?? nextId();
            const body = parseMaybeJson(textOf(b.content) ?? b.content);
            events.push({
              type: "tool_result",
              callId,
              ...(names.get(callId) ? { toolName: names.get(callId) } : {}),
              ...(b.is_error === true ? { error: { kind: "unknown" as const, message: typeof body === "string" ? body : JSON.stringify(body) } } : { response: { body } }),
              ...stamp,
            });
          }
        }
        continue;
      }
      const text = textOf(content);
      if (text && text.trim()) events.push({ type: "message", role, content: text, ...stamp });
      // OpenAI tool_calls and legacy function_call on an assistant turn.
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : isObject(m.function_call) ? [{ function: m.function_call }] : [];
      for (const c of calls) {
        if (!isObject(c) || !isObject(c.function)) continue;
        const callId = pick(c, ["id"]) ?? nextId();
        const toolName = pick(c.function, ["name"]) ?? "tool";
        names.set(callId, toolName);
        events.push({ type: "tool_call", callId, toolName, arguments: parseMaybeJson(c.function.arguments ?? {}), ...stamp });
      }
    }
    const src = key ? `the "${key}" list` : "a JSON array";
    return baseLog(container ? idOf(container, fallbackId) : fallbackId, "messages", events, {
      tools: toolsFrom(events),
      notes:
        `Read as a message list from ${src}: ${events.filter((e) => e.type === "message").length} messages, ${events.filter((e) => e.type === "tool_call").length} tool calls.` +
        (unknown.size ? ` Unrecognized speakers treated as the agent: ${[...unknown].join(", ")}.` : ""),
    });
  },
};

// ---------------------------------------------------------------------------
// Generic event logs: {events: [...]} (or timeline/log/steps...) mixing
// messages, tool calls, and tool results, each identified by a `type`-like
// field or by which keys it carries. Common in custom agent logging and in
// hand-written incident logs.

const EVENT_LIST_KEYS = ["events", "timeline", "log", "logs", "steps", "trace", "history", "turns", "transcript", "messages", "items", "entries", "records"];
const TYPE_KEYS = ["type", "event", "event_type", "eventType", "kind", "action", "category"];
const TOOL_NAME_KEYS = ["tool", "tool_name", "toolName", "name", "function", "function_name", "functionName", "api", "endpoint", "webhook", "operation", "method_name"];
const ARG_KEYS = ["arguments", "args", "input", "params", "parameters", "payload", "request", "request_body", "body"];
const RESULT_KEYS = ["output", "result", "response", "response_body", "body", "data", "return", "returned", "returns", "api_response", "value"];
const CALL_ID_KEYS = ["tool_call_id", "toolCallId", "call_id", "callId", "invocation_id", "request_id", "id"];
const STATUS_KEYS = ["status_code", "statusCode", "http_status", "httpStatus", "status"];

type EventKind = "message" | "call" | "result" | "call+result" | null;

const META_KEYS = new Set([
  ...TYPE_KEYS, ...TOOL_NAME_KEYS, ...STATUS_KEYS, ...CALL_ID_KEYS,
  "timestamp", "time", "created_at", "createdAt", "at", "ts", "t", "offset", "elapsed", "seq", "sequence", "index",
  "role", "speaker", "from", "source", "error", "elapsed_ms", "duration_ms", "latency_ms", "latencyMs",
]);

/** Fields left after removing descriptive ones: the event's own payload when it has no args/output field. */
function restFields(e: Record<string, unknown>): Record<string, JsonValue> | undefined {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(e)) if (!META_KEYS.has(k) && v !== undefined) out[k] = v as JsonValue;
  return Object.keys(out).length ? out : undefined;
}

function latencyOf(e: Record<string, unknown>): number | undefined {
  for (const k of ["latency_ms", "latencyMs", "elapsed_ms", "duration_ms"]) if (typeof e[k] === "number" && (e[k] as number) >= 0) return e[k] as number;
  return undefined;
}

/** Error text including the event's other diagnostic fields, e.g. "TIMEOUT_ERROR (elapsed_ms: 10000, operation_status: unknown)". */
function errorMessage(err: unknown, e: Record<string, unknown>): string {
  const base = typeof err === "string" ? err : err ? JSON.stringify(err) : "error";
  const extra = Object.entries(e)
    .filter(([k, v]) => !TYPE_KEYS.includes(k) && !TOOL_NAME_KEYS.includes(k) && !["error", "timestamp", "time", "at", "ts"].includes(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .map(([k, v]) => `${k}: ${v}`);
  return extra.length ? `${base} (${extra.join(", ")})` : base;
}

function typeOf(e: Record<string, unknown>): string {
  return (TYPE_KEYS.map((k) => e[k]).find((v) => typeof v === "string") as string | undefined)?.toLowerCase() ?? "";
}

function toolNameOf(e: Record<string, unknown>): string | undefined {
  for (const k of TOOL_NAME_KEYS) {
    const v = e[k];
    if (typeof v === "string" && v.trim() && !/\s/.test(v.trim())) return v.trim();
    if (isObject(v) && typeof v.name === "string") return v.name;
  }
  return undefined;
}

function firstPresent(e: Record<string, unknown>, keys: string[]): { key: string; value: unknown } | undefined {
  for (const k of keys) if (e[k] !== undefined && e[k] !== null && e[k] !== "") return { key: k, value: e[k] };
  return undefined;
}

function classifyEvent(e: Record<string, unknown>): { kind: EventKind; role?: Role } {
  const t = typeOf(e);
  const hasText = TEXT_KEYS.some((k) => typeof e[k] === "string" && (e[k] as string).trim());
  const speaker = SPEAKER_KEYS.map((k) => e[k]).find((v) => typeof v === "string") as string | undefined;
  const toolish = /(tool|function|api|webhook|http|action|integration|plugin|request|call(?!er))/;
  if (t) {
    if (toolish.test(t) && /(result|response|output|return|reply|complete|done|finish|error|fail)/.test(t)) return { kind: "result" };
    if (toolish.test(t) || /^(call|invoke|invocation)$/.test(t)) {
      return { kind: firstPresent(e, RESULT_KEYS.filter((k) => k !== "body")) || firstPresent(e, ["error"]) ? "call+result" : "call" };
    }
    if (/(error|fail|timeout|timed_out)/.test(t) && toolNameOf(e)) return { kind: "result" };
    if (/(user|caller|customer|human|client|patient)/.test(t)) return { kind: "message", role: "user" };
    if (/(agent|assistant|bot|ai|llm|model|robot)/.test(t)) return { kind: "message", role: "assistant" };
    if (/(system|note|instruction)/.test(t)) return { kind: "message", role: "system" };
    if (/(message|utterance|speech|transcript|turn|said|say)/.test(t) && hasText) return { kind: "message", role: roleOf(speaker) ?? "assistant" };
  }
  if (speaker && hasText) return { kind: "message", role: roleOf(speaker) ?? "assistant" };
  if (speaker === "tool" || speaker === "function") return { kind: "result" };
  if (toolNameOf(e) && firstPresent(e, ARG_KEYS)) return { kind: firstPresent(e, RESULT_KEYS.filter((k) => k !== "body")) ? "call+result" : "call" };
  return { kind: null };
}

function findEventList(d: unknown): { list: Array<Record<string, unknown>>; key: string; container: Record<string, unknown> } | null {
  const candidates: Array<Record<string, unknown>> = isObject(d) ? [d, ...Object.values(d).filter(isObject)] : [];
  for (const c of candidates) {
    for (const k of EVENT_LIST_KEYS) {
      const v = c[k];
      if (Array.isArray(v) && v.length && v.every(isObject)) return { list: v as Array<Record<string, unknown>>, key: k, container: c };
    }
  }
  if (Array.isArray(d) && d.length && d.every(isObject)) return { list: d as Array<Record<string, unknown>>, key: "(root array)", container: {} };
  return null;
}

/** Normalize a recorded tool response into {status?, body}. */
function responseOf(raw: unknown, e: Record<string, unknown>): { status?: number; body: JsonValue } {
  let body: unknown = raw;
  let status: number | undefined;
  if (isObject(raw) && ("body" in raw || "status" in raw || "status_code" in raw) && Object.keys(raw).every((k) => ["body", "status", "status_code", "statusCode", "headers", "latency_ms", "latencyMs"].includes(k))) {
    body = raw.body ?? null;
    const s = raw.status ?? raw.status_code ?? raw.statusCode;
    if (typeof s === "number") status = s;
  }
  for (const k of STATUS_KEYS) {
    const v = e[k];
    if (status === undefined && typeof v === "number" && v >= 100 && v <= 599) status = v;
  }
  return { ...(status !== undefined ? { status } : {}), body: parseMaybeJson(body) };
}

export const eventLog: FormatReader = {
  id: "event-log",
  label: "Event log",
  detect: (d) => {
    const f = findEventList(d);
    if (!f) return false;
    const kinds = f.list.slice(0, 50).map((e) => classifyEvent(e).kind);
    const known = kinds.filter(Boolean).length;
    return kinds.includes("message") && known / kinds.length >= 0.5;
  },
  read: (d, fallbackId) => {
    const { list, key, container } = findEventList(d)!;
    const events: CallEvent[] = [];
    const open: Array<{ callId: string; toolName: string }> = [];
    let n = 0;
    let skipped = 0;
    const skippedTypes = new Set<string>();
    const noted = new Set<string>();
    const synthesizedCalls: string[] = [];
    for (const e of list) {
      const { kind, role } = classifyEvent(e);
      const at = isoTime(e.timestamp ?? e.time ?? e.created_at ?? e.createdAt ?? e.at ?? e.ts);
      const stamp = at ? { at } : {};
      if (kind === "message") {
        const text = textOf(firstPresent(e, TEXT_KEYS)?.value);
        if (text?.trim()) events.push({ type: "message", role: role ?? "assistant", content: text, ...stamp });
        else skipped++;
        continue;
      }
      if (kind === "call" || kind === "call+result") {
        const toolName = toolNameOf(e) ?? "tool";
        const callId = pick(e, CALL_ID_KEYS) ?? `call_${++n}`;
        const args = firstPresent(e, ARG_KEYS);
        const argsValue = args?.value ?? (kind === "call" ? restFields(e) : undefined) ?? {};
        events.push({ type: "tool_call", callId, toolName, arguments: parseMaybeJson(argsValue), ...stamp });
        if (kind === "call+result") {
          const res = firstPresent(e, RESULT_KEYS.filter((k) => k !== "body"));
          const err = e.error;
          events.push({
            type: "tool_result",
            callId,
            toolName,
            ...(res ? { response: responseOf(res.value, e) } : {}),
            ...(!res && err ? { error: { kind: /time.?out/i.test(String(err)) ? ("timeout" as const) : ("unknown" as const), message: errorMessage(err, e) } } : {}),
            ...stamp,
          });
        } else open.push({ callId, toolName });
        continue;
      }
      if (kind === "result") {
        const name = toolNameOf(e);
        const explicit = pick(e, CALL_ID_KEYS.filter((k) => k !== "id"));
        // Pair with the matching open call: by id, else the latest call to the same tool, else the latest call.
        const idx = explicit ? open.findIndex((o) => o.callId === explicit) : name ? open.map((o) => o.toolName).lastIndexOf(name) : open.length - 1;
        const match = idx >= 0 ? open.splice(idx, 1)[0] : undefined;
        const callId = match?.callId ?? explicit ?? `result_${++n}`;
        const toolName = match?.toolName ?? name;
        const res = firstPresent(e, RESULT_KEYS);
        const err = e.error;
        const timedOut = /time.?out/i.test(typeOf(e)) || /time.?out/i.test(String(err ?? ""));
        const isError = !!err || timedOut || /(error|fail)/.test(typeOf(e));
        const inline = !res && !isError ? restFields(e) : undefined;
        if (!match) {
          // The log records a response with no request event. The response proves the call happened;
          // add the call (with no arguments) so the pair is replayable, and say so in the notes.
          events.push({ type: "tool_call", callId, toolName: toolName ?? "tool", arguments: {}, ...stamp });
          synthesizedCalls.push(toolName ?? "tool");
        }
        events.push({
          type: "tool_result",
          callId,
          ...(toolName ? { toolName } : {}),
          ...(res && !isError ? { response: { ...responseOf(res.value, e), ...(latencyOf(e) !== undefined ? { latencyMs: latencyOf(e) } : {}) } } : {}),
          ...(inline ? { response: { ...responseOf(inline, e), ...(latencyOf(e) !== undefined ? { latencyMs: latencyOf(e) } : {}) } } : {}),
          ...(isError ? { error: { kind: timedOut ? ("timeout" as const) : ("unknown" as const), message: errorMessage(err ?? typeOf(e), e) } } : {}),
          ...stamp,
        });
        continue;
      }
      const t = typeOf(e);
      const data = restFields(e);
      if (t && data) {
        // Not a message or a tool call (e.g. a post-call verification): keep it visible, never as a tool call.
        events.push({ type: "message", role: "system", content: `[${t}] ${Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}`, ...stamp });
        noted.add(t);
        continue;
      }
      skipped++;
      if (t) skippedTypes.add(t);
    }
    // A tool_result needs a response or an error; drop empty ones rather than invent content.
    const cleaned = events.filter((ev) => ev.type !== "tool_result" || ev.response || ev.error);
    const orphanCalls = new Set(cleaned.filter((ev) => ev.type === "tool_result").map((ev) => (ev as { callId: string }).callId));
    const usedLabel = isObject(container.failure) || typeof container.failure === "string";
    return baseLog(idOf(container, fallbackId), "event-log", cleaned, {
      tools: toolsFrom(cleaned),
      startedAt: isoTime(container.started_at ?? container.start_time ?? container.created_at ?? container.timestamp),
      notes:
        `Read as an event log from the "${key}" list: ${cleaned.filter((e) => e.type === "message").length} messages, ` +
        `${cleaned.filter((e) => e.type === "tool_call").length} tool calls, ${orphanCalls.size} tool results.` +
        (synthesizedCalls.length ? ` ${synthesizedCalls.join(", ")} had a response but no request event, so a call with unknown arguments was added for it.` : "") +
        (noted.size ? ` Other events kept as notes: ${[...noted].join(", ")}.` : "") +
        (skipped ? ` ${skipped} event(s) not recognized and skipped${skippedTypes.size ? ` (types: ${[...skippedTypes].slice(0, 6).join(", ")})` : ""}.` : "") +
        (usedLabel ? " The log's own \"failure\" label was ignored: ReplayKit judges only from the recorded evidence." : ""),
    });
  },
};

/** Tried in order after the native CallLog and strict OpenAI formats. */
export const READERS: FormatReader[] = [bland, retell, vapi, genericMessages, eventLog, transcriptText];
