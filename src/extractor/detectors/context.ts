/**
 * Precomputed view of a call log shared by all detectors, so each detector
 * stays a small pure function.
 */
import type { CallLog, DetectedFailure, MessageEvent, ToolDefinition } from "../../shared/types.js";
import { analyzeMessage, type ClaimAnalysis } from "../analysis/claims.js";
import { pairInteractions, type ToolInteraction } from "../analysis/interactions.js";
import { toolKeywords } from "../analysis/keywords.js";
import { classifyToolResult, type ToolOutcome } from "../analysis/tool-outcome.js";

export interface AnalyzedInteraction extends ToolInteraction {
  outcome: ToolOutcome;
}

export interface AssistantMessage {
  index: number;
  event: MessageEvent;
  analysis: ClaimAnalysis;
}

export interface DetectionContext {
  log: CallLog;
  interactions: AnalyzedInteraction[];
  assistantMessages: AssistantMessage[];
  toolDefinitions: Map<string, ToolDefinition>;
  keywords(toolName: string): string[];
}

/** Extra knowledge a detector attaches for the fixture generator. */
export interface Finding extends DetectedFailure {
  /** Index of the assistant message that exhibits the failure. */
  messageIndex: number;
  /** callId of the tool interaction involved, if any. */
  callId?: string;
  /** Exact phrases that constituted a success claim. */
  claimPhrases?: string[];
  /** Strings from the tool response a correct reply would reflect. */
  failureSignals?: string[];
  /** For misread findings: where the tool's real value lives. */
  resultPath?: { path: string; expectedValue: import("../../shared/json.js").JsonValue };
}

export type Detector = (ctx: DetectionContext) => Finding[];

export function buildContext(log: CallLog): DetectionContext {
  const toolDefinitions = new Map(log.tools.map((t) => [t.name, t]));
  const interactions = pairInteractions(log).map((i) => ({ ...i, outcome: classifyToolResult(i.result) }));
  const assistantMessages: AssistantMessage[] = [];
  log.events.forEach((event, index) => {
    if (event.type === "message" && event.role === "assistant") {
      assistantMessages.push({ index, event, analysis: analyzeMessage(event.content) });
    }
  });
  const keywordCache = new Map<string, string[]>();
  return {
    log,
    interactions,
    assistantMessages,
    toolDefinitions,
    keywords(toolName) {
      let k = keywordCache.get(toolName);
      if (!k) {
        k = toolKeywords(toolName, toolDefinitions.get(toolName));
        keywordCache.set(toolName, k);
      }
      return k;
    },
  };
}

/**
 * Assistant messages that respond to an interaction's result: after the
 * result, and before the agent calls the same tool again (a retry starts a
 * new window).
 */
export function responseWindow(ctx: DetectionContext, interaction: AnalyzedInteraction): AssistantMessage[] {
  if (interaction.resultIndex === null) return [];
  const start = interaction.resultIndex;
  const nextCall = ctx.interactions.find((i) => i.toolName === interaction.toolName && i.callIndex > start);
  const end = nextCall ? nextCall.callIndex : Number.POSITIVE_INFINITY;
  return ctx.assistantMessages.filter((m) => m.index > start && m.index < end);
}
