/**
 * Replay fixture, version 1.0: the OUTPUT of the extractor and the INPUT of
 * the replay engine. This is the contract between the two halves of ReplayKit.
 *
 * Design rules:
 * - Nothing in here is specific to appointment booking or any other tool.
 *   Tool names, arguments, and responses are data copied from a call log.
 * - Recorded tool responses are stored verbatim and must be replayed verbatim.
 * - Every detected failure cites evidence (event indexes in `original.events`).
 * - Expectations describe what a correct agent must do. Pass/fail is never
 *   stored here; it is computed by the replay engine from an actual run.
 *
 * Replay contract (for the replay engine):
 * 1. Start the agent with `scenario.messages` (system prompt, if recorded,
 *    plus the user turns that preceded the first tool call), exposing
 *    `tools` to the agent.
 * 2. When the agent calls a tool, find the first unused entry in
 *    `replay.interactions` with the same `toolName` (match.strategy
 *    "sequence"), or the first whose `match.argumentKeys` equal the
 *    recorded arguments (strategy "arguments"). Return its `response`
 *    (status + body, verbatim) or simulate its `error`.
 * 3. A tool call that matches nothing follows `replay.onUnmatchedCall`.
 * 4. Evaluate the run against `expectations`.
 */
import { z } from "zod";
import {
  CallEventSchema,
  HttpRequestSchema,
  HttpResponseSchema,
  ToolDefinitionSchema,
  ToolErrorSchema,
  WorkflowSchema,
} from "./call-log.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";

export const FIXTURE_SCHEMA_VERSION = "1.0";

const isoDateTime = z.iso.datetime({ offset: true });

/** Points at the call-log events that justify a claim. */
export const EvidenceSchema = z
  .object({
    /** Index into `original.events`. */
    eventIndex: z.number().int().nonnegative(),
    /** What this event shows, in one sentence. */
    description: z.string().min(1),
    /** Exact text or JSON path value quoted from the event, if useful. */
    quote: z.string().optional(),
    /** JSON path inside the event's payload, e.g. "response.body.success". */
    path: z.string().optional(),
  })
  .meta({ id: "Evidence" });
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FAILURE_TYPES = [
  /** Agent said an action succeeded although the tool reported failure. */
  "false_success_claim",
  /** Agent said an action succeeded but never called the required tool. */
  "unverified_success_claim",
  /** Tool timed out or errored and the agent did not tell the user. */
  "unhandled_tool_error",
  /** Agent stated a value that contradicts the tool's response. */
  "tool_result_misread",
] as const;

export const FailureTypeSchema = z.enum(FAILURE_TYPES).meta({ id: "FailureType" });
export type FailureType = z.infer<typeof FailureTypeSchema>;

