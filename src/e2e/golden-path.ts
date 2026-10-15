/**
 * The golden path: one regression test, end to end, across all three parts.
 *
 *   call log ──Claude's extractor──> failure + fixture
 *            ──Cursor's mock server──> webhook returns the recording verbatim
 *            ──Cursor's replay engine──> original agent FAILS, candidate PASSES
 *
 * Every step records what it checked and the actual values it saw. A step
 * passes only on evidence from this run; nothing is precomputed or assumed.
 * The UI (POST /api/e2e), the CLI (npm run e2e), and the test suite all run
 * this same function.
 */
import type { JsonValue } from "../shared/json.js";
import { parseFixture, type ReplayFixture } from "../shared/types.js";
import { extract, type ExtractResult } from "../extractor/extract.js";
import { listenMockServer } from "../replay/mock-server.js";
import { runReplaySuite } from "../replay/pipeline.js";
import type { ReplayKitReport } from "../replay/types.js";

export type StepStatus = "pass" | "fail" | "skipped";

export interface Step {
  id: "capture" | "extract" | "webhook" | "reproduce" | "verify";
  title: string;
  owner: "input" | "claude" | "cursor";
  status: StepStatus;
  /** One sentence: what this run showed. */
  detail: string;
  /** Concrete values behind the verdict. */
  checks: Array<{ label: string; expected: string; actual: string; ok: boolean }>;
  durationMs: number;
}

export interface GoldenPathResult {
  ok: boolean;
  steps: Step[];
  callLogId: string | null;
  fixture: ReplayFixture | null;
  report: ReplayKitReport | null;
  webhook: { url: string; method: string; path: string; status: number; body: JsonValue } | null;
  baseline: string;
  candidate: string;
}

export interface GoldenPathOptions {
  /** Raw call log (any supported format). */
  log: unknown;
  fallbackId?: string;
  baseline?: "original" | "naive" | "skip" | "honor";
  candidate?: "honor";
}

const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const v = await fn();
  return [v, Math.round((performance.now() - t) * 10) / 10];
}

function skipped(id: Step["id"], title: string, owner: Step["owner"], why: string): Step {
  return { id, title, owner, status: "skipped", detail: why, checks: [], durationMs: 0 };
}

