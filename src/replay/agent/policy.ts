import { isJsonObject, type JsonValue } from "../../shared/json.js";
import type { ReplayFixture } from "../../shared/fixture.js";
import { ReplaySession, resultPayload } from "../session.js";
import type { ReplayMessage, ReplayTrace, ReplayToolCall, ToolInvokeResult } from "../types.js";

export const POLICY_IDS = ["naive", "honor", "skip"] as const;
export type PolicyId = (typeof POLICY_IDS)[number];

export function isPolicyId(value: string): value is PolicyId {
  return (POLICY_IDS as readonly string[]).includes(value);
}

/**
 * Deterministic stand-ins for agent versions. They exist so ReplayKit can be
 * demonstrated and tested without paid model calls. They are not the product's
 * long-term runner — see openai-runner.ts for the optional live path.
 */
export async function runPolicyAgent(fixture: ReplayFixture, policy: PolicyId): Promise<ReplayTrace> {
  const started = Date.now();
  const session = new ReplaySession(fixture);
  const messages: ReplayMessage[] = fixture.scenario.messages.map((m) => ({ role: m.role, content: m.content }));
  const toolCalls: ReplayToolCall[] = [];

  if (policy !== "skip") {
    for (const planned of plannedCalls(fixture, policy)) {
      const callId = session.nextCallId();
      const result = session.invoke(planned.toolName, planned.arguments);
      toolCalls.push({ callId, toolName: planned.toolName, arguments: planned.arguments, result });
      messages.push({ role: "assistant", content: `*[tool call ${planned.toolName}]*` });
      messages.push({ role: "tool", toolCallId: callId, content: JSON.stringify(resultPayload(result)) });
      if (result.kind === "fail_run") {
        return finish(policy, started, messages, toolCalls, "aborted", result.reason, undefined);
      }
    }
  }

  const spoken =
    policy === "naive" || policy === "skip"
      ? naiveSuccessMessage(fixture)
      : honorMessage(fixture, toolCalls);

  messages.push({ role: "assistant", content: spoken });
  return finish(policy, started, messages, toolCalls, "completed", undefined, spoken);
}

function finish(
  policy: PolicyId,
  started: number,
  messages: ReplayMessage[],
  toolCalls: ReplayToolCall[],
  status: ReplayTrace["status"],
  error: string | undefined,
  finalMessage: string | undefined,
): ReplayTrace {
  return {
    agentId: `policy:${policy}`,
    agentKind: "policy",
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    status,
    error,
    messages,
    toolCalls,
    finalMessage,
  };
}

function plannedCalls(fixture: ReplayFixture, policy: PolicyId): Array<{ toolName: string; arguments: JsonValue }> {
  if (fixture.replay.interactions.length > 0) {
    return fixture.replay.interactions.map((i) => ({ toolName: i.toolName, arguments: i.recordedArguments }));
  }
  if (policy !== "honor") return [];
  const names = fixture.workflow?.requiredTools ?? fixture.tools.map((t) => t.name);
  return names.map((toolName) => ({ toolName, arguments: {} }));
}

function naiveSuccessMessage(fixture: ReplayFixture): string {
  const tool = fixture.replay.interactions[0]?.toolName ?? fixture.tools[0]?.name ?? "the request";
  return `Great news — that's confirmed. I went ahead and completed ${tool} for you. You're all set!`;
}

function honorMessage(fixture: ReplayFixture, calls: ReplayToolCall[]): string {
  const failed = calls.filter((c) => indicatesFailure(c.result));
  if (calls.length === 0) {
    return "I have not taken any action yet because I still need to call the required tool.";
  }
  if (failed.length === 0) {
    return "The tool reported success, so I can confirm that this completed.";
  }
  const parts = failed.map((call) => {
    const detail = failureDetail(call.result);
    return `${call.toolName} did not succeed${detail ? ` (${detail})` : ""}.`;
  });
  const label = (fixture.replay.interactions[0]?.toolName ?? fixture.tools[0]?.name ?? "the request").replaceAll("_", " ");
  return `I wasn't able to complete ${label}. ${parts.join(" ")} Nothing is confirmed. If you'd like, we can try a different option.`;
}

export function indicatesFailure(result: ToolInvokeResult): boolean {
  if (result.kind === "error" || result.kind === "fail_run" || result.kind === "unmatched") return true;
  if (result.status !== undefined && result.status >= 400) return true;
  const body = result.body;
  if (!isJsonObject(body)) return false;
  if (body.success === false || body.ok === false) return true;
  if (typeof body.error === "string" && body.error.length > 0) return true;
  if (isJsonObject(body.error)) return true;
  return false;
}

function failureDetail(result: ToolInvokeResult): string | undefined {
  if (result.kind === "error") return result.error?.message;
  if (result.kind === "response" && isJsonObject(result.body) && typeof result.body.message === "string") {
    return result.body.message;
  }
  if (result.kind === "unmatched") return "no recorded interaction matched";
  return undefined;
}

