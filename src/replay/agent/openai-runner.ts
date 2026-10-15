import type { ReplayFixture } from "../../shared/fixture.js";
import type { ReplayTrace } from "../types.js";

/**
 * Optional live agent runner. Intentionally not invoked by `npm run demo` or tests.
 *
 * A live run requires ALL of:
 *   1. `--live` on the CLI
 *   2. OPENAI_API_KEY in the environment
 *   3. an explicit operator choice to spend money
 *
 * This file never imports the OpenAI SDK so installing ReplayKit cannot
 * accidentally create billed traffic. Wire a real client here when a live
 * integration is approved.
 */
export function liveRunBlockReason(liveFlag: boolean, apiKey: string | undefined): string | null {
  if (!liveFlag) return "Live OpenAI replay is disabled unless you pass --live.";
  if (!apiKey) return "OPENAI_API_KEY is not set. ReplayKit will not invent a live result.";
  return "Live OpenAI replay is implemented as a guarded stub. It refuses to call a paid API without explicit project approval.";
}

export async function runLiveAgent(_fixture: ReplayFixture): Promise<ReplayTrace> {
  throw new Error(liveRunBlockReason(true, process.env.OPENAI_API_KEY) ?? "Live runner refused to start.");
}
