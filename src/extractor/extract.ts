/**
 * Extraction pipeline: raw log -> normalized CallLog -> findings -> fixture.
 *
 * extract() is pure and synchronous: no network, no LLM, free, milliseconds,
 * and the same output for the same input. extractAsync() adds the optional
 * LLM structure-mapping fallback for unfamiliar log formats (see
 * adapters/llm-normalizer.ts); detection and fixture generation are unchanged.
 */
import type { CallLog, ReplayFixture } from "../shared/types.js";
import { toCallLog, toCallLogAsync, type InputFormat } from "./adapters/index.js";
import type { LlmClient } from "./adapters/llm-client.js";
import { detectFailures, type Finding } from "./detectors/index.js";
import { generateFixture, type GenerateOptions } from "./generate.js";

export interface ExtractOptions extends GenerateOptions {
  format?: InputFormat;
  /** Drop findings below this confidence. Default "medium" keeps everything. */
  minConfidence?: "high" | "medium";
  /** Used as the log id when the input format has none (e.g. the file name). */
  fallbackId?: string;
}

export interface ExtractResult {
  callLog: CallLog;
  findings: Finding[];
  /** null when no failure was found: nothing is invented. */
  fixture: ReplayFixture | null;
}

export function extract(raw: unknown, options: ExtractOptions = {}): ExtractResult {
  const callLog = toCallLog(raw, options.format ?? "auto", options.fallbackId);
  const all = detectFailures(callLog);
  const findings = options.minConfidence === "high" ? all.filter((f) => f.confidence === "high") : all;
  const fixture = findings.length > 0 ? generateFixture(callLog, findings, options) : null;
  return { callLog, findings, fixture };
}

export async function extractAsync(raw: unknown, options: ExtractOptions & { llm?: LlmClient | null } = {}): Promise<ExtractResult> {
  const callLog = await toCallLogAsync(raw, { format: options.format ?? "auto", fallbackId: options.fallbackId, llm: options.llm });
  const all = detectFailures(callLog);
  const findings = options.minConfidence === "high" ? all.filter((f) => f.confidence === "high") : all;
  const fixture = findings.length > 0 ? generateFixture(callLog, findings, options) : null;
  return { callLog, findings, fixture };
}
