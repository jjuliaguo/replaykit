/**
 * unhandled_tool_error: a tool failed, and the agent's next reply neither
 * told the user about the failure nor claimed success (that case is a
 * false_success_claim). Example: the order lookup timed out and the agent
 * moved on as if nothing happened.
 *
 * Medium confidence by design: "did not acknowledge" relies on the absence
 * of failure language, which is weaker evidence than a direct claim.
 * Not fired when the agent retried before replying, or never replied.
 */
import { responseWindow, type Detector, type Finding } from "./context.js";

export const detectUnhandledToolError: Detector = (ctx) => {
  const findings: Finding[] = [];
  for (const interaction of ctx.interactions) {
    if (interaction.outcome.outcome !== "failure" || interaction.resultIndex === null) continue;
    const next = responseWindow(ctx, interaction)[0];
    if (!next) continue;
    if (next.analysis.failureAcknowledgements.length > 0 || next.analysis.successClaims.length > 0) continue;

    const signal = interaction.outcome.signals.find((s) => s.outcome === "failure")!;
    findings.push({
      type: "unhandled_tool_error",
      summary: `${interaction.toolName} failed (${signal.reason}), and the agent's reply did not tell the user: "${next.event.content}"`,
      toolName: interaction.toolName,
      confidence: "medium",
      detector: "unhandled-tool-error",
      evidence: [
        { eventIndex: interaction.resultIndex, description: `${interaction.toolName} failed (${signal.reason})`, path: signal.path, quote: signal.value },
        { eventIndex: next.index, description: "Agent's next reply contains no failure acknowledgement", quote: next.event.content },
      ],
      messageIndex: next.index,
      callId: interaction.callId,
      failureSignals: interaction.outcome.messages,
    });
  }
  return findings;
};
