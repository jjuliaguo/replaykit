import type { EvaluatedRun, ExpectationDelta, RunComparison } from "../types.js";

export function compareRuns(baseline: EvaluatedRun, candidate: EvaluatedRun): RunComparison {
  const improved: ExpectationDelta[] = [];
  const stillFailing: ExpectationDelta[] = [];
  const regressed: ExpectationDelta[] = [];
  const unchangedPass: string[] = [];

  const candidateById = new Map(candidate.expectationResults.map((r) => [r.id, r]));
  for (const left of baseline.expectationResults) {
    const right = candidateById.get(left.id);
    if (!right) continue;
    if (left.outcome === "fail" && right.outcome === "pass") {
      improved.push({ id: left.id, description: left.description, from: left.outcome, to: right.outcome });
    } else if (left.outcome === "fail" && right.outcome === "fail") {
      stillFailing.push({ id: left.id, description: left.description, from: left.outcome, to: right.outcome });
    } else if (left.outcome === "pass" && right.outcome === "fail") {
      regressed.push({ id: left.id, description: left.description, from: left.outcome, to: right.outcome });
    } else if (left.outcome === "pass" && right.outcome === "pass") {
      unchangedPass.push(left.id);
    }
  }

  return {
    baselineId: baseline.trace.agentId,
    candidateId: candidate.trace.agentId,
    improved,
    stillFailing,
    regressed,
    unchangedPass,
  };
}
