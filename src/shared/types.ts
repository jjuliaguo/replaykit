/**
 * Shared fixture contract for ReplayKit.
 *
 * PLACEHOLDER: this file did not exist when the replay engine was built, so it
 * was created to match the project brief. It is the contract the replay engine
 * (src/replay/) depends on. When the real shared types land, keep these exports
 * (names and shapes) or update src/replay/ accordingly.
 *
 * A replay fixture captures one external tool interaction from a real
 * voice-agent call: what the caller asked, what the agent sent to the tool
 * webhook, the exact HTTP response that came back, and how the agent behaved.
 */
import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/** The webhook invocation the agent platform made to the external tool. */
export const RecordedRequestSchema = z.object({
  method: HttpMethodSchema,
  path: z.string().regex(/^\//, "path must start with /"),
  headers: z.record(z.string(), z.string()).optional(),
  body: JsonValueSchema.optional(),
});
export type RecordedRequest = z.infer<typeof RecordedRequestSchema>;

/**
 * The exact HTTP response the external tool returned. `body` is stored as
 * parsed JSON and must be replayed verbatim; nothing may rewrite it.
 */
export const RecordedResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()).optional(),
  body: JsonValueSchema,
});
export type RecordedResponse = z.infer<typeof RecordedResponseSchema>;

/**
 * Which parts of an incoming request must equal the recording for the mock
 * server to treat it as a match. Method and path are always compared.
 * `bodyFields` lists top-level JSON body keys that must also be equal.
 */
export const MatchRulesSchema = z.object({
  bodyFields: z.array(z.string()).optional(),
});
export type MatchRules = z.infer<typeof MatchRulesSchema>;

export const ToolInteractionSchema = z.object({
  /** Tool name as the agent platform knows it, e.g. "book_appointment". */
  name: z.string().min(1),
  description: z.string().optional(),
  /** JSON Schema for the tool's parameters, as given to the agent. */
  parameters: JsonValueSchema.optional(),
  request: RecordedRequestSchema,
  response: RecordedResponseSchema,
  match: MatchRulesSchema.optional(),
});
export type ToolInteraction = z.infer<typeof ToolInteractionSchema>;

export const FixtureSourceSchema = z.object({
  provider: z.literal("bland"),
  /** "recorded" = captured from a real call; "synthetic" = hand-written sample. */
  kind: z.enum(["recorded", "synthetic"]),
  callId: z.string().optional(),
  capturedAt: z.iso.datetime(),
});
export type FixtureSource = z.infer<typeof FixtureSourceSchema>;

/**
 * Ground truth for the regression check, derived from the recorded tool
 * response (not from any agent's output). Pass/fail is computed by comparing
 * an actual run against these values; it is never stored in the fixture.
 */
export const ExpectedBehaviorSchema = z.object({
  toolInvoked: z.boolean(),
  bookingConfirmed: z.boolean(),
});
export type ExpectedBehavior = z.infer<typeof ExpectedBehaviorSchema>;

export const ReplayFixtureSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  source: FixtureSourceSchema,
  /** What the caller asked for, as transcribed. */
  caller: z.object({ request: z.string().min(1) }),
  tool: ToolInteractionSchema,
  /** How the original agent behaved on the recorded call. */
  observed: z.object({
    agentResponse: z.string(),
    verdict: z.enum(["correct", "incorrect", "unknown"]),
  }),
  expected: ExpectedBehaviorSchema,
});
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
