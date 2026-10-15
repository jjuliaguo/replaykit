import { Check, Copy } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { STATUS_TEXT, statusTone } from "../lib/format";

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost";
export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "border-ink bg-ink text-canvas hover:bg-ink-2",
        variant === "secondary" && "border-line-strong bg-panel text-ink hover:bg-well",
        variant === "ghost" && "border-transparent bg-transparent text-muted hover:bg-well hover:text-ink",
        className,
      )}
    />
  );
}

type Tone = "ok" | "err" | "warn" | "info" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  err: "bg-err-bg text-err",
  warn: "bg-warn-bg text-warn",
  info: "bg-info-bg text-info",
  neutral: "bg-well text-muted",
};
export function Badge({ tone = "neutral", mono, children, title }: { tone?: Tone; mono?: boolean; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex h-5 items-center rounded px-1.5 text-[11.5px] font-medium whitespace-nowrap", mono && "font-mono", TONE[tone])}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  const c = { ok: "bg-ok", err: "bg-err", warn: "bg-warn", info: "bg-info", neutral: "bg-subtle" }[tone];
  return <span className={cx("inline-block size-1.5 shrink-0 rounded-full", c)} aria-hidden />;
}

export function StatusCode({ status, appFailure }: { status?: number; appFailure?: boolean }) {
  if (status === undefined) return <Badge mono>no status</Badge>;
  const tone = statusTone(status);
  return (
    <span className="inline-flex items-center gap-1">
      <Badge mono tone={tone === "none" ? "neutral" : tone} title={STATUS_TEXT[status]}>
        {status} {STATUS_TEXT[status] ?? ""}
      </Badge>
      {appFailure && tone === "ok" && (
        <Badge tone="err" title="HTTP succeeded, but the response body reports an application-level failure">
          app error
        </Badge>
      )}
    </span>
  );
}

/** Underline tabs, like the top bar of the reference UI. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("flex items-end gap-6", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px border-b-2 pb-2.5 text-[13.5px] transition-colors",
            t.id === value ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Joined toggle buttons, like the Prompt / Settings switch in the reference UI. */
export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line-strong bg-well p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          className={cx("h-7 rounded-[5px] px-3 text-[12.5px]", o.id === value ? "border border-line-strong bg-panel font-medium text-ink" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      title={`Copy ${label.toLowerCase()}`}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </Button>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-[13px] font-semibold text-ink">{children}</h3>
      {right}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium tracking-wide text-subtle uppercase">{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-strong px-6 py-12 text-center">
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return <div className="rounded-md border border-err/30 bg-err-bg px-3 py-2 font-mono text-[12.5px] text-err">{error}</div>;
}

export function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
