import type { JsonValue } from "../shared/json.js";
import type { ReplayFixture, ReplayInteraction } from "../shared/fixture.js";
import { jsonEqual, pickKeys } from "./json-path.js";
import type { ToolInvokeResult } from "./types.js";

export type SessionLogEntry = {
  at: string;
  toolName: string;
  arguments: JsonValue;
  result: ToolInvokeResult;
};

/**
 * Stateful matcher: each recorded interaction is consumed at most once.
 * Recorded response bodies are returned as-is — never rewritten.
 */
export class ReplaySession {
  private readonly unused = new Set<string>();
  readonly log: SessionLogEntry[] = [];
  aborted = false;
  abortReason?: string;
  private callSeq = 0;

  constructor(private readonly fixture: ReplayFixture) {
    for (const interaction of fixture.replay.interactions) {
      this.unused.add(interaction.id);
    }
  }

  nextCallId(): string {
    this.callSeq += 1;
    return `replay_call_${this.callSeq}`;
  }

  invoke(toolName: string, args: JsonValue): ToolInvokeResult {
    const result = this.match(toolName, args);
    this.log.push({ at: new Date().toISOString(), toolName, arguments: args, result });
    if (result.kind === "fail_run") {
      this.aborted = true;
      this.abortReason = result.reason;
    }
    return result;
  }

  private match(toolName: string, args: JsonValue): ToolInvokeResult {
    for (const interaction of this.fixture.replay.interactions) {
      if (!this.unused.has(interaction.id)) continue;
      if (interaction.toolName !== toolName) continue;
      if (!this.satisfies(interaction, args)) continue;
      this.unused.delete(interaction.id);
      return this.toResult(interaction);
    }

    const reason = `No recorded interaction matched tool "${toolName}".`;
    if (this.fixture.replay.onUnmatchedCall === "fail_run") {
      return { matched: false, kind: "fail_run", reason };
    }

    return {
      matched: false,
      kind: "unmatched",
      status: 404,
      body: {
        replaykit: true,
        unmatched: true,
        message: reason,
        toolName,
        arguments: args,
      },
    };
  }

  private satisfies(interaction: ReplayInteraction, args: JsonValue): boolean {
    if (interaction.match.strategy === "sequence") return true;
    const keys = interaction.match.argumentKeys;
    if (!keys || keys.length === 0) {
      return jsonEqual(interaction.recordedArguments, args);
    }
    return jsonEqual(pickKeys(interaction.recordedArguments, keys), pickKeys(args, keys));
  }

  private toResult(interaction: ReplayInteraction): ToolInvokeResult {
    if (interaction.error) {
      return {
        matched: true,
        kind: "error",
        interactionId: interaction.id,
        strategy: interaction.match.strategy,
        error: interaction.error,
      };
    }
    const response = interaction.response;
    return {
      matched: true,
      kind: "response",
      interactionId: interaction.id,
      strategy: interaction.match.strategy,
      status: response?.status,
      headers: response?.headers,
      body: response?.body,
    };
  }
}

export function resultPayload(result: ToolInvokeResult): JsonValue {
  if (result.kind === "response") {
    if (result.body !== undefined) return result.body;
    return { status: result.status ?? 200 };
  }
  if (result.kind === "error") {
    return { replaykit: true, simulatedError: true, kind: result.error?.kind ?? "unknown", message: result.error?.message ?? "tool error" };
  }
  if (result.kind === "fail_run") {
    return { replaykit: true, abort: true, message: result.reason };
  }
  return result.body ?? { replaykit: true, unmatched: true };
}
