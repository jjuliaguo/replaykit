import type { CallLog } from "../../shared/types.js";
import { buildContext, type Detector, type Finding } from "./context.js";
import { detectFabricatedReference } from "./fabricated-reference.js";
import { detectFalseSuccessClaim } from "./false-success-claim.js";
import { detectUnhandledToolError } from "./unhandled-tool-error.js";
import { detectUnverifiedSuccessClaim } from "./unverified-success-claim.js";

export type { Finding } from "./context.js";

/** Order matters only for report readability: most severe first. */
export const DETECTORS: ReadonlyArray<{ name: string; run: Detector }> = [
  { name: "false-success-claim", run: detectFalseSuccessClaim },
  { name: "unverified-success-claim", run: detectUnverifiedSuccessClaim },
  { name: "fabricated-reference", run: detectFabricatedReference },
  { name: "unhandled-tool-error", run: detectUnhandledToolError },
];

export function detectFailures(log: CallLog, detectors = DETECTORS): Finding[] {
  const ctx = buildContext(log);
  const findings = detectors.flatMap((d) => d.run(ctx));
  // A failed call that later led to a false success claim is reported once,
  // as the claim (the stronger, more specific finding).
  const claimed = new Set(findings.filter((f) => f.type === "false_success_claim" && f.callId).map((f) => f.callId));
  return findings.filter((f) => !(f.type === "unhandled_tool_error" && f.callId && claimed.has(f.callId)));
}
