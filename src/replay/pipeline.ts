import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplayFixture } from "../shared/fixture.js";
import { originalFailureScript, runScriptedAgent, type AgentScript } from "./agent/scripted.js";
import { isPolicyId, runPolicyAgent, type PolicyId } from "./agent/policy.js";
import { liveRunBlockReason } from "./agent/openai-runner.js";
import { evaluateRun } from "./evaluate/evaluate.js";
import { compareRuns } from "./report/compare.js";
import { renderHtmlReport } from "./report/html-report.js";
import { buildReport } from "./report/json-report.js";
import type { EvaluatedRun, ReplayKitReport } from "./types.js";

export type AgentSpec = { type: "scripted"; script: AgentScript } | { type: "policy"; policy: PolicyId } | { type: "original" };

export async function runAgent(fixture: ReplayFixture, spec: AgentSpec): Promise<EvaluatedRun> {
  const trace =
    spec.type === "policy"
      ? await runPolicyAgent(fixture, spec.policy)
      : await runScriptedAgent(fixture, spec.type === "original" ? originalFailureScript(fixture) : spec.script);
  return evaluateRun(fixture, trace);
}

export async function runReplaySuite(
  fixture: ReplayFixture,
  specs: AgentSpec[],
  options: { mode?: "offline" | "live" } = {},
): Promise<ReplayKitReport> {
  const runs: EvaluatedRun[] = [];
  for (const spec of specs) {
    runs.push(await runAgent(fixture, spec));
  }
  const comparison = runs.length >= 2 ? compareRuns(runs[0]!, runs[runs.length - 1]!) : undefined;
  return buildReport(fixture, runs, { mode: options.mode ?? "offline", comparison });
}

export function writeReports(report: ReplayKitReport, outDir: string, basename = "report"): { jsonPath: string; htmlPath: string } {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${basename}.json`);
  const htmlPath = join(outDir, `${basename}.html`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(htmlPath, renderHtmlReport(report), "utf8");
  return { jsonPath, htmlPath };
}

export function parseAgentToken(token: string): AgentSpec {
  if (token === "original") return { type: "original" };
  if (token.startsWith("policy:")) {
    const id = token.slice("policy:".length);
    if (!isPolicyId(id)) throw new Error(`Unknown policy "${id}". Use naive, honor, or skip.`);
    return { type: "policy", policy: id };
  }
  if (isPolicyId(token)) return { type: "policy", policy: token };
  throw new Error(`Unknown agent "${token}". Try original, naive, honor, skip.`);
}

export function refuseLive(liveFlag: boolean, apiKey: string | undefined): string | null {
  return liveRunBlockReason(liveFlag, apiKey);
}
