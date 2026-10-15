/**
 * Input adapters. Each converts a platform-specific log into the normalized
 * CallLog. Detection never sees platform formats.
 *
 * Order: the native CallLog and strict OpenAI chat formats first (exact
 * schemas), then platform readers (Bland, Retell, Vapi), a generic message
 * list reader, and finally plain-text transcripts. See formats.ts.
 */
import { CallLogSchema, type CallLog } from "../../shared/types.js";
import { isObject } from "./common.js";
import { READERS } from "./formats.js";
import { llmMappingEnabled, openAIClient, type LlmClient } from "./llm-client.js";
import { normalizeWithLlm } from "./llm-normalizer.js";
import { fromOpenAIChat, OpenAIChatLogSchema } from "./openai-chat.js";
import { readUniversal, stringLines } from "./universal.js";

export const INPUT_FORMATS = ["calllog", "openai-chat", ...READERS.map((r) => r.id)];
export type InputFormat = "auto" | "calllog" | "openai-chat" | "bland" | "retell" | "vapi" | "messages" | "event-log" | "transcript-text" | "inferred";

export class InputFormatError extends Error {
  override name = "InputFormatError";
}

const ACCEPTED =
  "Accepted: Bland call details (transcripts or concatenated_transcript), Retell or Vapi call objects, " +
  "OpenAI or Anthropic message lists, any JSON list of {role, content} messages, a ReplayKit call log, " +
  'or a plain-text transcript with one "Speaker: text" line per turn.';

/** "ts=... level=info event=tool_call tool=x status=503 msg=\"...\"" -> object. */
function keyValueLine(line: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lead = line.match(/^\s*\[?(\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]?\s+/);
  if (lead) out.timestamp = lead[1]!;
  const afterLead = lead ? line.slice(lead[0].length) : line;
  const event = afterLead.match(/^\s*(?:(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL)\b\s*)?([A-Za-z_][\w.:-]*)(?=\s|$)(?!=)/);
  if (event && !event[1]!.includes("=")) out.event = event[1]!;
  const level = afterLead.match(/^\s*(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL)\b/);
  if (level) out.level = level[1]!;
  const re = /([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\{.*?\}(?=\s+[A-Za-z_][\w.-]*=|\s*$)|\S+)/g;
  let n = 0;
  for (const m of line.matchAll(re)) {
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\"/g, '"');
    out[m[1]!] = v;
    n++;
  }
  return n >= 2 ? out : null;
}

/**
 * If a string is really JSON, parse it. JSON-lines and key=value log text
 * become an array of objects so structure inference can read them.
 * Anything else stays text.
 */
function normalizeInput(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const s = data.trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      return JSON.parse(s);
    } catch {
      /* not one JSON document */
    }
  }
  const lines = s.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length >= 2) {
    const json = lines.map((l) => {
      try {
        const v = JSON.parse(l.trim());
        return isObject(v) ? v : null;
      } catch {
        return null;
      }
    });
    if (json.filter(Boolean).length >= lines.length * 0.6) return { events: json.filter(Boolean) };
    const kv = lines.map(keyValueLine);
    if (kv.filter(Boolean).length >= lines.length * 0.6) {
      return {
        events: kv.filter(Boolean).map((o) => Object.fromEntries(Object.entries(o!).map(([k, v]) => [k, /^\{.*\}$/.test(v) ? safeJson(v) : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]))),
      };
    }
  }
  return data;
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function hasAnthropicToolBlocks(messages: unknown[]): boolean {
  return messages.some((m) => isObject(m) && Array.isArray(m.content) && m.content.some((b) => isObject(b) && (b.type === "tool_use" || b.type === "tool_result")));
}

export function detectFormat(input: unknown): Exclude<InputFormat, "auto"> | null {
  const data = normalizeInput(input);
  if (isObject(data) && "schemaVersion" in data && Array.isArray(data.events)) return "calllog";
  // Anthropic messages also fit the OpenAI schema (content-part arrays), but the
  // OpenAI adapter would drop their tool_use / tool_result blocks.
  if (isObject(data) && Array.isArray(data.messages) && !hasAnthropicToolBlocks(data.messages) && OpenAIChatLogSchema.safeParse(data).success) return "openai-chat";
  for (const r of READERS) {
    try {
      if (r.detect(data)) return r.id as Exclude<InputFormat, "auto">;
    } catch {
      /* a reader's detect must never break detection */
    }
  }
  // No dedicated reader: infer the structure from the data itself.
  if (typeof data !== "string" && (stringLines(data) || readUniversalSafe(data, "probe"))) return "inferred";
  return null;
}

/** How much of a call a reading captured: tool activity first, then conversation. */
function coverage(log: CallLog): number {
  const tools = log.events.filter((e) => e.type === "tool_call" || e.type === "tool_result").length;
  const talk = log.events.filter((e) => e.type === "message" && e.role !== "system").length;
  return tools * 1000 + talk;
}

