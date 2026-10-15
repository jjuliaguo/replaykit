/**
 * Extraction pipeline: raw log -> normalized CallLog -> findings -> fixture.
 *
 * Pure and synchronous apart from file I/O in the CLI. No network, no LLM:
 * extraction is free, takes milliseconds, and gives the same output for the
 * same input.
 */
import type { CallLog, ReplayFixture } from "../shared/types.js";
import { toCallLog, type InputFormat } from "./adapters/index.js";
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
