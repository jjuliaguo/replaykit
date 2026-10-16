/**
 * Universal reader: understands call logs in formats nobody wrote a reader for.
 *
 * Two steps, kept separate on purpose:
 *   1. A FieldMapping says where the events are and which field means what
 *      (type, speaker, text, tool name, arguments, response, status, error),
 *      inferred from field statistics (inferMapping).
 *   2. applyMapping reads every value straight from the log. A mapping only
 *      names fields; it cannot add content, so every message and tool
 *      response in the result is verbatim from the log.
 * Formats this can't map go to the optional LLM normalizer (llm-normalizer.ts).
 */
import type { JsonValue } from "../../shared/json.js";
import type { CallLog } from "../../shared/types.js";
import { isObject, roleOf } from "./common.js";
import { eventLog } from "./formats.js";

export type EventKind = "user" | "assistant" | "system" | "tool_call" | "tool_result" | "tool_error" | "other";

export interface FieldMapping {
  /** Dot path from the root to the array of events. "" means the root is the array. */
  eventsPath: string;
  /** Field whose value says what kind of event this is, with value -> kind. */
  kindField?: string | null;
  kinds?: Record<string, EventKind>;
  /** Field naming the speaker, with value -> kind (user/assistant/system/tool_call/...). */
  speakerField?: string | null;
  speakers?: Record<string, EventKind>;
  textField?: string | null;
  toolNameField?: string | null;
  /** null: the event's remaining fields are the arguments / response. */
  argsField?: string | null;
  resultField?: string | null;
  statusField?: string | null;
  errorField?: string | null;
  callIdField?: string | null;
  timeField?: string | null;
  /** Who produced this mapping, for the notes. */
  source: "inferred" | "llm";
}

// ---------------------------------------------------------------------------
// Locating the event list.

export function getPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (isObject(cur)) cur = cur[part];
    else if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else return undefined;
  }
  return cur;
}

/** Flatten one level of nesting: {message: {role, text}} -> {"message.role", "message.text"}. */
function flatten(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    out[k] = v;
    if (isObject(v) && Object.keys(v).length <= 12) for (const [k2, v2] of Object.entries(v)) if (!(`${k}.${k2}` in out)) out[`${k}.${k2}`] = v2;
  }
  return out;
}

/** Score an array as "the conversation": object items carrying human-readable text. */
function scoreList(list: unknown[]): number {
  const objs = list.filter(isObject);
  if (objs.length === 0) {
    const strings = list.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    return strings.length >= 2 ? strings.length * 0.5 : 0;
  }
  let textual = 0;
  for (const o of objs.slice(0, 60)) {
    const f = flatten(o);
    if (Object.values(f).some((v) => typeof v === "string" && v.trim().split(/\s+/).length >= 3)) textual++;
  }
  return textual + objs.length * 0.1;
}

/** Breadth-first search (depth <= 4) for the array that best looks like the call's events. */
export function findBestList(root: unknown): { path: string; list: unknown[] } | null {
  let best: { path: string; list: unknown[]; score: number } | null = null;
  const queue: Array<{ v: unknown; path: string; depth: number }> = [{ v: root, path: "", depth: 0 }];
  while (queue.length) {
    const { v, path, depth } = queue.shift()!;
    if (Array.isArray(v)) {
      const s = scoreList(v);
      if (s > 0 && (!best || s > best.score)) best = { path, list: v, score: s };
      if (depth < 4) v.slice(0, 3).forEach((x, i) => isObject(x) && queue.push({ v: x, path: path ? `${path}.${i}` : String(i), depth: depth + 1 }));
    } else if (isObject(v) && depth < 4) {
      for (const [k, x] of Object.entries(v)) if (typeof x === "object" && x !== null) queue.push({ v: x, path: path ? `${path}.${k}` : k, depth: depth + 1 });
    }
  }
  return best ? { path: best.path, list: best.list } : null;
}

// ---------------------------------------------------------------------------
// Inferring the mapping from field statistics.

const TOOLISH = /(tool|function|func\b|(^|[._\s-])fn([._\s-]|$)|api|webhook|http|integration|plugin|rpc|skill|action_call|request|invoke|invocation)/i;