function readUniversalSafe(data: unknown, fallbackId: string): CallLog | null {
  try {
    const log = readUniversal(data, fallbackId);
    return log && log.events.some((e) => e.type === "message" || e.type === "tool_call") ? log : null;
  } catch {
    return null;
  }
}

function describe(data: unknown): string {
  if (typeof data === "string") return data.trim() ? "plain text without speaker lines" : "empty input";
  if (Array.isArray(data)) return `a JSON array of ${data.length} item(s) that don't look like messages`;
  if (isObject(data)) {
    const keys = Object.keys(data);
    return `a JSON object with keys: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", …" : ""}`;
  }
  return `a JSON ${data === null ? "null" : typeof data}`;
}

export function toCallLog(input: unknown, format: InputFormat = "auto", fallbackId = "call-log"): CallLog {
  const data = normalizeInput(input);
  const resolved = format === "auto" ? detectFormat(data) : format;
  if (resolved === null) {
    throw new InputFormatError(`Couldn't find a conversation in this log. Got ${describe(data)}. ${ACCEPTED}`);
  }

  let log: CallLog;
  if (resolved === "calllog" || resolved === "openai-chat") {
    const schema = resolved === "calllog" ? CallLogSchema : OpenAIChatLogSchema;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const lines = parsed.error.issues.slice(0, 8).map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
      throw new InputFormatError(`log is not a valid ${resolved} log:\n${lines.join("\n")}`);
    }
    log = resolved === "calllog" ? (parsed.data as CallLog) : fromOpenAIChat(parsed.data as Parameters<typeof fromOpenAIChat>[0], fallbackId);
  } else if (resolved === "inferred") {
    const lines = stringLines(data);
    const inferred = lines ? READERS.find((r) => r.id === "transcript-text")!.read(lines, fallbackId) : readUniversalSafe(data, fallbackId);
    if (!inferred) throw new InputFormatError(`Couldn't find a conversation in this log. Got ${describe(data)}. ${ACCEPTED}`);
    log = inferred;
  } else {
    const reader = READERS.find((r) => r.id === resolved);
    if (!reader) throw new InputFormatError(`unknown format "${resolved}"`);
    log = reader.read(data, fallbackId);
    // The message-list and event-log readers work by convention; if structure
    // inference captures more of the call's tool activity, use that instead.
    if (resolved === "messages" || resolved === "event-log" || resolved === "bland") {
      const inferred = readUniversalSafe(data, fallbackId);
      const toolEvents = (l: CallLog) => l.events.filter((e) => e.type === "tool_call" || e.type === "tool_result").length;
      if (inferred && toolEvents(inferred) > toolEvents(log)) log = inferred;
    }
  }

  // Every reader must still produce a valid CallLog with something in it.
  if (log.events.length === 0) throw new InputFormatError(`Read the log as ${resolved}, but found no messages or tool calls in it.`);
  const checked = CallLogSchema.safeParse(log);
  if (!checked.success) {
    const i = checked.error.issues[0];
    throw new InputFormatError(`Read the log as ${resolved}, but the result is invalid at ${i?.path.map(String).join(".") ?? "?"}: ${i?.message ?? "unknown error"}`);
  }
  return checked.data;
}


const TOOL_WORDS = /(tool|function|\bfn\b|api|webhook|http|request|response|status|error|exception|timeout|invoke)/i;

/**
 * Like toCallLog, plus the optional LLM normalizer (llm-normalizer.ts) for
 * logs the built-in readers can't fully read. Off unless
 * REPLAYKIT_LLM_MAPPING=1 and OPENAI_API_KEY are set, or a client is passed.
 * Runs only when the free path failed, or read the log by inference / as a
 * plain transcript and still found no tool activity or no conversation while
 * the log mentions tools. Its result is used only if it captures more.
 */
export async function toCallLogAsync(input: unknown, options: { format?: InputFormat; fallbackId?: string; llm?: LlmClient | null } = {}): Promise<CallLog> {
  const llm = options.llm === undefined ? (llmMappingEnabled() ? openAIClient() : null) : options.llm;
  const data = normalizeInput(input);
  let first: CallLog | null = null;
  let failure: unknown = null;
  try {
    first = toCallLog(data, options.format ?? "auto", options.fallbackId);
  } catch (e) {
    failure = e;
  }
  const guessed = first && (first.provider === "inferred" || first.provider === "transcript-text");
  const incomplete =
    !!first &&
    (!first.events.some((e) => e.type === "tool_call") || !first.events.some((e) => e.type === "message" && e.role !== "system")) &&
    TOOL_WORDS.test(typeof input === "string" ? input : JSON.stringify(input));
  if (llm && (!first || (guessed && incomplete))) {
    const { log, problem } = await normalizeWithLlm(input, options.fallbackId ?? "call-log", llm).catch((e: Error) => ({ log: null, problem: e.message }));
    if (log && (!first || coverage(log) > coverage(first))) return log;
    if (!first) throw new InputFormatError(`${(failure as Error)?.message ?? "Couldn't read this log."}${problem ? ` (${problem})` : ""}`);
  }
  if (first) return first;
  throw failure;
}
