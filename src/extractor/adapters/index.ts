/**
 * Input adapters. Each converts a platform-specific log into the normalized
 * CallLog. Detection never sees platform formats.
 *
 * Bland: no adapter yet. We have not verified the exact shape of Bland call
 * logs / webhook records, so rather than guess, Bland logs must be converted
 * to the native CallLog format (schemas/call-log.schema.json) until a real
 * sample is available. See docs/EXTRACTOR.md.
 */
import { CallLogSchema, type CallLog } from "../../shared/types.js";
import { fromOpenAIChat, OpenAIChatLogSchema } from "./openai-chat.js";

export type InputFormat = "auto" | "calllog" | "openai-chat";

export class InputFormatError extends Error {
  override name = "InputFormatError";
}

export function detectFormat(data: unknown): Exclude<InputFormat, "auto"> | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if ("schemaVersion" in obj && Array.isArray(obj.events)) return "calllog";
  if (Array.isArray(obj.messages)) return "openai-chat";
  return null;
}

export function toCallLog(data: unknown, format: InputFormat = "auto", fallbackId = "call-log"): CallLog {
  const resolved = format === "auto" ? detectFormat(data) : format;
  if (resolved === null) {
    throw new InputFormatError(
      "unrecognized log format: expected a ReplayKit CallLog (schemaVersion + events) or an OpenAI chat transcript (messages)",
    );
  }
  const schema = resolved === "calllog" ? CallLogSchema : OpenAIChatLogSchema;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
    throw new InputFormatError(`log is not a valid ${resolved} log:\n${lines.join("\n")}`);
  }
  return resolved === "calllog"
    ? (parsed.data as CallLog)
    : fromOpenAIChat(parsed.data as Parameters<typeof fromOpenAIChat>[0], fallbackId);
}
