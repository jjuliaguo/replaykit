/**
 * Normalized call log, version 1.0: the INPUT side of ReplayKit.
 *
 * Every agent platform logs calls differently. The extractor converts a
 * platform log into this one shape (through an adapter) and everything after
 * that point, detection and fixture generation, works only on this shape.
 * A replay fixture embeds the same event types under `original.events`, so
 * the replay engine never needs to know about any platform format either.
 *
 * Events are chronological. A tool interaction is a `tool_call` event followed
 * (not necessarily immediately) by a `tool_result` event with the same
 * `callId`.
 */
import { z } from "zod";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";

export const CALL_LOG_SCHEMA_VERSION = "1.0";

const isoDateTime = z.iso.datetime({ offset: true });

/** A tool the agent could call during the conversation. */
export const ToolDefinitionSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    /** JSON Schema object describing the tool's arguments, as the agent saw it. */
    parameters: JsonObjectSchema.optional(),
    /** Where the platform sent the call, if the tool is an HTTP webhook. */
    endpoint: z
      .object({
        method: z.string().optional(),
        url: z.string().optional(),
      })
      .optional(),
  })
  .meta({ id: "ToolDefinition" });
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** The HTTP request the platform made to the external tool, when known. */
export const HttpRequestSchema = z
  .object({
    method: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: JsonValueSchema.optional(),
  })
  .meta({ id: "HttpRequest" });
export type HttpRequest = z.infer<typeof HttpRequestSchema>;

/**
 * What the external tool returned. `body` is the parsed JSON body (or a plain
 * string for non-JSON bodies). This is the thing a replay must reproduce
 * exactly, so nothing may normalize or rewrite it.
 */
export const HttpResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: JsonValueSchema.optional(),
    latencyMs: z.number().nonnegative().optional(),
  })
  .meta({ id: "HttpResponse" });
export type HttpResponse = z.infer<typeof HttpResponseSchema>;

/** A tool call that produced no usable response. */
export const ToolErrorSchema = z
  .object({
    kind: z.enum(["timeout", "network", "http", "invalid_response", "unknown"]),
    message: z.string(),
  })
  .meta({ id: "ToolError" });
export type ToolError = z.infer<typeof ToolErrorSchema>;

export const MessageEventSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  at: isoDateTime.optional(),
});
export type MessageEvent = z.infer<typeof MessageEventSchema>;

export const ToolCallEventSchema = z.object({
  type: z.literal("tool_call"),
  /** Correlates this call with its `tool_result`. Unique within the log. */
  callId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: JsonValueSchema.default({}),
  at: isoDateTime.optional(),
});
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

export const ToolResultEventSchema = z.object({
  type: z.literal("tool_result"),
  callId: z.string().min(1),
  toolName: z.string().min(1).optional(),
  request: HttpRequestSchema.optional(),
  response: HttpResponseSchema.optional(),
  error: ToolErrorSchema.optional(),
  at: isoDateTime.optional(),
});
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const CallEventSchema = z
  .discriminatedUnion("type", [MessageEventSchema, ToolCallEventSchema, ToolResultEventSchema])
  .meta({ id: "CallEvent" });
export type CallEvent = z.infer<typeof CallEventSchema>;

/**
 * Optional knowledge about what the conversation was supposed to accomplish.
 * A missing tool call counts as a failure only when something like this says
 * the tool was required.
 */
export const WorkflowSchema = z
  .object({
    description: z.string().optional(),
    /** Tools the workflow requires the agent to call before claiming the action is done. */
    requiredTools: z.array(z.string().min(1)).optional(),
  })
  .meta({ id: "Workflow" });
export type Workflow = z.infer<typeof WorkflowSchema>;

export const CallLogSchema = z
  .object({
    schemaVersion: z.literal(CALL_LOG_SCHEMA_VERSION),
    id: z.string().min(1),
    /** Platform the log came from, e.g. "bland", "openai", "synthetic". */
    provider: z.string().min(1),
    /** synthetic = hand-written example; recorded = captured from a real call. */
    kind: z.enum(["synthetic", "recorded"]),
    startedAt: isoDateTime.optional(),
    tools: z.array(ToolDefinitionSchema).default([]),
    workflow: WorkflowSchema.optional(),
    events: z.array(CallEventSchema).min(1),
    metadata: JsonObjectSchema.optional(),
    notes: z.string().optional(),
  })
  .meta({ id: "CallLog" });
export type CallLog = z.infer<typeof CallLogSchema>;
