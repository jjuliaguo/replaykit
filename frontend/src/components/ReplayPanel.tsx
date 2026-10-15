import { ExternalLink, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AgentInfo, type EvaluatedRun, type ReplayFixture, type ReplayResponse } from "../api";
import { jsonEqual } from "../lib/format";
import { JsonView } from "./JsonView";
import { Badge, Button, ErrorNote, Label, SectionTitle, Segmented, StatusCode, cx, download } from "./ui";

const OUTCOME_TONE = { pass: "ok", fail: "err", skipped: "warn" } as const;

/**
 * Did the replay server return exactly what the fixture pinned? Checked here,
 * in the UI, against the fixture itself rather than trusted from the engine.
 */
function Verbatim({ fixture, interactionId, status, body, error }: { fixture: ReplayFixture; interactionId: string; status?: number; body?: unknown; error?: unknown }) {
  const pinned = fixture.replay.interactions.find((i) => i.id === interactionId);
  if (!pinned) return <Badge tone="err">no such recording</Badge>;
  const same = pinned.error ? jsonEqual(error, pinned.error) : status === pinned.response?.status && jsonEqual(body, pinned.response?.body);
  return same ? (
    <Badge tone="ok" title="Status and body are identical to the recorded response">
      verbatim
    </Badge>
  ) : (
    <Badge tone="err" title="The replay server returned something other than the recording">
      differs from recording
    </Badge>
  );
}