export const DetectedFailureSchema = z
  .object({
    type: FailureTypeSchema,
    /** One-sentence human summary. */
    summary: z.string().min(1),
    /** Tool the failure concerns, if any. */
    toolName: z.string().optional(),
    /**
     * high: direct, unambiguous evidence on both sides (tool said X, agent said not-X).
     * medium: evidence relies on a heuristic match on one side.
     */
    confidence: z.enum(["high", "medium"]),
    /** Name of the detector rule that produced this finding. */
    detector: z.string().min(1),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .meta({ id: "DetectedFailure" });
export type DetectedFailure = z.infer<typeof DetectedFailureSchema>;

/** How a live tool call is matched to a recorded interaction. */
export const MatchRuleSchema = z
  .object({
    /**
     * sequence: the Nth call to this tool gets the Nth recorded interaction.
     * arguments: match when the listed argument keys equal the recorded ones.
     */
    strategy: z.enum(["sequence", "arguments"]),
    argumentKeys: z.array(z.string()).optional(),
  })
  .meta({ id: "MatchRule" });
export type MatchRule = z.infer<typeof MatchRuleSchema>;

export const ReplayInteractionSchema = z
  .object({
    /** callId from the original log. */
    id: z.string().min(1),
    toolName: z.string().min(1),
    /** Arguments the original agent sent. Informational; used by "arguments" matching. */
    recordedArguments: JsonValueSchema,
    request: HttpRequestSchema.optional(),
    /** Recorded response to replay verbatim. Absent when the call errored. */
    response: HttpResponseSchema.optional(),
    /** Recorded failure to simulate (timeout, network error...). */
    error: ToolErrorSchema.optional(),
    match: MatchRuleSchema,
    /** Index of the tool_result event in `original.events`. */
    sourceEventIndex: z.number().int().nonnegative(),
  })
  .refine((i) => i.response !== undefined || i.error !== undefined, {
    message: "an interaction needs a recorded response or a recorded error",
  })
  .meta({ id: "ReplayInteraction" });
export type ReplayInteraction = z.infer<typeof ReplayInteractionSchema>;

const ExpectationBase = {
  /** Stable id, unique within the fixture. */
  id: z.string().min(1),
  description: z.string().min(1),
  /** Why this expectation exists, tied to the detected failure. */
  rationale: z.string().min(1),
  evidence: z.array(EvidenceSchema).default([]),
};

/** The agent must call this tool (at least `minCalls` times). */
export const ToolCalledExpectationSchema = z.object({
  ...ExpectationBase,
  kind: z.literal("tool_called"),
  toolName: z.string().min(1),
  minCalls: z.number().int().positive().default(1),
});

/**
 * The agent must not tell the user that the action behind `toolName`
 * succeeded. `claimPhrases` are phrases from the original incorrect reply
 * that constituted the false claim; evaluators may use them as hints but
 * should not rely on them alone.
 */
export const NoSuccessClaimExpectationSchema = z.object({
  ...ExpectationBase,
  kind: z.literal("no_success_claim"),
  toolName: z.string().min(1),
  claimPhrases: z.array(z.string()).default([]),
});

/**
 * The agent should communicate the failure to the user. `signals` are
 * strings from the recorded tool response (such as its error message) that
 * a correct reply would plausibly reflect.
 */
export const AcknowledgesFailureExpectationSchema = z.object({
  ...ExpectationBase,
  kind: z.literal("acknowledges_failure"),
  toolName: z.string().min(1),
  signals: z.array(z.string()).default([]),
});

/** The agent's statements about `path` in the tool response must agree with `expectedValue`. */
export const ConsistentWithToolResultExpectationSchema = z.object({
  ...ExpectationBase,
  kind: z.literal("consistent_with_tool_result"),
  toolName: z.string().min(1),
  path: z.string().min(1),
  expectedValue: JsonValueSchema,
});

/** Free-form rubric for an optional LLM judge. Never the only expectation. */
export const RubricExpectationSchema = z.object({
  ...ExpectationBase,
  kind: z.literal("rubric"),
  rubric: z.string().min(1),
});

export const ExpectationSchema = z
  .discriminatedUnion("kind", [
    ToolCalledExpectationSchema,
    NoSuccessClaimExpectationSchema,
    AcknowledgesFailureExpectationSchema,
    ConsistentWithToolResultExpectationSchema,
    RubricExpectationSchema,
  ])
  .meta({ id: "Expectation" });
export type Expectation = z.infer<typeof ExpectationSchema>;
export type ExpectationKind = Expectation["kind"];

export const ScenarioMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const ReplayFixtureSchema = z
  .object({
    schemaVersion: z.literal(FIXTURE_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    source: z.object({
      provider: z.string().min(1),
      /** synthetic fixtures come from hand-written logs and must be labeled as such. */
      kind: z.enum(["synthetic", "recorded"]),
      callLogId: z.string().min(1),
      capturedAt: isoDateTime.optional(),
      extractedAt: isoDateTime,
      extractor: z.object({ name: z.string(), version: z.string() }),
    }),
    /** Conversation to start the replayed agent with. */
    scenario: z.object({
      messages: z.array(ScenarioMessageSchema).min(1),
      /** All user turns from the original call, in order, for multi-turn replays. */
      userTurns: z.array(z.string()),
    }),
    tools: z.array(ToolDefinitionSchema),
    workflow: WorkflowSchema.optional(),
    replay: z.object({
      interactions: z.array(ReplayInteractionSchema),
      /** What to do when the agent calls a tool with no matching recording. */
      onUnmatchedCall: z.enum(["error_response", "fail_run"]).default("error_response"),
    }),
    /** The original failed interaction, unmodified, for display and audit. */
    original: z.object({
      events: z.array(CallEventSchema).min(1),
      finalAgentMessage: z.string().optional(),
    }),
    failures: z.array(DetectedFailureSchema).min(1),
    expectations: z.array(ExpectationSchema).min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .superRefine((fixture, ctx) => {
    const eventCount = fixture.original.events.length;
    const checkEvidence = (evidence: Evidence[], path: (string | number)[]) =>
      evidence.forEach((e, i) => {
        if (e.eventIndex >= eventCount) {
          ctx.addIssue({
            code: "custom",
            path: [...path, i, "eventIndex"],
            message: `evidence points at event ${e.eventIndex}, but original.events has ${eventCount}`,
          });
        }
      });
    fixture.failures.forEach((f, i) => checkEvidence(f.evidence, ["failures", i, "evidence"]));
    fixture.expectations.forEach((e, i) => checkEvidence(e.evidence, ["expectations", i, "evidence"]));

    const ids = new Set<string>();
    fixture.expectations.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", path: ["expectations", i, "id"], message: `duplicate expectation id "${e.id}"` });
      ids.add(e.id);
    });

    fixture.replay.interactions.forEach((interaction, i) => {
      if (interaction.sourceEventIndex >= eventCount) {
        ctx.addIssue({
          code: "custom",
          path: ["replay", "interactions", i, "sourceEventIndex"],
          message: `sourceEventIndex ${interaction.sourceEventIndex} is outside original.events`,
        });
      }
    });
  })
  .meta({ id: "ReplayFixture" });
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
/** Shape accepted before defaults are applied (what a JSON file may omit). */
export type ReplayFixtureInput = z.input<typeof ReplayFixtureSchema>;

export class FixtureValidationError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "FixtureValidationError";
  }
}

/** Validate parsed JSON as a fixture, with readable error messages. */
export function parseFixture(data: unknown, label = "fixture"): ReplayFixture {
  const result = ReplayFixtureSchema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
  throw new FixtureValidationError(
    `${label} is not a valid ReplayKit fixture:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n")}`,
    issues,
  );
}