function kindFromLabel(label: string): EventKind | null {
  const t = label.toLowerCase();
  if (TOOLISH.test(t) && /(error|fail|timeout|timed.?out|exception)/.test(t)) return "tool_error";
  if (TOOLISH.test(t) && /(result|response|output|return|reply|complete|done|finish|success|end|stop)/.test(t)) return "tool_result";
  if (TOOLISH.test(t) || /^(call|invoke)$/.test(t)) return "tool_call";
  const r = roleOf(t);
  if (r) return r;
  if (/(user|caller|customer|human|client|patient|guest|inbound|asr|stt|heard|transcription|speech_in|input_audio)/.test(t)) return "user";
  if (/(agent|assistant|bot|ai|llm|model|robot|outbound|rep|tts|say|said|speak|utter)\b|^(agent|assistant|bot|tts|say)/.test(t)) return "assistant";
  if (/(system|note|instruction|prompt)/.test(t)) return "system";
  return null;
}

interface FieldStats {
  presence: number;
  strings: number;
  distinct: Set<string>;
  avgLen: number;
  numbers: number;
  /** String values containing whitespace: speech, not identifiers like "reschedule_appointment". */
  prose: number;
}

function stats(items: Array<Record<string, unknown>>): Map<string, FieldStats> {
  const m = new Map<string, FieldStats>();
  for (const it of items) {
    for (const [k, v] of Object.entries(it)) {
      const s = m.get(k) ?? { presence: 0, strings: 0, distinct: new Set<string>(), avgLen: 0, numbers: 0, prose: 0 };
      s.presence++;
      if (typeof v === "string") {
        s.avgLen = (s.avgLen * s.strings + v.length) / (s.strings + 1);
        s.strings++;
        if (/\s/.test(v.trim())) s.prose++;
        if (s.distinct.size < 50) s.distinct.add(v);
      } else if (typeof v === "number") s.numbers++;
      m.set(k, s);
    }
  }
  return m;
}

const NAME_PREFS = {
  kind: ["type", "event", "event_type", "eventType", "kind", "action", "category"],
  speaker: ["role", "speaker", "from", "author", "sender", "participant", "user", "party", "who", "actor", "source"],
  text: ["content", "text", "message", "utterance", "transcript", "said", "speech", "body"],
  tool: ["tool", "tool_name", "toolName", "name", "function", "function_name", "api", "endpoint", "webhook", "operation"],
  args: ["arguments", "args", "input", "params", "parameters", "payload", "request", "request_data", "request_body", "inputs"],
  result: ["output", "result", "response", "response_body", "response_data", "returned", "return", "outputs", "data"],
  status: ["status_code", "statusCode", "http_status", "httpStatus", "response_status", "status"],
  error: ["error", "error_message", "errorMessage", "exception", "failure_reason"],
  callId: ["tool_call_id", "toolCallId", "call_id", "invocation_id", "request_id", "id"],
  time: ["timestamp", "time", "created_at", "createdAt", "at", "ts", "t", "offset"],
};

function prefer(
  fields: Map<string, FieldStats>,
  names: string[],
  ok: (s: FieldStats, k: string) => boolean = () => true,
  suffix = false,
): string | null {
  for (const n of names) for (const k of fields.keys()) if ((k === n || k.endsWith(`.${n}`) || (suffix && k.endsWith(`_${n}`))) && ok(fields.get(k)!, k)) return k;
  return null;
}

export function inferMapping(root: unknown): FieldMapping | null {
  const found = findBestList(root);
  return found ? inferMappingFor(found.path, found.list) : null;
}

