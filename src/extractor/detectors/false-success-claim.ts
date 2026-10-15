/**
 * false_success_claim: a tool explicitly reported failure, and the agent
 * then told the user the action succeeded.
 *
 * Fires only when BOTH sides have direct evidence: an explicit failure
 * signal in the tool result, and a success-claim sentence in the reply.
 *
 * Attribution rules, to avoid blaming a failed tool for an unrelated claim:
 * - Claims that name the tool's topic count anywhere until the tool is retried.
 * - Vague claims ("You're all set!") count only in the agent's immediate
 *   turn, and only if no other tool succeeded before them.
 */
import type { Evidence } from "../../shared/types.js";
import { relation, type Relation } from "../analysis/keywords.js";
import { immediateTurn, responseWindow, type Detector, type Finding } from "./context.js";

export const detectFalseSuccessClaim: Detector = (ctx) => {
  const findings: Finding[] = [];
  for (const interaction of ctx.interactions) {
    if (interaction.outcome.outcome !== "failure" || interaction.resultIndex === null) continue;
    const keywords = ctx.keywords(interaction.toolName);
    const turn = new Set(immediateTurn(ctx, interaction).map((m) => m.index));

    for (const message of responseWindow(ctx, interaction)) {
      const claims = message.analysis.successClaims.map((c) => ({ ...c, rel: relation(c.sentence, keywords) as Relation }));
      if (claims.length === 0) continue;
      const related = claims.filter((c) => c.rel !== "none");
      let used = related;
      if (used.length === 0) {
        if (!turn.has(message.index)) continue;
        const otherSucceeded = ctx.interactions.some(
          (i) => i.toolName !== interaction.toolName && i.outcome.outcome === "success" && i.resultIndex !== null && i.resultIndex < message.index,
        );
        if (otherSucceeded) continue;
        used = claims;
      }
      const acknowledged = message.analysis.failureAcknowledgements.length > 0;
      const byName = used.some((c) => c.rel === "name");
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
        confidence: byName && !acknowledged ? "high" : "medium",
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
