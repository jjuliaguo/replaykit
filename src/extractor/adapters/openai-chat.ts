/**
 * Adapter for OpenAI chat-completions style transcripts:
 *   { "messages": [ {role, content, tool_calls?}, {role:"tool", tool_call_id, content}, ... ] }
 * Tool results are message strings; JSON strings are parsed, anything else is
 * kept as a string. No HTTP status exists in this format, so none is invented.
 */
import { z } from "zod";
import type { CallEvent, CallLog, ToolDefinition } from "../../shared/types.js";
import type { JsonValue } from "../../shared/json.js";

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

/**
 * Content is either a string or an array of parts (current OpenAI SDKs send
 * `[{type: "text", text}]`). Non-text parts (images, audio) carry no claims
 * we can analyze and are dropped.
 */
const ContentSchema = z
  .union([
    z.string(),
    z.array(z.looseObject({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() })),
  ])
  .transform((c) =>
    typeof c === "string"
      ? c
      : c
          .map((p) => p.text ?? p.refusal ?? "")
          .filter(Boolean)
          .join("\n"),
  );

const MessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: ContentSchema }),
  z.object({ role: z.literal("developer"), content: ContentSchema }),
  z.object({ role: z.literal("user"), content: ContentSchema }),
  z.object({
    role: z.literal("assistant"),
    content: ContentSchema.nullable().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string(), content: ContentSchema }),
]);

export const OpenAIChatLogSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["synthetic", "recorded"]).optional(),
  messages: z.array(MessageSchema).min(1),
  tools: z
    .array(
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.record(z.string(), z.any()).optional(),
        }),
      }),
    )
    .optional(),
  workflow: z.object({ description: z.string().optional(), requiredTools: z.array(z.string()).optional() }).optional(),
  notes: z.string().optional(),
});
export type OpenAIChatLog = z.infer<typeof OpenAIChatLogSchema>;

function parseMaybeJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export function fromOpenAIChat(log: OpenAIChatLog, fallbackId: string): CallLog {
  const events: CallEvent[] = [];
  const names = new Map<string, string>();
  for (const m of log.messages) {
    if (m.role === "system" || m.role === "developer") events.push({ type: "message", role: "system", content: m.content });
    else if (m.role === "user") events.push({ type: "message", role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.content) events.push({ type: "message", role: "assistant", content: m.content });
      for (const call of m.tool_calls ?? []) {
        names.set(call.id, call.function.name);
        events.push({ type: "tool_call", callId: call.id, toolName: call.function.name, arguments: parseMaybeJson(call.function.arguments) });
      }
    } else {
      const toolName = names.get(m.tool_call_id);
      events.push({
        type: "tool_result",
        callId: m.tool_call_id,
        ...(toolName ? { toolName } : {}),
        response: { body: parseMaybeJson(m.content) },
      });
    }
  }
  const tools: ToolDefinition[] = (log.tools ?? []).map((t) => ({
    name: t.function.name,
    ...(t.function.description ? { description: t.function.description } : {}),
    ...(t.function.parameters ? { parameters: t.function.parameters } : {}),
  }));
  return {
    schemaVersion: "1.0",
    id: log.id ?? fallbackId,
    provider: "openai-chat",
    kind: log.kind ?? "recorded",
    tools,
    events,
    ...(log.workflow ? { workflow: log.workflow } : {}),
    ...(log.notes ? { notes: log.notes } : {}),
  };
}
