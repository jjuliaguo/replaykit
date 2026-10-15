/**
 * LLM normalizer: reads call logs in any format (OpenTelemetry spans, run
 * trees, tracebacks, custom loggers) into ReplayKit events.
 *
 * Off unless REPLAYKIT_LLM_MAPPING=1 and OPENAI_API_KEY are set: every use is
 * a paid API call. Used only after the free readers fail or leave the call
 * unresolved.
 *
 * Grounding (the rule: never invent evidence): the model is told to copy
 * values verbatim, and then every value it returns is checked against the
 * original log:
 *   - each message's text must appear in the log;
 *   - each tool name must appear in the log;
 *   - every leaf value of arguments and responses must appear in the log;
 *   - each status code and error message must appear in the log.
 * Events that fail are dropped and counted in the notes. If too much fails,
 * the whole reading is rejected. So the model can choose structure and order,
 * but it cannot introduce a message, tool call, or API response that the log
 * does not contain.
 */
import { z } from "zod";
import type { JsonValue } from "../../shared/json.js";
import { CallLogSchema, type CallEvent, type CallLog } from "../../shared/types.js";
import { isObject } from "./common.js";
import type { LlmClient } from "./llm-client.js";

const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), role: z.enum(["user", "assistant", "system"]), content: z.string().min(1) }),
  z.object({ type: z.literal("tool_call"), callId: z.string().min(1), toolName: z.string().min(1), arguments: z.any().optional() }),
  z.object({
    type: z.literal("tool_result"),
    callId: z.string().min(1),
    toolName: z.string().optional(),
    status: z.number().int().optional().nullable(),
    body: z.any().optional(),
    error: z.object({ kind: z.enum(["timeout", "network", "http", "invalid_response", "unknown"]), message: z.string() }).optional().nullable(),
  }),
]);
const OutputSchema = z.object({ id: z.string().optional().nullable(), events: z.array(EventSchema) });

const SYSTEM = `You convert a voice-agent call log, in any format, into a list of events.
Return ONLY JSON: {"id": "<call id from the log or null>", "events": [ ... ]} where each event is one of:
  {"type":"message","role":"user"|"assistant"|"system","content":"<exact text>"}
  {"type":"tool_call","callId":"<id>","toolName":"<exact name>","arguments":{...exact values...}}
  {"type":"tool_result","callId":"<same id>","toolName":"<exact name>","status":<HTTP status or null>,"body":<exact response JSON or text, or null>,"error":{"kind":"timeout"|"network"|"http"|"invalid_response"|"unknown","message":"<exact error text>"} or null}
Rules:
- Copy every value VERBATIM from the log. Never paraphrase, summarize, translate, or invent text, names, numbers, or responses.
- "user" is the caller/customer; "assistant" is the voice agent/bot. Omit internal reasoning, prompts, and metadata that nobody said.
- Each tool/API/function/webhook invocation is a tool_call; its outcome is a tool_result with the same callId (make up short ids like "c1" if the log has none).
- A failure can be an HTTP status >= 400, an error/exception/timeout, or a failure flag inside a 200 response body: keep the body exactly as logged.
- Keep chronological order.`;

