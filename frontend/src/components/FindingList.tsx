import { ArrowUpRight } from "lucide-react";
import type { Finding } from "../api";
import { FAILURE_LABEL, pad } from "../lib/format";
import { Badge, Empty } from "./ui";

export function FindingList({ findings, onJump }: { findings: Finding[]; onJump: (eventIndex: number) => void }) {
  if (findings.length === 0) {
    return (
      <Empty title="No failure detected">
        The extractor found no evidence of a failure in this call, so no regression test was generated. It does not guess: a missing or unclear signal is
        reported as nothing.
      </Empty>
    );
  }
  return (
    <div className="divide-y divide-line rounded-md border border-line bg-panel">
      {findings.map((f, i) => (
        <div key={i} className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">{FAILURE_LABEL[f.type]}</span>
            <Badge tone={f.confidence === "high" ? "err" : "warn"}>{f.confidence} confidence</Badge>
            {f.toolName && <Badge mono>{f.toolName}</Badge>}
            <span className="ml-auto font-mono text-[11.5px] text-subtle">{f.detector}</span>
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-2">{f.summary}</p>
          <div className="mt-2.5 overflow-hidden rounded-md border border-line">
            {f.evidence.map((e, j) => (
              <button
                key={j}
                onClick={() => onJump(e.eventIndex)}
                className="group flex w-full items-start gap-3 border-b border-line bg-well/50 px-3 py-2 text-left last:border-b-0 hover:bg-well"
              >
                <span className="w-7 shrink-0 font-mono text-[12px] text-subtle tabular-nums">#{pad(e.eventIndex)}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-[13px]">{e.description}</span>
                  {(e.path || e.quote) && (
                    <span className="mt-0.5 block font-mono text-[12px] break-words text-err">
                      {e.path ? `${e.path} = ${e.quote ?? ""}` : `“${e.quote}”`}
                    </span>
                  )}
                </span>
                <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-subtle group-hover:text-ink" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
