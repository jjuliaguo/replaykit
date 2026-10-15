/**
 * Overview: the one end-to-end test, run live. Each step is backed by the
 * real extractor, mock webhook, and replay engine; the checks show the
 * expected and actual values from this run.
 */
import { ArrowUpRight, Check, Minus, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type CallSummary, type E2EResponse, type GoldenStep } from "../api";
import { JsonView } from "../components/JsonView";
import { Badge, Button, ErrorNote, Label, cx } from "../components/ui";
import { href } from "../lib/router";

const OWNER: Record<GoldenStep["owner"], string> = { input: "Call log", claude: "Extractor · Claude", cursor: "Replay engine · Cursor" };

function stepLink(step: GoldenStep, example: string): string {
  switch (step.id) {
    case "capture":
      return href(["calls", example], { tab: "trace" });
    case "extract":
      return href(["calls", example], { tab: "issues" });
    case "webhook":
      return href(["tests", `call:${example}`], { tab: "definition" });
    default:
      return href(["tests", `call:${example}`], { tab: "replay" });
  }
}

function StatusIcon({ status }: { status: GoldenStep["status"] }) {
  const base = "grid size-6 shrink-0 place-items-center rounded-full border";
  if (status === "pass") return <span className={cx(base, "border-ok bg-ok text-white")}><Check size={13} strokeWidth={3} /></span>;
  if (status === "fail") return <span className={cx(base, "border-err bg-err text-white")}><X size={13} strokeWidth={3} /></span>;
  return <span className={cx(base, "border-line-strong bg-panel text-subtle")}><Minus size={13} /></span>;
}

export function OverviewPage({ calls }: { calls: CallSummary[] | null }) {
  const [example, setExample] = useState("booking-false-confirmation");
  const [result, setResult] = useState<E2EResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (name = example) => {
    setRunning(true);
    setError(null);
    try {
      setResult(await api.e2e({ example: name }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // Deterministic, local, milliseconds: run the default test on arrival.
  useEffect(() => {
    void run("booking-false-confirmation");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passed = result?.steps.filter((s) => s.status === "pass").length ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-6 py-8">
        <h1 className="text-[20px] font-semibold tracking-tight">End-to-end regression test</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
          One failed call, turned into a test, replayed, and evaluated. The extractor finds the failure and writes the fixture; the mock webhook serves the recorded
          API response over HTTP; the replay engine checks that the original agent fails and a fixed agent passes.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-3 rounded-md border border-line bg-panel p-3">
          <label className="min-w-[280px] flex-1">
            <Label>Call log</Label>
            <select
              value={example}
              onChange={(e) => setExample(e.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-line-strong bg-panel px-2 font-mono text-[12.5px]"
            >
              {(calls ?? [{ name: "booking-false-confirmation", id: "synthetic-booking-false-confirmation", findings: [{}] } as unknown as CallSummary]).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.id}
                  {c.findings.length ? "" : "  (no failure: nothing to test)"}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={() => run()} disabled={running}>
            <Play size={13} />
            {running ? "Running…" : "Run end-to-end"}
          </Button>
        </div>

        {error && <div className="mt-4"><ErrorNote error={error} /></div>}

        {result && (
          <>
            <div className={cx("mt-5 flex flex-wrap items-center gap-3 rounded-md border px-4 py-3", result.ok ? "border-ok/40 bg-ok-bg" : "border-err/40 bg-err-bg")}>
              <span className={cx("text-[15px] font-semibold", result.ok ? "text-ok" : "text-err")}>{result.ok ? "End-to-end pass" : "End-to-end fail"}</span>
              <span className="font-mono text-[12.5px] text-muted">
                {passed}/{result.steps.length} steps · {result.durationMs} ms · {result.callLogId ?? "no call log"}
              </span>
              {result.fixture?.source.kind === "synthetic" && <Badge tone="warn">synthetic data</Badge>}
            </div>

            <ol className="mt-5">
              {result.steps.map((step, i) => (
                <li key={step.id} className="relative flex gap-4 pb-5">
                  {i < result.steps.length - 1 && <span className="absolute top-7 bottom-0 left-[11px] w-px bg-line-strong" aria-hidden />}
                  <StatusIcon status={step.status} />
                  <div className="min-w-0 flex-1 rounded-md border border-line bg-panel">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                      <span className="font-mono text-[12px] text-subtle">{i + 1}</span>
                      <span className="text-[14px] font-semibold">{step.title}</span>
                      <span className="rounded border border-dashed border-line-strong px-1.5 text-[11.5px] text-muted">{OWNER[step.owner]}</span>
                      <span className="ml-auto font-mono text-[11.5px] text-subtle">{step.durationMs} ms</span>
                      {result.example && step.status !== "skipped" && (
                        <a href={stepLink(step, result.example)} className="inline-flex items-center gap-0.5 text-[12px] text-muted hover:text-ink">
                          open <ArrowUpRight size={12} />
                        </a>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <p className={cx("text-[13.5px]", step.status === "skipped" ? "text-muted" : "text-ink-2")}>{step.detail}</p>
                      {step.checks.length > 0 && (
                        <table className="mt-2.5 w-full table-fixed text-left text-[12.5px]">
                          <thead className="text-[11px] tracking-wide text-subtle uppercase">
                            <tr>
                              <th className="w-6 py-1 font-medium" />
                              <th className="w-[34%] py-1 font-medium">Check</th>
                              <th className="py-1 font-medium">Expected</th>
                              <th className="py-1 font-medium">Actual</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line border-t border-line">
                            {step.checks.map((c, k) => (
                              <tr key={k} className="align-top">
                                <td className="py-1.5">{c.ok ? <Check size={13} className="text-ok" /> : <X size={13} className="text-err" />}</td>
                                <td className="py-1.5 pr-3">{c.label}</td>
                                <td className="py-1.5 pr-3 font-mono text-[12px] break-words text-muted">{c.expected}</td>
                                <td className={cx("py-1.5 font-mono text-[12px] break-words", c.ok ? "text-ink-2" : "text-err")}>{c.actual}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {step.id === "webhook" && result.webhook && (
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                          <div>
                            <Label>Request</Label>
                            <div className="mt-1 font-mono text-[12px] break-all">
                              {result.webhook.method} {result.webhook.url}
                              {result.webhook.path}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <Label>Response {result.webhook.status}</Label>
                            <div className="mt-1">
                              <JsonView value={result.webhook.body} maxHeight={160} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <p className="text-[12.5px] text-muted">
              The fixed agent is the replay engine's deterministic stand-in, not your production agent. Running your own agent against this fixture needs a live runner,
              which this offline build does not include.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
