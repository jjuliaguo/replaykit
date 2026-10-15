import type { JsonValue } from "../../shared/json.js";
import type { ReplayFixture } from "../../shared/fixture.js";
import { ReplaySession, resultPayload } from "../session.js";
import type { ReplayMessage, ReplayTrace, ReplayToolCall } from "../types.js";

export type ScriptStep =
  | { type: "tool_call"; toolName: string; arguments: JsonValue }
  | { type: "message"; content: string };

export type AgentScript = {
  id: string;
  description?: string;
  steps: ScriptStep[];
};

export async function runScriptedAgent(fixture: ReplayFixture, script: AgentScript): Promise<ReplayTrace> {
  const started = Date.now();
  const session = new ReplaySession(fixture);
  const messages: ReplayMessage[] = fixture.scenario.messages.map((m) => ({ role: m.role, content: m.content }));
  const toolCalls: ReplayToolCall[] = [];
  let status: ReplayTrace["status"] = "completed";
  let error: string | undefined;
  let finalMessage: string | undefined;

  for (const step of script.steps) {
    if (session.aborted) {
      status = "aborted";
      error = session.abortReason;
      break;
    }
    if (step.type === "message") {
      messages.push({ role: "assistant", content: step.content });
      finalMessage = step.content;
      continue;
    }
    const callId = session.nextCallId();
    const result = session.invoke(step.toolName, step.arguments);
    toolCalls.push({ callId, toolName: step.toolName, arguments: step.arguments, result });
    messages.push({
      role: "assistant",
      content: `*[tool call ${step.toolName}]*`,
    });
    messages.push({
      role: "tool",
      toolCallId: callId,
      content: JSON.stringify(resultPayload(result)),
    });
    if (result.kind === "fail_run") {
      status = "aborted";
      error = result.reason;
      break;
    }
  }

  return {
    agentId: script.id,
    agentKind: "scripted",
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    status,
    error,
    messages,
    toolCalls,
    finalMessage,
  };
}

/** Reproduce the original assistant's last message after replaying recorded tool calls. */
export function originalFailureScript(fixture: ReplayFixture): AgentScript {
  const steps: ScriptStep[] = [];
  for (const interaction of fixture.replay.interactions) {
    steps.push({
      type: "tool_call",
      toolName: interaction.toolName,
      arguments: interaction.recordedArguments,
    });
  }
  const spoken = fixture.original.finalAgentMessage;
  if (spoken) steps.push({ type: "message", content: spoken });
  return { id: "original", description: "Replays recorded tool calls, then the original assistant reply.", steps };
}
