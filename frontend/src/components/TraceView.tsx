import { ChevronDown, ChevronRight, CircleAlert, Clock, TimerOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CallEvent, Finding, ToolOutcome } from "../api";
import { FAILURE_LABEL, pad, toCurl, traceRows, type ToolPair } from "../lib/format";
import { JsonView } from "./JsonView";
import { Badge, CopyButton, Label, StatusCode, cx } from "./ui";

/** Evidence notes for each event index, from all findings. */
function evidenceByEvent(findings: Finding[]): Map<number, Array<{ finding: Finding; description: string; quote?: string; path?: string }>> {
  const map = new Map<number, Array<{ finding: Finding; description: string; quote?: string; path?: string }>>();
  for (const f of findings) {
    for (const e of f.evidence) {
      const list = map.get(e.eventIndex) ?? [];
      list.push({ finding: f, description: e.description, quote: e.quote, path: e.path });
      map.set(e.eventIndex, list);
    }
  }
  return map;
}

/** Wrap quoted claim sentences in a highlight. Exact substring matches only. */
function highlightQuotes(text: string, quotes: string[]): ReactNode {
  const qs = [...new Set(quotes.filter((q) => q && text.includes(q)))].sort((a, b) => b.length - a.length);
  if (qs.length === 0) return text;
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let best: { i: number; q: string } | null = null;
    for (const q of qs) {
      const i = rest.indexOf(q);
      if (i !== -1 && (best === null || i < best.i)) best = { i, q };
    }
    if (!best) {
      parts.push(rest);
      break;
    }
    if (best.i > 0) parts.push(rest.slice(0, best.i));
    parts.push(
      <mark key={key++} className="rounded-sm bg-err-bg px-0.5 text-err underline decoration-err/50 decoration-dotted underline-offset-2">
        {best.q}
      </mark>,
    );
    rest = rest.slice(best.i + best.q.length);
  }
  return parts;
}

function Gutter({ children, at }: { children: ReactNode; at?: string }) {
  return (
    <div className="w-14 shrink-0 pt-0.5 font-mono text-[11.5px] text-subtle tabular-nums">
      <div>{children}</div>
      {at && <div className="text-[10.5px]">{at}</div>}
    </div>
  );
}

/** "+1.4s" relative to the first timestamped event, or undefined when the log has no timestamps. */
function relTime(t0: string | undefined, at: string | undefined): string | undefined {
  if (!t0 || !at) return undefined;
  const ms = Date.parse(at) - Date.parse(t0);
  return Number.isFinite(ms) ? `+${(ms / 1000).toFixed(1)}s` : undefined;
}

function RoleTag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "tool" }) {
  return (
    <div className={cx("w-[72px] shrink-0 pt-0.5 text-[11px] font-semibold tracking-wide uppercase", tone === "tool" ? "text-info" : "text-muted")}>{children}</div>
  );
}

function IssueTags({ notes, onSelect }: { notes: Array<{ finding: Finding; description: string }>; onSelect?: (f: Finding) => void }) {
  const seen = new Set<Finding>();
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {notes
        .filter((n) => (seen.has(n.finding) ? false : (seen.add(n.finding), true)))
        .map((n, i) => (
          <button key={i} onClick={() => onSelect?.(n.finding)} className="inline-flex items-center gap-1 rounded border border-err/30 bg-err-bg px-1.5 py-0.5 text-[11.5px] text-err hover:border-err">
            <CircleAlert size={12} />
            {FAILURE_LABEL[n.finding.type]}: {n.description}
          </button>
        ))}
    </div>
  );
}

