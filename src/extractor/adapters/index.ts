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
import { fromOpenAIChat, OpenAIChatLogSchema } from "./openai-chat.js";

export const INPUT_FORMATS = ["calllog", "openai-chat", ...READERS.map((r) => r.id)];
export type InputFormat = "auto" | "calllog" | "openai-chat" | "bland" | "retell" | "vapi" | "messages" | "transcript-text";

export class InputFormatError extends Error {
  override name = "InputFormatError";
}

const ACCEPTED =
  "Accepted: Bland call details (transcripts or concatenated_transcript), Retell or Vapi call objects, " +
  "OpenAI or Anthropic message lists, any JSON list of {role, content} messages, a ReplayKit call log, " +
  'or a plain-text transcript with one "Speaker: text" line per turn.';

/** If a string is really JSON, parse it; otherwise keep it as text. */
function normalizeInput(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const s = data.trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      return JSON.parse(s);
    } catch {
      /* not JSON: treat as text */
    }
  }
  return data;
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
  return null;
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
  } else {
    const reader = READERS.find((r) => r.id === resolved);
    if (!reader) throw new InputFormatError(`unknown format "${resolved}"`);
    log = reader.read(data, fallbackId);
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
