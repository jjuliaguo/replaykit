/**
 * unhandled_tool_error: a tool failed, and the agent's whole immediate turn
 * (every assistant message before the user speaks again or the tool is
 * retried) neither told the user about the failure nor claimed success
 * (that case is a false_success_claim). Example: the order lookup timed out
 * and the agent answered as if it had data.
 *
 * Medium confidence by design: "did not acknowledge" relies on the absence
 * of failure language, which is weaker evidence than a direct claim.
 * Not fired when the agent retried before replying, or never replied.
 */
import { immediateTurn, type Detector, type Finding } from "./context.js";

export const detectUnhandledToolError: Detector = (ctx) => {
  const findings: Finding[] = [];
  for (const interaction of ctx.interactions) {
    if (interaction.outcome.outcome !== "failure" || interaction.resultIndex === null) continue;
    const turn = immediateTurn(ctx, interaction);
    if (turn.length === 0) continue;
    if (turn.some((m) => m.analysis.failureAcknowledgements.length > 0 || m.analysis.successClaims.length > 0)) continue;

    const last = turn[turn.length - 1]!;
    const signal = interaction.outcome.signals.find((s) => s.outcome === "failure")!;
    const said = turn.map((m) => m.event.content).join(" ");
    findings.push({
      type: "unhandled_tool_error",
      summary: `${interaction.toolName} failed (${signal.reason}), and the agent's reply did not tell the user: "${said}"`,
      toolName: interaction.toolName,
      confidence: "medium",
      detector: "unhandled-tool-error",
      evidence: [
        { eventIndex: interaction.resultIndex, description: `${interaction.toolName} failed (${signal.reason})`, path: signal.path, quote: signal.value },
        ...turn.map((m) => ({ eventIndex: m.index, description: "Agent reply with no failure acknowledgement", quote: m.event.content })),
      ],
      messageIndex: last.index,
      callId: interaction.callId,
      failureSignals: interaction.outcome.messages,
    });
  }
  return findings;
};