function ToolRow({
  pair,
  outcome,
  notes,
  definition,
  expanded,
  onToggle,
  onSelectFinding,
  focused,
  t0,
}: {
  pair: ToolPair;
  outcome?: ToolOutcome;
  notes: Array<{ finding: Finding; description: string; quote?: string; path?: string }>;
  definition?: { endpoint?: { method?: string; url?: string } };
  expanded: boolean;
  onToggle: () => void;
  onSelectFinding?: (f: Finding) => void;
  focused: boolean;
  t0?: string;
}) {
  const { call, result } = pair;
  const req = result?.request;
  const method = (req?.method ?? definition?.endpoint?.method ?? "").toUpperCase();
  const url = req?.url ?? definition?.endpoint?.url;
  const status = result?.response?.status;
  const failed = outcome?.outcome === "failure";
  const signals = outcome?.signals.filter((s) => s.outcome === "failure") ?? [];
  const appFailure = failed && status !== undefined && status < 400 && !result?.error;

  // Highlight failure signals inside the response body (paths relative to the body).
  const bodyHighlights: Record<string, string> = {};
  for (const s of signals) {
    if (s.path === "response.body") bodyHighlights[""] = s.reason;
    else if (s.path.startsWith("response.body.")) bodyHighlights[s.path.slice("response.body.".length)] = s.reason;
  }
  const curl = toCurl(req);
  const indexLabel = pair.resultIndex !== null ? `${pad(pair.callIndex)}→${pad(pair.resultIndex)}` : pad(pair.callIndex);

  return (
    <div data-event={pair.callIndex} data-event-2={pair.resultIndex ?? undefined} className={cx("border-l-2 py-2.5 pr-4 pl-3", notes.length ? "border-err" : failed ? "border-warn" : "border-transparent", focused && "flash")}>
      <div className="flex gap-0">
        <Gutter at={relTime(t0, call.at)}>{indexLabel}</Gutter>
        <RoleTag tone="tool">Tool</RoleTag>
        <div className="min-w-0 flex-1">
          <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-left">
            {expanded ? <ChevronDown size={14} className="text-subtle" /> : <ChevronRight size={14} className="text-subtle" />}
            <span className="font-mono text-[13px] font-semibold">{call.toolName}</span>
            {method && <span className="font-mono text-[11.5px] font-semibold text-muted">{method}</span>}
            {url && <span className="max-w-[340px] truncate font-mono text-[12px] text-muted">{url}</span>}
            <span className="ml-auto flex items-center gap-2">
              {result?.error ? (
                <Badge tone="err" mono>
                  <TimerOff size={11} className="mr-1" />
                  {result.error.kind.toUpperCase()}
                </Badge>
              ) : result ? (
                <StatusCode status={status} appFailure={appFailure} />
              ) : (
                <Badge tone="warn">no result logged</Badge>
              )}
              {result?.response?.latencyMs !== undefined && (
                <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-muted">
                  <Clock size={11} />
                  {result.response.latencyMs} ms
                </span>
              )}
            </span>
          </button>
          {signals.length > 0 && (
            <div className="mt-1 pl-6 font-mono text-[12px] text-err">
              {signals.map((s, i) => (
                <div key={i}>
                  {s.path} = {s.value}
                </div>
              ))}
            </div>
          )}
          {notes.length > 0 && <div className="pl-6"><IssueTags notes={notes} onSelect={onSelectFinding} /></div>}

          {expanded && (
            <div className="mt-3 grid gap-3 pl-6 xl:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>Request · arguments</Label>
                  {curl && <CopyButton text={curl} label="curl" />}
                </div>
                <JsonView value={req?.body ?? call.arguments} />
                {req?.headers && (
                  <div className="mt-2">
                    <Label>Request headers</Label>
                    <div className="mt-1">
                      <JsonView value={req.headers} />
                    </div>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>{result?.error ? "Transport error" : "Response body"}</Label>
                  {outcome && (
                    <span className="text-[11.5px] text-muted">
                      extractor verdict: <span className={cx("font-mono", outcome.outcome === "failure" ? "text-err" : outcome.outcome === "success" ? "text-ok" : "text-muted")}>{outcome.outcome}</span>
                    </span>
                  )}
                </div>
                {result?.error ? (
                  <div className="rounded-md border border-err/30 bg-err-bg px-3 py-2 font-mono text-[12px] text-err">
                    {result.error.kind}: {result.error.message}
                  </div>
                ) : (
                  <JsonView value={result?.response?.body} highlight={bodyHighlights} />
                )}
                {result?.response?.headers && (
                  <div className="mt-2">
                    <Label>Response headers</Label>
                    <div className="mt-1">
                      <JsonView value={result.response.headers} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TraceView({
  events,
  findings,
  outcomes,
  tools,
  focusEvent,
  onSelectFinding,
}: {
  events: CallEvent[];
  findings: Finding[];
  outcomes: Record<string, ToolOutcome>;
  tools: Array<{ name: string; endpoint?: { method?: string; url?: string } }>;
  focusEvent?: number;
  onSelectFinding?: (f: Finding) => void;
}) {
  const rows = useMemo(() => traceRows(events), [events]);
  const notes = useMemo(() => evidenceByEvent(findings), [findings]);
  const defs = useMemo(() => new Map(tools.map((t) => [t.name, t])), [tools]);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const root = useRef<HTMLDivElement>(null);
  const t0 = useMemo(() => events.find((e) => e.at)?.at, [events]);

  // Expand tool rows involved in a failure, or that failed, by default.
  useEffect(() => {
    const s = new Set<number>();
    for (const r of rows) {
      if (r.kind !== "tool") continue;
      const ri = r.pair.resultIndex;
      if (notes.has(r.pair.callIndex) || (ri !== null && (notes.has(ri) || outcomes[ri]?.outcome === "failure"))) s.add(r.pair.callIndex);
    }
    setOpen(s);
  }, [rows, notes, outcomes]);

  useEffect(() => {
    if (focusEvent === undefined || !root.current) return;
    const el = root.current.querySelector<HTMLElement>(`[data-event="${focusEvent}"], [data-event-2="${focusEvent}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusEvent, rows]);

  return (
    <div ref={root} className="divide-y divide-line rounded-md border border-line bg-panel">
      {rows.map((r) => {
        if (r.kind === "tool") {
          const ri = r.pair.resultIndex;
          const n = [...(notes.get(r.pair.callIndex) ?? []), ...(ri !== null ? notes.get(ri) ?? [] : [])];
          return (
            <ToolRow
              key={`t${r.pair.callIndex}`}
              pair={r.pair}
              outcome={ri !== null ? outcomes[ri] : undefined}
              notes={n}
              definition={defs.get(r.pair.call.toolName)}
              expanded={open.has(r.pair.callIndex)}
              onToggle={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(r.pair.callIndex)) next.delete(r.pair.callIndex);
                  else next.add(r.pair.callIndex);
                  return next;
                })
              }
              onSelectFinding={onSelectFinding}
              focused={focusEvent === r.pair.callIndex || focusEvent === ri}
              t0={t0}
            />
          );
        }
        if (r.kind === "orphan") {
          return (
            <div key={`o${r.index}`} data-event={r.index} className="flex py-2.5 pr-4 pl-3">
              <Gutter>{pad(r.index)}</Gutter>
              <RoleTag>{r.event.type.replace("_", " ")}</RoleTag>
              <div className="min-w-0 flex-1">
                <Badge tone="warn">no matching tool_call</Badge>
                <div className="mt-1.5">
                  <JsonView value={r.event} maxHeight={200} />
                </div>
              </div>
            </div>
          );
        }
        const e = r.event;
        const n = notes.get(r.index) ?? [];
        const isAgent = e.role === "assistant";
        return (
          <div key={`m${r.index}`} data-event={r.index} className={cx("flex border-l-2 py-2.5 pr-4 pl-3", n.length ? "border-err" : "border-transparent", focusEvent === r.index && "flash")}>
            <Gutter at={relTime(t0, e.at)}>{pad(r.index)}</Gutter>
            <RoleTag>{isAgent ? "Agent" : e.role === "user" ? "Caller" : "System"}</RoleTag>
            <div className="min-w-0 flex-1">
              <div className={cx("text-[13.5px] whitespace-pre-wrap", e.role === "system" && "text-muted", !isAgent && e.role !== "system" && "text-ink-2")}>
                {highlightQuotes(e.content, n.map((x) => x.quote ?? ""))}
              </div>
              {n.length > 0 && <IssueTags notes={n} onSelect={onSelectFinding} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