export async function runGoldenPath(options: GoldenPathOptions): Promise<GoldenPathResult> {
  const baseline = options.baseline ?? "original";
  const candidate = options.candidate ?? "honor";
  const steps: Step[] = [];
  const result: GoldenPathResult = { ok: false, steps, callLogId: null, fixture: null, report: null, webhook: null, baseline, candidate };

  // 1. Capture: the call log parses into the normalized format.
  let extracted: ExtractResult | null = null;
  let extractError: string | null = null;
  const [, t1] = await timed(async () => {
    try {
      extracted = extract(options.log, { fallbackId: options.fallbackId ?? "call-log" });
    } catch (e) {
      extractError = (e as Error).message;
    }
  });
  const ex = extracted as ExtractResult | null;
  if (!ex) {
    steps.push({ id: "capture", title: "Load call log", owner: "input", status: "fail", detail: extractError ?? "could not read the call log", checks: [], durationMs: t1 });
    steps.push(skipped("extract", "Detect failure and generate test", "claude", "No call log."));
    steps.push(skipped("webhook", "Serve recorded response over HTTP", "cursor", "No fixture."));
    steps.push(skipped("reproduce", "Original agent reproduces the failure", "cursor", "No fixture."));
    steps.push(skipped("verify", "Fixed agent passes", "cursor", "No fixture."));
    return result;
  }
  result.callLogId = ex.callLog.id;
  const toolResults = ex.callLog.events.filter((e) => e.type === "tool_result").length;
  steps.push({
    id: "capture",
    title: "Load call log",
    owner: "input",
    status: "pass",
    detail: `${ex.callLog.id}: ${ex.callLog.events.length} events, ${toolResults} tool result(s), ${ex.callLog.kind} data from ${ex.callLog.provider}.`,
    checks: [{ label: "events parsed", expected: "≥ 1", actual: String(ex.callLog.events.length), ok: ex.callLog.events.length > 0 }],
    durationMs: t1,
  });

  // 2. Extract (Claude): a failure is found and a schema-valid fixture is produced.
  const fixture = ex.fixture;
  let schemaOk = false;
  try {
    if (fixture) parseFixture(JSON.parse(JSON.stringify(fixture)));
    schemaOk = !!fixture;
  } catch {
    schemaOk = false;
  }
  const extractOk = ex.findings.length > 0 && schemaOk;
  steps.push({
    id: "extract",
    title: "Detect failure and generate test",
    owner: "claude",
    status: extractOk ? "pass" : "fail",
    detail: extractOk
      ? `${ex.findings.map((f) => `${f.type} (${f.confidence})`).join(", ")}. Fixture ${fixture!.id} with ${fixture!.expectations.length} expectations.`
      : "No failure detected, so there is no regression test to run.",
    checks: [
      { label: "findings", expected: "≥ 1", actual: String(ex.findings.length), ok: ex.findings.length > 0 },
      { label: "fixture valid against shared schema", expected: "yes", actual: schemaOk ? "yes" : "no", ok: schemaOk },
    ],
    durationMs: 0,
  });
  if (!extractOk || !fixture) {
    steps.push(skipped("webhook", "Serve recorded response over HTTP", "cursor", "No fixture to serve."));
    steps.push(skipped("reproduce", "Original agent reproduces the failure", "cursor", "No fixture to replay."));
    steps.push(skipped("verify", "Fixed agent passes", "cursor", "No fixture to replay."));
    return result;
  }
  result.fixture = fixture;

  // 3. Webhook (Cursor's mock server): POST the recorded arguments over real
  //    HTTP and confirm the response equals the recording, byte for byte as JSON.
  const pinned = fixture.replay.interactions.find((i) => i.response);
  if (!pinned) {
    steps.push(skipped("webhook", "Serve recorded response over HTTP", "cursor", "This fixture has no recorded HTTP response to serve (the original agent never got one)."));
  } else {
    const tool = fixture.tools.find((t) => t.name === pinned.toolName);
    let path = `/tools/${encodeURIComponent(pinned.toolName)}`;
    let method = "POST";
    if (tool?.endpoint?.url) {
      try {
        path = new URL(tool.endpoint.url).pathname.replace(/\/$/, "") || "/";
        method = (tool.endpoint.method ?? "POST").toUpperCase();
      } catch {
        /* keep the generic /tools/<name> route */
      }
    }
    const [hook, t3] = await timed(async () => {
      const server = await listenMockServer(fixture, 0);
      try {
        const res = await fetch(server.url + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(pinned.recordedArguments) });
        const text = await res.text();
        let body: JsonValue = text;
        try {
          body = JSON.parse(text) as JsonValue;
        } catch {
          /* non-JSON body stays a string */
        }
        return { url: server.url, status: res.status, body, logged: server.log.at(-1) };
      } finally {
        await server.close();
      }
    });
    const expectedStatus = pinned.response!.status ?? 200;
    const statusOk = hook.status === expectedStatus;
    const bodyOk = deepEqual(hook.body, pinned.response!.body);
    const matched = hook.logged?.matched === true;
    result.webhook = { url: hook.url, method, path, status: hook.status, body: hook.body };
    steps.push({
      id: "webhook",
      title: "Serve recorded response over HTTP",
      owner: "cursor",
      status: statusOk && bodyOk && matched ? "pass" : "fail",
      detail: `${method} ${path} on the mock webhook returned ${hook.status} ${s(hook.body)}.`,
      checks: [
        { label: "matched a recording", expected: "yes", actual: matched ? `yes (${pinned.id})` : "no", ok: matched },
        { label: "HTTP status", expected: String(expectedStatus), actual: String(hook.status), ok: statusOk },
        { label: "body equals recording", expected: s(pinned.response!.body), actual: s(hook.body), ok: bodyOk },
      ],
      durationMs: t3,
    });
  }

  // 4 + 5. Replay (Cursor): the baseline must FAIL (the test reproduces the bug)
  //        and the candidate must PASS (the test recognizes a fix).
  const [report, t4] = await timed(() =>
    runReplaySuite(fixture, [baseline === "original" ? { type: "original" } : { type: "policy", policy: baseline }, { type: "policy", policy: candidate }]),
  );
  result.report = report;
  const [base, cand] = report.runs;
  const failed = (r: typeof base) => (r ? r.expectationResults.filter((e) => e.outcome === "fail").map((e) => e.id) : []);
  steps.push({
    id: "reproduce",
    title: "Original agent reproduces the failure",
    owner: "cursor",
    status: base?.overall === "fail" ? "pass" : "fail",
    detail:
      base?.overall === "fail"
        ? `${base.trace.agentId} fails ${failed(base).length} of ${base.expectationResults.length} expectations: the test catches the original bug.`
        : `${base?.trace.agentId ?? baseline} passed, so this test does not catch the original failure.`,
    checks: [
      { label: `${baseline} overall`, expected: "fail", actual: base?.overall ?? "missing", ok: base?.overall === "fail" },
      { label: "failed expectations", expected: "≥ 1", actual: failed(base).join(", ") || "none", ok: failed(base).length > 0 },
    ],
    durationMs: t4,
  });
  const regressed = report.comparison?.regressed.length ?? 0;
  steps.push({
    id: "verify",
    title: "Fixed agent passes",
    owner: "cursor",
    status: cand?.overall === "pass" && regressed === 0 ? "pass" : "fail",
    detail:
      cand?.overall === "pass"
        ? `${cand.trace.agentId} passes all ${cand.passed} evaluated expectations. Its reply: “${cand.trace.finalMessage ?? ""}”`
        : `${cand?.trace.agentId ?? candidate} still fails: ${failed(cand).join(", ")}.`,
    checks: [
      { label: `${candidate} overall`, expected: "pass", actual: cand?.overall ?? "missing", ok: cand?.overall === "pass" },
      { label: "fixed vs baseline", expected: "≥ 1", actual: String(report.comparison?.improved.length ?? 0), ok: (report.comparison?.improved.length ?? 0) > 0 },
      { label: "regressions", expected: "0", actual: String(regressed), ok: regressed === 0 },
    ],
    durationMs: 0,
  });

  result.ok = steps.every((st) => st.status === "pass" || (st.status === "skipped" && st.id === "webhook"));
  return result;
}
