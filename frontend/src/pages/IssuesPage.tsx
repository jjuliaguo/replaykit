import { useState } from "react";
import type { CallSummary } from "../api";
import { Badge, Empty, ErrorNote, Segmented } from "../components/ui";
import { FAILURE_LABEL, pad } from "../lib/format";
import { href } from "../lib/router";

export function IssuesPage({ calls, error }: { calls: CallSummary[] | null; error: string | null }) {
  const [level, setLevel] = useState<"all" | "high">("all");
  if (error) return <div className="p-6"><ErrorNote error={error} /></div>;
  if (!calls) return <div className="p-6 text-[13px] text-muted">Loading…</div>;

  const rows = calls
    .flatMap((c) => c.findings.map((f) => ({ call: c, f })))
    .filter((r) => level === "all" || r.f.confidence === "high")
    .sort((a, b) => (a.f.confidence === b.f.confidence ? 0 : a.f.confidence === "high" ? -1 : 1));
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.f.type, (byType.get(r.f.type) ?? 0) + 1);

  return (
    <div className="h-full overflow-y-auto px-3 py-4 md:px-6 md:py-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[16px] font-semibold">Issues</h1>
          <p className="text-[13px] text-muted">
            Every failure the extractor found across {calls.length} calls. Each one is backed by evidence events; open a row to see the trace.
          </p>
        </div>
        <Segmented value={level} onChange={setLevel} options={[{ id: "all", label: "All" }, { id: "high", label: "High confidence" }]} />
      </div>

      {byType.size > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] text-muted">
          {[...byType.entries()].map(([t, n]) => (
            <span key={t}>
              {t} <span className="text-ink">{n}</span>
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="No issues">No call has a detected failure at this confidence level.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line text-[11px] tracking-wide text-subtle uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Confidence</th>
                <th className="px-4 py-2 font-medium">Failure</th>
                <th className="px-4 py-2 font-medium">Tool</th>
                <th className="px-4 py-2 font-medium">Call</th>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ call, f }, i) => {
                const link = href(["calls", call.name], { tab: "trace", event: f.messageIndex });
                return (
                  <tr key={i} className="cursor-pointer align-top hover:bg-well/60" onClick={() => (window.location.hash = link)}>
                    <td className="px-4 py-2.5">
                      <Badge tone={f.confidence === "high" ? "err" : "warn"}>{f.confidence}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{FAILURE_LABEL[f.type]}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]">{f.toolName ?? "–"}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]">
                      <a href={link} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {call.id}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-muted">#{pad(f.messageIndex)}</td>
                    <td className="px-4 py-2.5 text-ink-2">{f.summary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