export function inferMappingFor(path: string, listIn: unknown[]): FieldMapping | null {
  const found = { path, list: listIn };
  if (!found) return null;
  const items = found.list.filter(isObject).map(flatten);
  if (items.length === 0) return null;
  const f = stats(items);
  const n = items.length;
  const lowCard = (s: FieldStats) => s.strings >= n * 0.5 && s.distinct.size <= Math.max(12, Math.ceil(n / 2)) && s.avgLen <= 40;

  // Speech text is prose: a field of identifiers (tool names, ids) is never the text.
  const textField =
    prefer(f, NAME_PREFS.text, (s) => s.strings >= 1 && s.avgLen >= 8 && s.prose > 0) ??
    [...f.entries()].filter(([, s]) => s.strings >= Math.max(1, n * 0.3) && s.avgLen >= 15 && s.prose >= s.strings * 0.5).sort((a, b) => b[1].avgLen - a[1].avgLen)[0]?.[0] ??
    null;

  // Kind / speaker: low-cardinality string fields whose values read as roles or event kinds.
  const labelScore = (k: string) => [...f.get(k)!.distinct].filter((v) => kindFromLabel(v)).length;
  const candidates = [...f.entries()].filter(([k, s]) => k !== textField && lowCard(s) && labelScore(k) > 0).map(([k]) => k);
  const kindField = prefer(f, NAME_PREFS.kind, (s, k) => k !== textField && lowCard(s)) ?? candidates.sort((a, b) => labelScore(b) - labelScore(a))[0] ?? null;
  const speakerField = prefer(f, NAME_PREFS.speaker, (s, k) => k !== textField && k !== kindField && lowCard(s)) ?? candidates.find((k) => k !== kindField) ?? null;

  const labelMap = (field: string | null): Record<string, EventKind> => {
    if (!field) return {};
    const out: Record<string, EventKind> = {};
    const unknown: string[] = [];
    for (const v of f.get(field)!.distinct) {
      const k = kindFromLabel(v);
      if (k) out[v] = k;
      else unknown.push(v);
    }
    // Named speakers ("Riley", "Jordan"): if exactly one is unclassified and a user exists, it is the agent.
    const kinds = new Set(Object.values(out));
    if (unknown.length === 1 && kinds.has("user") && !kinds.has("assistant")) out[unknown[0]!] = "assistant";
    for (const v of unknown) out[v] ??= "other";
    return out;
  };

  return {
    eventsPath: found.path,
    kindField,
    kinds: labelMap(kindField),
    speakerField,
    speakers: labelMap(speakerField),
    textField,
    toolNameField: prefer(f, NAME_PREFS.tool, (s, k) => k !== textField && k !== kindField && k !== speakerField && s.strings > 0 && s.avgLen <= 60),
    argsField: prefer(f, NAME_PREFS.args, (_s, k) => k !== textField, true),
    resultField: prefer(f, NAME_PREFS.result, (_s, k) => k !== textField, true),
    statusField: prefer(f, NAME_PREFS.status, (s) => s.numbers > 0, true),
    errorField: prefer(f, NAME_PREFS.error),
    callIdField: prefer(f, NAME_PREFS.callId, (_s, k) => k !== "id" || !!prefer(f, ["tool_call_id", "toolCallId"])),
    timeField: prefer(f, NAME_PREFS.time),
    source: "inferred",
  };
}

