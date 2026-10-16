/**
 * Overview: the one end-to-end test, run live. Each step is backed by the
 * real extractor, mock webhook, and replay engine; the checks show the
 * expected and actual values from this run.
 */
import { ArrowUpRight, Check, Minus, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type CallSummary, type E2EResponse, type GoldenStep } from "../api";
import { JsonView } from "../components/JsonView";
import { Badge, Button, ErrorNote, Label, Segmented, cx } from "../components/ui";
import { EXAMPLE_COPY, exampleCopy } from "../lib/examples";
import { FAILURE_LABEL } from "../lib/format";
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

const PASTE_PLACEHOLDER = `Paste a call log. Any of these work:

  • Bland call details (the JSON from GET /v1/calls/{id})
  • Retell or Vapi call objects
  • OpenAI or Anthropic message lists, or any JSON list of {role, content}
  • A plain transcript, one "Speaker: text" line per turn

Failures are only detectable when the log includes tool calls
and the API responses they got back.`;

type Source = { kind: "example"; name: string } | { kind: "pasted"; label: string };

function ScenarioCard({ name, summary, selected, onPick }: { name: string; summary?: CallSummary; selected: boolean; onPick: () => void }) {
  const copy = exampleCopy(name, summary ? summary.findings.length > 0 : undefined);
  const failure = summary?.findings[0]?.type;
  return (
    <button
      onClick={onPick}
      aria-pressed={selected}
      className={cx(
        "flex h-full flex-col items-start gap-1.5 rounded-md border bg-panel p-3 text-left transition-colors",
        selected ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong hover:bg-well/50",
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="text-[13.5px] leading-snug font-semibold">{copy.title}</span>
        {selected && <Check size={15} className="mt-0.5 shrink-0" />}
      </span>
      {copy.description && <span className="text-[12.5px] leading-snug text-muted">{copy.description}</span>}
      <span className="mt-auto pt-1">
        {copy.control ? <Badge>control · no failure</Badge> : failure ? <Badge tone="err">{FAILURE_LABEL[failure]}</Badge> : null}
      </span>
    </button>
  );
}

export function OverviewPage({ calls }: { calls: CallSummary[] | null }) {
  const [mode, setMode] = useState<"examples" | "paste">("examples");
  const [example, setExample] = useState("booking-false-confirmation");
  const [pasted, setPasted] = useState("");
  // Each tab keeps its own result: the Paste tab shows nothing until a pasted log has been run.
  const [exampleResult, setExampleResult] = useState<(E2EResponse & { source: Source }) | null>(null);
  const [pastedResult, setPastedResult] = useState<(E2EResponse & { source: Source }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningFor, setRunningFor] = useState<"examples" | "paste" | null>(null);
  const result = mode === "examples" ? exampleResult : pastedResult;
  const running = runningFor === mode;
  const [showControls, setShowControls] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const userRan = useRef(false);

  // On phones the result sits below the cards; bring it into view after a tap.
  useEffect(() => {
    if (!result || !userRan.current || !resultRef.current) return;
    const top = resultRef.current.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6) resultRef.current.scrollIntoView({ block: "start" });
  }, [result]);

  const runExample = async (name: string, byUser = true) => {
    userRan.current = byUser;
    setExample(name);
    setRunningFor("examples");
    setError(null);
    try {
      setExampleResult({ ...(await api.e2e({ example: name })), source: { kind: "example", name } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunningFor(null);
    }
  };

  const runPasted = async () => {
    userRan.current = true;
    // JSON is parsed by the server too; anything else is sent as a plain-text transcript.
    let log: unknown = pasted;
    try {
      log = JSON.parse(pasted);
    } catch {
      /* not JSON: send the text as-is */
    }
    setRunningFor("paste");
    setError(null);
    try {
      const r = await api.e2e({ log });
      setPastedResult({ ...r, source: { kind: "pasted", label: r.callLogId ?? "pasted log" } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunningFor(null);
    }
  };

  // Deterministic and fast: run the headline test on arrival.
  useEffect(() => {
    void runExample("booking-false-confirmation", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byName = new Map((calls ?? []).map((c) => [c.name, c]));
  const names = calls ? calls.map((c) => c.name) : Object.keys(EXAMPLE_COPY);
  const failures = names.filter((n) => !(byName.get(n) ? byName.get(n)!.findings.length === 0 : EXAMPLE_COPY[n]?.control));
  const controls = names.filter((n) => !failures.includes(n));
  const passed = result?.steps.filter((s) => s.status === "pass").length ?? 0;
  // The log loaded but held no failure: an answer, not an error.
  const nothingToTest = !!result && result.steps[0]?.status === "pass" && result.steps[1]?.status === "fail";
  const unreadable = !!result && result.steps[0]?.status === "fail";
  const resultTitle = result ? (result.source.kind === "example" ? exampleCopy(result.source.name).title : `Pasted log · ${result.source.label}`) : "";
  // Deep links only make sense for bundled examples; pasted logs live only in this page.
  const linkTarget = result?.source.kind === "example" ? result.source.name : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-[19px] font-semibold tracking-tight sm:text-[20px]">End-to-end regression test</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
          Pick a failed call or paste your own. ReplayKit finds the failure, turns it into a test, replays the recorded API response over HTTP, and checks that the
          original agent fails and a fixed agent passes.
        </p>

        <div className="mt-5 rounded-md border border-line bg-panel" data-tour="examples">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4">
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { id: "examples", label: "Example calls" },
                { id: "paste", label: "Paste a call log" },
              ]}
            />
            {mode === "examples" && <span className="text-[12px] text-muted">Select a call to run it.</span>}
          </div>

          {mode === "examples" ? (
            <div className="p-3 sm:p-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {failures.map((n) => (
                  <ScenarioCard key={n} name={n} summary={byName.get(n)} selected={result?.source.kind === "example" && example === n} onPick={() => runExample(n)} />
                ))}
              </div>
              {controls.length > 0 && (
                <div className="mt-3">
                  <button onClick={() => setShowControls((s) => !s)} className="text-[12.5px] text-muted hover:text-ink">
                    {showControls ? "Hide" : "Show"} {controls.length} control call{controls.length > 1 ? "s" : ""} where the agent behaved correctly
                  </button>
                  {showControls && (
                    <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                      {controls.map((n) => (
                        <ScenarioCard key={n} name={n} summary={byName.get(n)} selected={result?.source.kind === "example" && example === n} onPick={() => runExample(n)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 sm:p-4">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={PASTE_PLACEHOLDER}
                spellCheck={false}
                className="h-56 w-full resize-y rounded-md border border-line-strong bg-canvas p-3 font-mono text-[12.5px] leading-[1.6] placeholder:text-subtle sm:h-64"
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={runPasted} disabled={running || !pasted.trim()}>
                  <Play size={13} />
                  {running ? "Running…" : "Run end-to-end"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      setPasted(JSON.stringify(await api.example(example), null, 2));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Start from the selected example
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && <div className="mt-4"><ErrorNote error={error} /></div>}
        {running && !result && <div className="mt-5 text-[13px] text-muted">Running…</div>}

        {result && (
          <>
            <div
              ref={resultRef}
              className={cx("mt-5 scroll-mt-4 rounded-md border px-4 py-3", result.ok ? "border-ok/40 bg-ok-bg" : nothingToTest ? "border-line-strong bg-well" : "border-err/40 bg-err-bg")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cx("text-[15px] font-semibold", result.ok ? "text-ok" : nothingToTest ? "text-ink" : "text-err")}>
                  {result.ok ? "End-to-end pass" : nothingToTest ? "Nothing to test" : unreadable ? "Couldn't read this log" : "End-to-end fail"}
                </span>
                <span className="font-mono text-[12px] text-muted">
                  {passed}/{result.steps.length} steps · {result.durationMs} ms
                </span>
                {running && <span className="text-[12px] text-muted">re-running…</span>}
              </div>
              <div className="mt-1 text-[13px] text-ink-2">{resultTitle}</div>
            </div>

            <ol className="mt-5" data-tour="steps">
              {result.steps.map((step, i) => (
                <li key={step.id} className="relative flex gap-3 pb-5 sm:gap-4">
                  {i < result.steps.length - 1 && <span className="absolute top-7 bottom-0 left-[11px] w-px bg-line-strong" aria-hidden />}
                  <StatusIcon status={step.status} />
                  <div className="min-w-0 flex-1 rounded-md border border-line bg-panel">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2.5 sm:px-4">
                      <span className="font-mono text-[12px] text-subtle">{i + 1}</span>
                      <span className="text-[14px] font-semibold">{step.title}</span>
                      <span className="rounded border border-dashed border-line-strong px-1.5 text-[11.5px] text-muted">{OWNER[step.owner]}</span>
                      <span className="ml-auto font-mono text-[11.5px] text-subtle">{step.durationMs} ms</span>
                      {linkTarget && step.status !== "skipped" && (
                        <a href={stepLink(step, linkTarget)} className="inline-flex items-center gap-0.5 text-[12px] text-muted hover:text-ink">
                          open <ArrowUpRight size={12} />
                        </a>
                      )}
                    </div>
                    <div className="px-3 py-3 sm:px-4">
                      <p className={cx("text-[13.5px] break-words", step.status === "skipped" ? "text-muted" : "text-ink-2")}>{step.detail}</p>
                      {step.checks.length > 0 && (
                        <div className="mt-2.5 border-t border-line text-[12.5px]">
                          <div className="hidden grid-cols-[20px_34%_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 py-1 text-[11px] tracking-wide text-subtle uppercase sm:grid">
                            <span />
                            <span>Check</span>
                            <span>Expected</span>
                            <span>Actual</span>
                          </div>
                          {step.checks.map((c, k) => (
                            <div
                              key={k}
                              className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 border-t border-line py-1.5 first:border-t-0 sm:grid-cols-[20px_34%_minmax(0,1fr)_minmax(0,1fr)] sm:first:border-t"
                            >
                              <span className="pt-0.5">{c.ok ? <Check size={13} className="text-ok" /> : <X size={13} className="text-err" />}</span>
                              <span>{c.label}</span>
                              <span className="col-start-2 font-mono text-[12px] break-words text-muted sm:col-start-auto">
                                <span className="text-subtle sm:hidden">expected </span>
                                {c.expected}
                              </span>
                              <span className={cx("col-start-2 font-mono text-[12px] break-words sm:col-start-auto", c.ok ? "text-ink-2" : "text-err")}>
                                <span className="text-subtle sm:hidden">actual </span>
                                {c.actual}
                              </span>
                            </div>
                          ))}
                        </div>
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