function RunTrace({ run, fixture }: { run: EvaluatedRun; fixture: ReplayFixture }) {
  const t = run.trace;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Badge tone={run.overall === "pass" ? "ok" : "err"}>{run.overall.toUpperCase()}</Badge>
        <span className="font-mono">{t.agentId}</span>·<span>{t.agentKind}</span>·<span>status {t.status}</span>·<span className="font-mono">{t.durationMs} ms</span>
        {t.error && <span className="text-err">· {t.error}</span>}
      </div>
      <div className="divide-y divide-line rounded-md border border-line bg-panel">
        {t.toolCalls.length === 0 && <div className="px-4 py-3 text-[13px] text-muted">The agent made no tool calls.</div>}
        {t.toolCalls.map((c) => {
          const r = c.result;
          return (
            <div key={c.callId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11.5px] text-subtle">{c.callId}</span>
                <span className="font-mono text-[13px] font-semibold">{c.toolName}</span>
                <span className="ml-auto flex items-center gap-2">
                  {r.matched ? (
                    <>
                      <Badge tone="info" mono>
                        matched {r.interactionId} · {r.strategy}
                      </Badge>
                      {r.kind === "error" ? <Badge tone="err" mono>{r.error?.kind}</Badge> : <StatusCode status={r.status} />}
                      <Verbatim fixture={fixture} interactionId={r.interactionId} status={r.status} body={r.body} error={r.error} />
                    </>
                  ) : r.kind === "unmatched" ? (
                    <>
                      <Badge tone="warn" mono>unmatched → error_response</Badge>
                      <StatusCode status={r.status} />
                    </>
                  ) : (
                    <Badge tone="err" mono>fail_run: {r.reason}</Badge>
                  )}
                </span>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div className="min-w-0">
                  <Label>Arguments sent</Label>
                  <div className="mt-1">
                    <JsonView value={c.arguments} maxHeight={180} />
                  </div>
                </div>
                <div className="min-w-0">
                  <Label>Returned by replay server</Label>
                  <div className="mt-1">
                    <JsonView value={r.matched ? (r.kind === "error" ? r.error : r.body) : r.kind === "unmatched" ? r.body : { reason: r.reason }} maxHeight={180} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="px-4 py-3">
          <Label>Agent's final reply</Label>
          <div className="mt-1 text-[13.5px]">{t.finalMessage ? `“${t.finalMessage}”` : <span className="text-muted">(none)</span>}</div>
        </div>
      </div>
    </div>
  );
}

export function ReplayPanel({ fixture }: { fixture: ReplayFixture }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<string[]>(["original", "honor"]);
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    api.agents().then(setAgents, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [fixture]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.replay({ fixture, agents: selected });
      setResult(r);
      setDetail(r.report.runs.at(-1)?.trace.agentId ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const runs = result?.report.runs ?? [];
  const cmp = result?.report.comparison;
  const expIds = [...new Map(runs.flatMap((r) => r.expectationResults.map((e) => [e.id, e.description] as const))).entries()];
  const detailRun = runs.find((r) => r.trace.agentId === detail) ?? runs.at(-1);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <div className="text-[13px] font-semibold">Agents</div>
          <div className="text-[12.5px] text-muted">
            Run in order. The first is the baseline, the last is the candidate. These are deterministic stand-ins; a live runner for your real agent is not part of this offline build.
          </div>
        </div>
        <div className="grid gap-px bg-line sm:grid-cols-2">
          {agents.map((a) => {
            const on = selected.includes(a.id);
            const order = selected.indexOf(a.id);
            return (
              <label key={a.id} className={cx("flex cursor-pointer gap-3 bg-panel px-4 py-3", on && "bg-well/60")}>
                <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="mt-1 accent-ink" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold">{a.id}</span>
                    <span className="text-[12.5px] text-muted">{a.label}</span>
                    {on && <span className="ml-1 font-mono text-[11px] text-subtle">#{order + 1}</span>}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{a.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <Button variant="primary" onClick={run} disabled={running || selected.length === 0}>
            <Play size={13} />
            {running ? "Running…" : "Run replay"}
          </Button>
          {result && <span className="font-mono text-[12px] text-muted">completed in {result.durationMs} ms</span>}
          {result && (
            <span className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([result.html], { type: "text/html" }));
                  window.open(url, "_blank", "noopener");
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }}
              >
                <ExternalLink size={13} />
                HTML report
              </Button>
              <Button size="sm" variant="ghost" onClick={() => download(`replay-${result.report.fixture.id}.json`, result.report)}>
                Report JSON
              </Button>
            </span>
          )}
        </div>
      </div>

      {error && <ErrorNote error={error} />}

      {result && (
        <>
          {cmp && (
            <div className={cx("rounded-md border px-4 py-3", cmp.regressed.length ? "border-err/40 bg-err-bg" : cmp.stillFailing.length === 0 && cmp.improved.length ? "border-ok/40 bg-ok-bg" : "border-line bg-panel")}>
              <div className="text-[13.5px]">
                <span className="font-mono font-semibold">{cmp.candidateId}</span> vs <span className="font-mono">{cmp.baselineId}</span>:{" "}
                <span className="font-semibold">
                  {cmp.regressed.length ? "regression" : cmp.stillFailing.length === 0 && cmp.improved.length ? "fixed" : cmp.improved.length ? "partly fixed" : "no improvement"}
                </span>
              </div>
              <div className="mt-1 font-mono text-[12px] text-muted">
                fixed {cmp.improved.length} · still failing {cmp.stillFailing.length} · regressed {cmp.regressed.length} · unchanged pass {cmp.unchangedPass.length}
              </div>
            </div>
          )}

          <div>
            <SectionTitle>Expectation results</SectionTitle>
            <div className="overflow-x-auto rounded-md border border-line bg-panel">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line text-[11px] tracking-wide text-subtle uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Expectation</th>
                    {runs.map((r) => (
                      <th key={r.trace.agentId} className="px-4 py-2 font-mono font-medium normal-case">
                        {r.trace.agentId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {expIds.map(([id, description]) => (
                    <tr key={id} className="align-top">
                      <td className="px-4 py-2.5">
                        <div>{description}</div>
                        <div className="font-mono text-[11px] text-subtle">{id}</div>
                      </td>
                      {runs.map((r) => {
                        const e = r.expectationResults.find((x) => x.id === id);
                        return (
                          <td key={r.trace.agentId} className="px-4 py-2.5">
                            {e ? (
                              <>
                                <Badge tone={OUTCOME_TONE[e.outcome]}>{e.outcome}</Badge>
                                <div className="mt-1 text-[12px] text-muted">{e.reason}</div>
                                {e.evidence.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[11.5px] text-subtle select-none hover:text-ink">evidence ({e.evidence.length})</summary>
                                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] break-words text-muted">
                                      {e.evidence.map((x, k) => (
                                        <li key={k}>{x}</li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </>
                            ) : (
                              <span className="text-subtle">–</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-well/50">
                    <td className="px-4 py-2 text-[12px] font-medium text-muted">Overall</td>
                    {runs.map((r) => (
                      <td key={r.trace.agentId} className="px-4 py-2">
                        <Badge tone={r.overall === "pass" ? "ok" : "err"}>{r.overall.toUpperCase()}</Badge>
                        <span className="ml-2 font-mono text-[11.5px] text-muted">
                          {r.passed}/{r.failed}/{r.skipped}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {detailRun && (
            <div>
              <SectionTitle right={<Segmented options={runs.map((r) => ({ id: r.trace.agentId, label: r.trace.agentId }))} value={detailRun.trace.agentId} onChange={setDetail} />}>
                Replay trace
              </SectionTitle>
              <RunTrace run={detailRun} fixture={fixture} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