/** Parse JSON text when it is JSON; otherwise keep the string. */
function parseLoose(text: string): JsonValue {
  const s = text.trim();
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s) as JsonValue;
    } catch {
      /* keep text */
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Companion lists: some exports keep the transcript and the tool activity in
// separate arrays. When every item in both carries a timestamp, merge them in
// time order so tool results line up with what the agent said next.

const TIME_KEYS = ["timestamp", "time", "created_at", "createdAt", "at", "ts", "t", "start_time", "startTime", "start", "time_unix_nano", "startTimeUnixNano"];

function timeValue(item: Record<string, unknown>): number | null {
  for (const k of TIME_KEYS) {
    const v = item[k];
    if (typeof v === "number" && Number.isFinite(v)) return v > 1e17 ? v / 1e6 : v > 1e14 ? v / 1e3 : v > 1e11 ? v : v * 1000;
    if (typeof v === "string") {
      const d = Date.parse(v);
      if (!Number.isNaN(d)) return d;
      const rel = v.match(/^\+?(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
      if (rel) return ((Number(rel[1] ?? 0) * 60 + Number(rel[2])) * 60 + Number(rel[3])) * 1000;
    }
  }
  return null;
}

export function mergedEvents(root: unknown): { path: string; list: Array<Record<string, unknown>> } | null {
  const best = findBestList(root);
  if (!best) return null;
  const parentPath = best.path.split(".").slice(0, -1).join(".");
  const parent = getPath(root, parentPath);
  if (!isObject(parent)) return null;
  const lists = Object.entries(parent).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isObject)) as Array<[string, Array<Record<string, unknown>>]>;
  if (lists.length < 2) return null;
  if (!lists.every(([, l]) => l.every((it) => timeValue(it) !== null))) return null;
  const merged = lists.flatMap(([, l]) => l).sort((a, b) => timeValue(a)! - timeValue(b)!);
  return { path: `${parentPath ? `${parentPath}.` : ""}{${lists.map(([k]) => k).join("+")}}`, list: merged };
}

// ---------------------------------------------------------------------------
// Applying a mapping. Every value comes from the log.

const EVENT_TYPE: Record<Exclude<EventKind, "other">, string> = {
  user: "user_message",
  assistant: "agent_message",
  system: "system_note",
  tool_call: "tool_request",
  tool_result: "tool_response",
  tool_error: "tool_error",
};

function kindOf(item: Record<string, unknown>, m: FieldMapping): EventKind {
  const byKind = m.kindField && typeof item[m.kindField] === "string" ? m.kinds?.[item[m.kindField] as string] : undefined;
  const bySpeaker = m.speakerField && typeof item[m.speakerField] === "string" ? m.speakers?.[item[m.speakerField] as string] : undefined;
  // A tool kind from either field wins; otherwise the speaker decides who said it.
  for (const k of [byKind, bySpeaker]) if (k && k.startsWith("tool")) return k;
  if (bySpeaker && bySpeaker !== "other") return bySpeaker;
  if (byKind && byKind !== "other") return byKind;
  if (m.errorField && item[m.errorField] && m.toolNameField && item[m.toolNameField]) return "tool_error";
  return "other";
}

/**
 * Rewrite each event into the vocabulary of the event-log reader (which owns
 * pairing, inline payloads and error handling), then read it with that reader.
 */
export function applyMapping(root: unknown, m: FieldMapping, fallbackId: string, listOverride?: unknown[]): CallLog | null {
  const list = listOverride ?? getPath(root, m.eventsPath);
  if (!Array.isArray(list)) return null;

  // A list of strings: treat as transcript lines.
  if (list.every((x) => typeof x === "string")) return null;

  const used = new Set([m.kindField, m.speakerField, m.textField, m.toolNameField, m.argsField, m.resultField, m.statusField, m.errorField, m.callIdField, m.timeField].filter(Boolean) as string[]);
  const canonical: Array<Record<string, unknown>> = [];
  for (const raw of list) {
    if (!isObject(raw)) continue;
    const item = flatten(raw);
    const kind = kindOf(item, m);
    const rest: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(raw)) if (!used.has(k) && ![...used].some((u) => u.startsWith(`${k}.`))) rest[k] = v as JsonValue;
    const at = m.timeField ? item[m.timeField] : undefined;
    const base: Record<string, JsonValue> = { ...(typeof at === "string" || typeof at === "number" ? { timestamp: at } : {}) };
    const text = m.textField && typeof item[m.textField] === "string" ? (item[m.textField] as string) : undefined;
    const tool = m.toolNameField && typeof item[m.toolNameField] === "string" ? (item[m.toolNameField] as string) : undefined;
    const callId = m.callIdField && (typeof item[m.callIdField] === "string" || typeof item[m.callIdField] === "number") ? String(item[m.callIdField]) : undefined;
    const ids = callId ? { tool_call_id: callId } : {};

    const attachedArgs = m.argsField ? item[m.argsField] : undefined;
    const attachedResult = m.resultField ? item[m.resultField] : undefined;
    const carriesTool = !!tool && (attachedArgs !== undefined || attachedResult !== undefined);
    if (kind === "user" || kind === "assistant" || kind === "system" || (kind === "other" && carriesTool)) {
      if (kind !== "other" && text?.trim()) canonical.push({ ...base, type: EVENT_TYPE[kind], content: text });
      // Some formats attach a tool call (and its result) to a turn or a log record.
      const args = attachedArgs;
      const result = attachedResult;
      if (kind !== "user" && carriesTool) {
        canonical.push({ ...base, ...ids, type: EVENT_TYPE.tool_call, tool, arguments: (args ?? {}) as JsonValue });
        if (result !== undefined) {
          canonical.push({ ...base, ...ids, type: EVENT_TYPE.tool_result, tool, response: result as JsonValue, ...(m.statusField && typeof item[m.statusField] === "number" ? { http_status: item[m.statusField] as number } : {}) });
        } else if (m.errorField && item[m.errorField]) {
          canonical.push({ ...base, ...ids, type: EVENT_TYPE.tool_error, tool, error: item[m.errorField] as JsonValue });
        }
      }
      if (kind === "other" && text?.trim()) canonical.push({ ...base, type: "system_note", content: `[${String((m.kindField && item[m.kindField]) || "event")}] ${text}` });
      continue;
    }
    if (kind === "tool_call") {
      const args =
        m.argsField && item[m.argsField] !== undefined
          ? (item[m.argsField] as JsonValue)
          : Object.keys(rest).length === 0 && text !== undefined
            ? parseLoose(text)
            : rest;
      canonical.push({ ...base, ...ids, type: EVENT_TYPE.tool_call, ...(tool ? { tool } : {}), arguments: args });
      // A call record that also carries its result.
      if (m.resultField && item[m.resultField] !== undefined) {
        canonical.push({ ...base, ...ids, type: EVENT_TYPE.tool_result, ...(tool ? { tool } : {}), response: item[m.resultField] as JsonValue, ...(m.statusField && typeof item[m.statusField] === "number" ? { http_status: item[m.statusField] as number } : {}) });
      }
      continue;
    }
    if (kind === "tool_result" || kind === "tool_error") {
      const status = m.statusField && typeof item[m.statusField] === "number" ? { http_status: item[m.statusField] as number } : {};
      // The response may sit in the text field (e.g. a tool turn whose "content" is the API's reply).
      const response =
        m.resultField && item[m.resultField] !== undefined
          ? (item[m.resultField] as JsonValue)
          : Object.keys(rest).length === 0 && text !== undefined
            ? parseLoose(text)
            : rest;
      const error =
        m.errorField && item[m.errorField] !== undefined && item[m.errorField] !== null
          ? (item[m.errorField] as JsonValue)
          : kind === "tool_error"
            ? (text ?? "error")
            : typeof response === "string" && /^\s*(error|exception|failed|failure)\b/i.test(response)
              ? response
              : undefined;
      canonical.push({
        ...base,
        ...ids,
        ...status,
        type: kind === "tool_error" ? EVENT_TYPE.tool_error : EVENT_TYPE.tool_result,
        ...(tool ? { tool } : {}),
        ...(kind === "tool_error" || error !== undefined ? { error: error ?? "error", ...rest } : { response }),
      });
      continue;
    }
    // Anything else with content stays visible as a note.
    const label = (m.kindField && item[m.kindField]) || (m.speakerField && item[m.speakerField]) || "event";
    const shown = text ?? (Object.keys(rest).length ? Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") : "");
    if (shown) canonical.push({ ...base, type: "system_note", content: `[${String(label)}] ${shown}` });
  }
  if (canonical.length === 0) return null;

  const container = (listOverride ? {} : m.eventsPath ? getPath(root, m.eventsPath.split(".").slice(0, -1).join(".")) : {}) as unknown;
  const holder = isObject(container) ? container : isObject(root) ? root : {};
  const log = eventLog.read({ ...holder, events: canonical }, fallbackId);
  const tools = log.events.filter((e) => e.type === "tool_call").length;
  log.provider = m.source === "llm" ? "mapped-by-llm" : "inferred";
  const fields = [
    m.kindField && `type=${m.kindField}`,
    m.speakerField && `speaker=${m.speakerField}`,
    m.textField && `text=${m.textField}`,
    m.toolNameField && `tool=${m.toolNameField}`,
  ].filter(Boolean);
  log.notes =
    `Format not recognized by a dedicated reader; ${m.source === "llm" ? "an LLM identified" : "ReplayKit inferred"} the structure from the "${m.eventsPath || "(root)"}" list (${fields.join(", ")}). ` +
    `${log.events.filter((e) => e.type === "message" && e.role !== "system").length} messages, ${tools} tool calls. All content is copied verbatim from the log.` +
    (log.notes?.match(/ [^.]*had a response but no request event[^.]*\./)?.[0] ?? "") +
    (isObject(root) && "failure" in root ? ' The log\'s own "failure" label was ignored.' : "");
  return log;
}

export function readUniversal(root: unknown, fallbackId: string, mapping?: FieldMapping): CallLog | null {
  if (mapping) return applyMapping(root, mapping, fallbackId);
  const single = (() => {
    const m = inferMapping(root);
    return m ? applyMapping(root, m, fallbackId) : null;
  })();
  const merged = mergedEvents(root);
  if (!merged) return single;
  const mm = inferMappingFor(merged.path, merged.list);
  const both = mm ? applyMapping(root, mm, fallbackId, merged.list) : null;
  const tools = (l: CallLog | null) => (l ? l.events.filter((e) => e.type === "tool_call" || e.type === "tool_result").length : -1);
  if (both && tools(both) > tools(single)) {
    both.notes = `${both.notes} Merged ${merged.path} in time order.`;
    return both;
  }
  return single;
}

/** Lines of strings at the best list, for transcript-style fallbacks. */
export function stringLines(root: unknown): string | null {
  const found = findBestList(root);
  if (!found || !found.list.every((x) => typeof x === "string")) return null;
  return (found.list as string[]).join("\n");
}
