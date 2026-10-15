/**
 * unverified_success_claim: the agent claimed an action succeeded without
 * ever calling the tool that performs it.
 *
 * A missing tool call is only a failure when the workflow required it, so
 * this detector does nothing unless the log declares
 * `workflow.requiredTools`. It never guesses which tools were required.
 */
import { mentionedKeywords } from "../analysis/keywords.js";
import type { Detector, Finding } from "./context.js";

export const detectUnverifiedSuccessClaim: Detector = (ctx) => {
  const required = ctx.log.workflow?.requiredTools ?? [];
  if (required.length === 0) return [];
  const findings: Finding[] = [];
  const reported = new Set<string>();

  for (const message of ctx.assistantMessages) {
    if (message.analysis.successClaims.length === 0) continue;
    for (const toolName of required) {
      if (reported.has(toolName)) continue;
      const calledBefore = ctx.interactions.some((i) => i.toolName === toolName && i.callIndex < message.index);
      if (calledBefore) continue;
      const keywords = ctx.keywords(toolName);
      const related = message.analysis.successClaims.filter((c) => mentionedKeywords(c.sentence, keywords).length > 0);
      // With several required tools, an unrelated claim cannot be attributed to any one of them.
      if (related.length === 0 && required.length > 1) continue;
      const used = related.length > 0 ? related : message.analysis.successClaims;
      reported.add(toolName);
      findings.push({
        type: "unverified_success_claim",
        summary: `The agent claimed success ("${used[0]!.sentence}") without calling ${toolName}, which the workflow requires.`,
        toolName,
        confidence: related.length > 0 ? "high" : "medium",
        detector: "unverified-success-claim",
        evidence: used.map((c) => ({
          eventIndex: message.index,
          description: `Agent claimed success; ${toolName} had not been called`,
          quote: c.sentence,
        })),
        messageIndex: message.index,
        claimPhrases: [...new Set(used.map((c) => c.phrase))],
      });
    }
  }
  return findings;
};
