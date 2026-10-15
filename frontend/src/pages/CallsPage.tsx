import { ArrowRight, ChevronLeft, Download, Play, Search } from "lucide-react";
import { exampleCopy } from "../lib/examples";
import { useIsDesktop } from "../lib/media";
import { FAILURE_LABEL, pad } from "../lib/format";
import { useEffect, useMemo, useState } from "react";
import { api, type CallSummary, type ExtractResponse } from "../api";
import { FindingList } from "../components/FindingList";
import { FixtureView } from "../components/FixtureView";
import { JsonView } from "../components/JsonView";
import { TraceView } from "../components/TraceView";
import { Badge, Button, CopyButton, Dot, Empty, ErrorNote, Segmented, StatusCode, Tabs, cx, download } from "../components/ui";
import { href, navigate, type Route } from "../lib/router";

type DetailTab = "trace" | "issues" | "test" | "raw";
type Filter = "all" | "issues" | "clean";

export interface ImportedLog {
  raw: unknown;
  summary: CallSummary;
}

function CallList({ calls, selected }: { calls: CallSummary[]; selected?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = calls.filter((c) => {
    if (filter === "issues" && c.findings.length === 0) return false;
    if (filter === "clean" && c.findings.length > 0) return false;
    const hay = `${exampleCopy(c.name).title} ${c.id} ${c.name} ${c.tools.join(" ")} ${c.provider}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by call id, tool, provider"
            className="h-8 w-full rounded-md border border-line-strong bg-panel pr-2 pl-8 text-[13px] placeholder:text-subtle"
          />
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: `All ${calls.length}` },
            { id: "issues", label: `Issues ${calls.filter((c) => c.findings.length).length}` },
            { id: "clean", label: `Clean ${calls.filter((c) => !c.findings.length).length}` },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 && <div className="p-4 text-[13px] text-muted">No calls match.</div>}
        {shown.map((c) => {
          const active = c.name === selected;
          const high = c.findings.some((f) => f.confidence === "high");
          return (
            <a
              key={c.name}
              href={href(["calls", c.name])}
              className={cx("block border-b border-l-2 border-b-line px-3 py-2.5", active ? "border-l-ink bg-panel" : "border-l-transparent hover:bg-well/70")}
            >
              <div className="flex items-center gap-2">
                <Dot tone={c.error ? "warn" : c.findings.length ? (high ? "err" : "warn") : "ok"} />
                <span className="min-w-0 text-[13px] leading-snug font-medium [overflow-wrap:anywhere]" title={c.id}>
                  {exampleCopy(c.name, c.findings.length > 0).title}
                </span>
                <span className="ml-auto shrink-0">
                  {c.error ? (
                    <Badge tone="warn">invalid</Badge>
                  ) : c.findings.length ? (
                    <Badge tone={high ? "err" : "warn"}>
                      {c.findings.length} issue{c.findings.length > 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Badge>clean</Badge>
                  )}
                </span>
              </div>
              <div className="mt-0.5 truncate pl-3.5 font-mono text-[11.5px] text-subtle">{c.id}</div>
              <div className="truncate pl-3.5 text-[12px] text-muted">
                {c.provider} · {c.kind} · {c.events} events · {c.tools.length ? c.tools.join(", ") : "no tools"}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One line per finding: what the external API said, and what the agent then
 * told the caller. Every segment links to its event in the trace.
 */
function RootCause({ data, onJump }: { data: ExtractResponse; onJump: (i: number) => void }) {
  const { findings, callLog, outcomes } = data;
  if (findings.length === 0) return null;
  const seg = "inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-well";
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-err/30">
      {findings.map((f, i) => {
        const toolEv = f.evidence.find((e) => e.path);
        const claimEv = f.evidence.find((e) => !e.path && e.eventIndex === f.messageIndex) ?? f.evidence.find((e) => !e.path);
        const ev = toolEv ? callLog.events[toolEv.eventIndex] : undefined;
        const status = ev?.type === "tool_result" ? ev.response?.status : undefined;
        const failed = toolEv ? outcomes[String(toolEv.eventIndex)]?.outcome === "failure" : false;
        return (
          <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-err/20 bg-err-bg/50 px-3 py-2 text-[12.5px] last:border-b-0">
            <span className="font-medium text-err">{FAILURE_LABEL[f.type]}</span>
            {toolEv && ev?.type === "tool_result" && (
              <button className={seg} onClick={() => onJump(toolEv.eventIndex)}>
                <span className="font-mono text-subtle">#{pad(toolEv.eventIndex)}</span>
                <span className="font-mono font-semibold">{f.toolName}</span>
                {ev.error ? <Badge tone="err" mono>{ev.error.kind}</Badge> : <StatusCode status={status} appFailure={failed} />}
                <span className="font-mono text-err">
                  {toolEv.path!.replace(/^response\.body\./, "")} = {toolEv.quote}
                </span>
              </button>
            )}
            {toolEv && claimEv && <ArrowRight size={13} className="text-subtle" />}
            {claimEv && (
              <button className={cx(seg, "min-w-0 text-left")} onClick={() => onJump(claimEv.eventIndex)}>
                <span className="font-mono text-subtle">#{pad(claimEv.eventIndex)}</span>
                <span className="text-muted">agent:</span>
                <span className="truncate italic">“{claimEv.quote}”</span>
              </button>
            )}
            <Badge tone={f.confidence === "high" ? "err" : "warn"}>{f.confidence}</Badge>
          </div>
        );
      })}
    </div>
  );
}

function CallDetail({ name, raw, tab, focusEvent }: { name: string; raw?: unknown; tab: DetailTab; focusEvent?: number }) {
  const [data, setData] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    (raw !== undefined ? Promise.resolve(raw) : api.example(name))
      .then((log) => api.extract({ log }))
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [name, raw]);

  const go = (t: DetailTab, extra: Record<string, string | number | undefined> = {}) => navigate(["calls", name], { tab: t, ...extra });

  if (error) return <div className="p-6"><ErrorNote error={error} /></div>;
  if (!data) return <div className="p-6 text-[13px] text-muted">Analyzing call…</div>;

  const { callLog, findings, fixture, outcomes } = data;
  const toolCalls = callLog.events.filter((e) => e.type === "tool_call").length;
  const failedResults = Object.values(outcomes).filter((o) => o.outcome === "failure").length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-canvas px-4 pt-4 md:px-6 md:pt-5">
        <a href={href(["calls"])} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink md:hidden">
          <ChevronLeft size={14} /> All calls
        </a>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] leading-snug font-semibold">{exampleCopy(name, findings.length > 0).title}</h1>
            </div>
            <div className="mt-0.5 flex items-center gap-1">
              <span className="font-mono text-[12px] break-all text-muted">{callLog.id}</span>
              <CopyButton text={callLog.id} label="ID" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
              <Badge tone={callLog.kind === "synthetic" ? "warn" : "ok"}>{callLog.kind}</Badge>
              <span className="font-mono">{callLog.provider}</span>
              {callLog.startedAt && <span className="font-mono">{callLog.startedAt}</span>}
              <span>{callLog.events.length} events</span>
              <span>{toolCalls} tool calls</span>
              <span className={failedResults ? "text-err" : undefined}>
                {failedResults} failed tool result{failedResults === 1 ? "" : "s"}
              </span>
              <span className="font-mono">extract {data.durationMs} ms</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {fixture && (
              <Button onClick={() => download(`${fixture.id}.json`, fixture)}>
                <Download size={13} />
                Fixture
              </Button>
            )}
            {fixture && (
              <Button variant="primary" onClick={() => navigate(["tests", `call:${name}`], { tab: "replay" })}>
                <Play size={13} />
                Replay test
              </Button>
            )}
          </div>
        </div>
        {callLog.notes && <p className="mt-2 max-w-3xl text-[12.5px] text-muted">{callLog.notes}</p>}
        <RootCause data={data} onJump={(i) => go("trace", { event: i })} />
        <Tabs<DetailTab>
          className="mt-4"
          value={tab}
          onChange={(t) => go(t)}
          tabs={[
            { id: "trace", label: "Trace" },
            {
              id: "issues",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Issues
                  {findings.length > 0 && <span className="rounded bg-err-bg px-1 font-mono text-[11px] text-err">{findings.length}</span>}
                </span>
              ),
            },
            { id: "test", label: "Regression test" },
            { id: "raw", label: "Raw log" },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
        {tab === "trace" && (
          <TraceView
            events={callLog.events}
            findings={findings}
            outcomes={outcomes}
            tools={callLog.tools}
            focusEvent={focusEvent}
            onSelectFinding={() => go("issues")}
          />
        )}
        {tab === "issues" && <FindingList findings={findings} onJump={(i) => go("trace", { event: i })} />}
        {tab === "test" &&
          (fixture ? (
            <FixtureView fixture={fixture} />
          ) : (
            <Empty title="No regression test">No failure was detected, so there is nothing to regress against. ReplayKit does not generate tests from clean calls.</Empty>
          ))}
        {tab === "raw" && <JsonView value={raw ?? { ...callLog }} maxHeight={10_000} />}
      </div>
    </div>
  );
}

export function CallsPage({ route, calls, imported, error }: { route: Route; calls: CallSummary[] | null; imported: Record<string, ImportedLog>; error: string | null }) {
  const selected = route.path[1];
  const tab = (["trace", "issues", "test", "raw"].includes(route.query.get("tab") ?? "") ? route.query.get("tab") : "trace") as DetailTab;
  const event = route.query.get("event");
  const isDesktop = useIsDesktop();
  const all = useMemo(() => [...Object.values(imported).map((i) => i.summary), ...(calls ?? [])], [calls, imported]);

  useEffect(() => {
    // On desktop, open the first call with an issue. On phones, show the list first.
    if (!selected && all[0] && isDesktop) navigate(["calls", all.find((c) => c.findings.length)?.name ?? all[0].name], { tab: "trace" });
  }, [selected, all, isDesktop]);

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
      <div className={cx("min-h-0 border-line bg-canvas md:block md:border-r", selected ? "hidden" : "block")}>
        {error ? <div className="p-3"><ErrorNote error={error} /></div> : calls === null ? <div className="p-4 text-[13px] text-muted">Loading calls…</div> : <CallList calls={all} selected={selected} />}
      </div>
      <div className={cx("min-h-0 min-w-0 md:block", selected ? "block" : "hidden")}>
        {selected ? (
          <CallDetail key={selected} name={selected} raw={imported[selected]?.raw} tab={tab} focusEvent={event !== null ? Number(event) : undefined} />
        ) : (
          <div className="p-6">
            <Empty title="No call selected" />
          </div>
        )}
      </div>
    </div>
  );
}
