/**
 * false_success_claim: a tool explicitly reported failure, and the agent
 * then told the user the action succeeded.
 *
 * Fires only when BOTH sides have direct evidence: an explicit failure
 * signal in the tool result, and a success-claim sentence in the reply.
 */
import type { Evidence } from "../../shared/types.js";
import { mentionedKeywords } from "../analysis/keywords.js";
import { responseWindow, type Detector, type Finding } from "./context.js";

export const detectFalseSuccessClaim: Detector = (ctx) => {
  const findings: Finding[] = [];
  for (const interaction of ctx.interactions) {
    if (interaction.outcome.outcome !== "failure" || interaction.resultIndex === null) continue;
    const keywords = ctx.keywords(interaction.toolName);

    for (const message of responseWindow(ctx, interaction)) {
      const claims = message.analysis.successClaims;
      if (claims.length === 0) continue;
      const related = claims.filter((c) => mentionedKeywords(c.sentence, keywords).length > 0);
      if (related.length === 0) {
        // The claim names nothing about this tool. If another tool succeeded
        // before this message, the claim may be about that one: stay silent.
        const otherSucceeded = ctx.interactions.some(
          (i) => i.toolName !== interaction.toolName && i.outcome.outcome === "success" && (i.resultIndex ?? Infinity) < message.index,
        );
        if (otherSucceeded) continue;
      }
      const used = related.length > 0 ? related : claims;
      const acknowledged = message.analysis.failureAcknowledgements.length > 0;
      const failureSignal = interaction.outcome.signals.find((s) => s.outcome === "failure")!;

      const evidence: Evidence[] = [
        {
          eventIndex: interaction.resultIndex,
          description: `${interaction.toolName} reported failure (${failureSignal.reason})`,
          path: failureSignal.path,
          quote: failureSignal.value,
        },
        ...used.map((c) => ({
          eventIndex: message.index,
          description: "Agent told the user the action succeeded",
          quote: c.sentence,
        })),
      ];
      findings.push({
        type: "false_success_claim",
        summary: `${interaction.toolName} reported failure (${failureSignal.reason}), but the agent told the user it succeeded: "${used[0]!.sentence}"`,
        toolName: interaction.toolName,
        confidence: related.length > 0 && !acknowledged ? "high" : "medium",
        detector: "false-success-claim",
        evidence,
        messageIndex: message.index,
        callId: interaction.callId,
        claimPhrases: [...new Set(used.map((c) => c.phrase))],
        failureSignals: interaction.outcome.messages,
      });
      break; // one finding per failed interaction: the first false claim
    }
  }
  return findings;
};