function norm(s: string): string {
  return s.toLowerCase().replace(/\\[nrt"]/g, " ").replace(/[\s"'`]+/g, " ").trim();
}

/** All text a value could legitimately be copied from: the raw input plus every decoded string in it. */
function sourceText(input: unknown): string {
  const parts: string[] = [typeof input === "string" ? input : JSON.stringify(input)];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.entries(v).forEach(([k, x]) => (parts.push(k), walk(x)));
  };
  walk(input);
  return norm(parts.join("\n"));
}

function leaves(v: unknown, out: Array<string | number | boolean | null> = []): Array<string | number | boolean | null> {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (isObject(v)) Object.values(v).forEach((x) => leaves(x, out));
  return out;
}

function grounded(value: unknown, src: string): boolean {
  return leaves(value).every((leaf) => {
    if (leaf === null) return true;
    if (typeof leaf === "boolean") return src.includes(String(leaf)) || src.includes(leaf ? "ok" : "fail");
    if (typeof leaf === "number") return new RegExp(`(^|[^\\d.])${String(leaf).replace(".", "\\.")}([^\\d]|$)`).test(src);
    const s = norm(leaf);
    return s.length === 0 || src.includes(s);
  });
}

export async function normalizeWithLlm(input: unknown, fallbackId: string, client: LlmClient): Promise<{ log: CallLog | null; problem?: string }> {
  const raw = typeof input === "string" ? input : JSON.stringify(input, null, 1);
  const truncated = raw.length > 40_000;
  let parsed: z.infer<typeof OutputSchema>;
  try {
    parsed = OutputSchema.parse(JSON.parse(await client.complete(SYSTEM, `Call log${truncated ? " (truncated)" : ""}:\n${raw.slice(0, 40_000)}`)));
  } catch (e) {
    return { log: null, problem: `LLM reading unusable: ${(e as Error).message.slice(0, 160)}` };
  }

  const src = sourceText(input);
  const kept: CallEvent[] = [];
  let dropped = 0;
  for (const e of parsed.events) {
    if (e.type === "message") {
      if (src.includes(norm(e.content))) kept.push({ type: "message", role: e.role, content: e.content });
      else dropped++;
    } else if (e.type === "tool_call") {
      if (src.includes(norm(e.toolName)) && grounded(e.arguments ?? {}, src)) kept.push({ type: "tool_call", callId: e.callId, toolName: e.toolName, arguments: (e.arguments ?? {}) as JsonValue });
      else dropped++;
    } else {
      const okStatus = e.status == null || grounded(e.status, src);
      const okBody = e.body === undefined || e.body === null || grounded(e.body, src);
      const okError = !e.error || src.includes(norm(e.error.message));
      if (!(okStatus && okBody && okError)) {
        dropped++;
        continue;
      }
      if (e.status == null && (e.body === undefined || e.body === null) && !e.error) {
        dropped++;
        continue;
      }
      kept.push({
        type: "tool_result",
        callId: e.callId,
        ...(e.toolName ? { toolName: e.toolName } : {}),
        ...(e.error ? { error: e.error } : { response: { ...(e.status != null ? { status: e.status } : {}), body: (e.body ?? null) as JsonValue } }),
      });
    }
  }
  // Results whose call was dropped can't be replayed; drop them too.
  const callIds = new Set(kept.flatMap((e) => (e.type === "tool_call" ? [e.callId] : [])));
  const events = kept.filter((e) => e.type !== "tool_result" || callIds.has(e.callId));
  dropped += kept.length - events.length;

  const total = parsed.events.length;
  if (events.length === 0 || dropped > total * 0.4) {
    return { log: null, problem: `LLM reading rejected: ${dropped} of ${total} events could not be found in the original log` };
  }
  const tools = [...new Set(events.flatMap((e) => (e.type === "tool_call" ? [e.toolName] : [])))].map((name) => ({ name }));
  const id = parsed.id && src.includes(norm(parsed.id)) ? parsed.id : fallbackId;
  const log = {
    schemaVersion: "1.0" as const,
    id,
    provider: "read-by-llm",
    kind: "recorded" as const,
    tools,
    events,
    notes:
      `Format not recognized by the built-in readers; an LLM read the log, and every value was checked against the original text. ` +
      `${events.length} events kept${dropped ? `, ${dropped} dropped because their content was not found in the log` : ""}.` +
      (truncated ? " The log was longer than the model's limit and was truncated." : ""),
  };
  const checked = CallLogSchema.safeParse(log);
  return checked.success ? { log: checked.data } : { log: null, problem: "LLM reading produced an invalid call log" };
}
