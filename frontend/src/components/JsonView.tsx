/**
 * Read-only JSON viewer with syntax colors and line highlights.
 *
 * `highlight` takes dot paths relative to the value shown (for a response
 * body: "success", "error.message"). The matching line gets a red rule and
 * a note, so the field that signaled a failure is visible at a glance.
 */
import { Fragment, type ReactNode } from "react";
import { cx } from "./ui";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface Line {
  depth: number;
  path: string;
  content: ReactNode;
}

function scalar(v: Json): ReactNode {
  if (v === null) return <span className="text-subtle">null</span>;
  if (typeof v === "boolean") return <span className={v ? "text-ok" : "text-err"}>{String(v)}</span>;
  if (typeof v === "number") return <span className="text-info">{v}</span>;
  if (typeof v === "string") {
    if (v === "[REDACTED]") return <span className="rounded bg-well px-1 text-subtle italic">[REDACTED]</span>;
    return <span className="text-[#8a4a12]">{JSON.stringify(v)}</span>;
  }
  return null;
}

function build(value: Json, path: string, depth: number, key: ReactNode, trailing: boolean, out: Line[]): void {
  const comma = trailing ? <span className="text-subtle">,</span> : null;
  const prefix = key !== null ? (
    <>
      {key}
      <span className="text-subtle">: </span>
    </>
  ) : null;
  if (value !== null && typeof value === "object") {
    const entries: Array<[string, Json]> = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) {
      out.push({ depth, path, content: <>{prefix}<span className="text-subtle">{open + close}</span>{comma}</> });
      return;
    }
    out.push({ depth, path, content: <>{prefix}<span className="text-subtle">{open}</span></> });
    entries.forEach(([k, v], i) => {
      const childPath = path ? `${path}.${k}` : k;
      const childKey = Array.isArray(value) ? null : <span className="text-ink-2">{JSON.stringify(k)}</span>;
      build(v, childPath, depth + 1, childKey, i < entries.length - 1, out);
    });
    out.push({ depth, path: `${path}#close`, content: <><span className="text-subtle">{close}</span>{comma}</> });
    return;
  }
  out.push({ depth, path, content: <>{prefix}{scalar(value)}{comma}</> });
}

export function JsonView({ value, highlight = {}, className, maxHeight = 360 }: { value: unknown; highlight?: Record<string, string>; className?: string; maxHeight?: number }) {
  if (value === undefined) return <div className="font-mono text-[12px] text-subtle">(none)</div>;
  if (typeof value === "string") {
    const note = highlight[""];
    return (
      <pre className={cx("overflow-auto rounded-md border border-line bg-panel px-3 py-2 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap", note && "border-l-2 border-l-err bg-err-bg/40", className)} style={{ maxHeight }}>
        {value}
        {note && <span className="ml-3 font-sans text-[11px] text-err">← {note}</span>}
      </pre>
    );
  }
  const lines: Line[] = [];
  build(value as Json, "", 0, null, false, lines);
  return (
    <div className={cx("overflow-auto rounded-md border border-line bg-panel py-1.5 font-mono text-[12px] leading-[1.6]", className)} style={{ maxHeight }}>
      {lines.map((l, i) => {
        const note = highlight[l.path];
        return (
          <Fragment key={i}>
            <div className={cx("flex border-l-2 pr-3 whitespace-pre", note ? "border-err bg-err-bg" : "border-transparent")} style={{ paddingLeft: 10 + l.depth * 14 }}>
              <span>{l.content}</span>
              {note && <span className="ml-3 font-sans text-[11px] whitespace-nowrap text-err">← {note}</span>}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
