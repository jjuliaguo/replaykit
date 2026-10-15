import type { ReplayFixture } from "../../shared/fixture.js";
import type { EvaluatedRun, ReplayKitReport, RunComparison } from "../types.js";

export function buildReport(
  fixture: ReplayFixture,
  runs: EvaluatedRun[],
  options: { mode: "offline" | "live"; comparison?: RunComparison } = { mode: "offline" },
): ReplayKitReport {
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    fixture: {
      id: fixture.id,
      name: fixture.name,
      description: fixture.description,
      sourceKind: fixture.source.kind,
      sourceProvider: fixture.source.provider,
    },
    recordedInteractions: fixture.replay.interactions.map((i) => ({
      id: i.id,
      toolName: i.toolName,
      status: i.response?.status,
      body: i.response?.body,
      error: i.error,
    })),
    original: {
      finalAgentMessage: fixture.original.finalAgentMessage,
      failures: fixture.failures.map((f) => ({ type: f.type, summary: f.summary, confidence: f.confidence })),
    },
    runs,
    comparison: options.comparison,
  };
}
