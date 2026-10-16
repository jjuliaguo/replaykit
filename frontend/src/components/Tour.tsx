/**
 * Guided tour: a side panel that explains the problem, the idea, and each
 * step of the live end-to-end run, with a spotlight that glides to the part
 * of the page being explained. Targets are elements with `data-tour="…"`;
 * a stop whose target isn't on screen just dims the page.
 */
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useIsDesktop } from "../lib/media";
import { Button, cx } from "./ui";

interface Stop {
  target?: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
  visual?: ReactNode;
}

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

function Value() {
  return (
    <p className="tour-in border-l-2 border-brand pl-3 text-[13.5px] font-medium text-ink" style={delay(0.25)}>
      The point isn't recovering one call. It's keeping the next 10,000 calls from failing the same way.
    </p>
  );
}

function ProblemVisual() {
  return (
    <div className="space-y-2 rounded-md border border-line bg-canvas p-3 text-[12.5px]">
      <div className="tour-in" style={delay(0.2)}>
        <span className="block text-subtle">Caller</span>
        <div className="mt-0.5 inline-block rounded-md bg-well px-2.5 py-1.5">Can you move my appointment to Friday?</div>
      </div>
      <div className="tour-in font-mono text-[11.5px]" style={delay(0.9)}>
        <span className="text-muted">POST /reschedule → </span>
        <span className="rounded bg-err-bg px-1 text-err">200 {"{ \"success\": false }"}</span>
      </div>
      <div className="tour-in" style={delay(1.6)}>
        <span className="block text-subtle">Agent</span>
        <div className="mt-0.5 inline-block rounded-md bg-ink px-2.5 py-1.5 text-canvas">Done! You're all set for Friday.</div>
      </div>
      <div className="tour-in flex items-center gap-1.5 text-[12px] font-medium text-err" style={delay(2.3)}>
        <X size={13} strokeWidth={3} /> Nothing was rescheduled. Nobody is alerted.
      </div>
    </div>
  );
}

function SolutionVisual() {
  const changes = ["Prompt edit", "Model swap", "Pathway change"];
  return (
    <div className="rounded-md border border-line bg-canvas p-3 text-[12.5px]">
      <div className="tour-in flex items-center gap-2" style={delay(0.35)}>
        <span className="rounded bg-err-bg px-1.5 py-0.5 font-medium text-err">Failed call</span>
        <ArrowRight size={13} className="text-subtle" />
        <span className="rounded bg-well px-1.5 py-0.5 font-medium">Saved test</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {changes.map((c, k) => (
          <div key={c} className="tour-in flex items-center gap-2" style={delay(0.9 + k * 0.45)}>
            <span className="w-28 text-muted">{c}</span>
            <span className="font-mono text-[11.5px] text-subtle">replay →</span>
            <span className="inline-flex items-center gap-1 font-medium text-ok">
              <Check size={13} strokeWidth={3} /> still handled
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS: Array<[string, string]> = [
  ["Read the call log", "Bland, Retell, Vapi, OpenAI or Anthropic messages, or a plain transcript."],
  ["Find the contradiction", "The API said it failed; the agent said it worked."],
  ["Replay the exact response", "A mock webhook serves the recorded status and body, on demand."],
  ["Original agent fails", "Proof the test catches the bug."],
  ["Fixed agent passes", "With no regressions. Stand-in agents here; with Bland, your updated Pathway."],
];

const STOPS: Stop[] = [
  {
    eyebrow: "The problem",
    title: "Agents say “done” when the API failed",
    body: (
      <p>
        When a tool fails with a 500, a timeout, or a 200 that says <code>success: false</code>, the agent can still tell the caller it worked. Fixing that one call doesn't
        help: you can't make the API fail the same way again to prove the fix, and the next prompt or model change can bring the bug back.
      </p>
    ),
    visual: <ProblemVisual />,
  },
  {
    eyebrow: "The solution",
    title: "Turn every failure into a regression test",
    body: (
      <>
        <p>ReplayKit saves the exact API response from the failed call, plus rules for what the agent must and must not say, and replays it after every change.</p>
        <Value />
      </>
    ),
    visual: <SolutionVisual />,
  },
  {
    target: "steps",
    eyebrow: "How it works",
    title: "One failed call, five steps, run live",
    body: (
      <>
        <p>Pick an example call above, or paste your own log. Each run does this:</p>
        <ol className="space-y-2">
          {STEPS.map(([title, detail], k) => (
            <li key={title} className="tour-in flex gap-2.5" style={delay(0.2 + k * 0.12)}>
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink font-mono text-[11px] text-canvas">{k + 1}</span>
              <span>
                <b className="font-medium text-ink">{title}.</b> {detail}
              </span>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  {
    target: "nav-tests",
    eyebrow: "The payoff",
    title: "Every failure joins the suite",
    body: (
      <>
        <p>Saved tests live under Regression tests. Run them before each prompt, model, or Pathway release, and a bug you've caught once can't ship again unnoticed.</p>
        <p className="tour-in border-l-2 border-brand pl-3 font-medium text-ink" style={delay(0.25)}>
          That's the value: regression testing, not recovering individual calls.
        </p>
        <p className="text-muted">Try your own call with Import log. Reopen this tour from the Tour button.</p>
      </>
    ),
  },
];

/** Follows a `data-tour` element on screen, scrolling it into view once. */
function useTargetRect(target: string | undefined, desktop: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    setRect(null);
    if (!target) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let scrolled = false;
    let last = "";
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      const r = el?.getBoundingClientRect();
      const visible = !!r && r.width > 0 && r.height > 0;
      if (el && visible && !scrolled) {
        scrolled = true;
        const tall = r.height > window.innerHeight * 0.6;
        el.scrollIntoView({ block: desktop && !tall ? "center" : "start", behavior: smooth ? "smooth" : "auto" });
      }
      const key = visible ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : "";
      if (key !== last) {
        last = key;
        setRect(visible ? r : null);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [target, desktop]);
  return rect;
}

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const desktop = useIsDesktop();
  const stop = STOPS[i]!;
  const rect = useTargetRect(stop.target, desktop);
  const last = i === STOPS.length - 1;
  const next = () => (last ? onClose() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Clip the spotlight to the visible page, so a tall target still shows a closed outline.
  const pad = 6;
  const top = rect ? Math.max(rect.top - pad, 4) : 0;
  const bottom = rect ? Math.min(rect.bottom + pad, window.innerHeight - 4) : 0;
  const spot: CSSProperties = rect
    ? { left: rect.left - pad, top, width: rect.width + pad * 2, height: Math.max(bottom - top, 0) }
    : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };

  return (
    <>
      <div className={cx("tour-spot pointer-events-none fixed z-40 rounded-lg", rect && "has-target")} style={spot} aria-hidden />
      <aside
        role="dialog"
        aria-label="Guided tour"
        className={cx(
          "z-50 flex flex-col bg-panel",
          desktop ? "relative w-[360px] shrink-0 border-l border-line" : "fixed inset-x-0 bottom-0 max-h-[55vh] rounded-t-xl border-t border-line shadow-[0_-8px_24px_rgb(0_0_0/0.12)]",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="font-mono text-[12px] text-subtle">
            Tour · {i + 1}/{STOPS.length}
          </span>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-well hover:text-ink" aria-label="Close tour">
            <X size={16} />
          </button>
        </div>
        <div className="h-0.5 bg-line">
          <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${((i + 1) / STOPS.length) * 100}%` }} />
        </div>

        <div key={i} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="tour-in text-[11.5px] font-medium tracking-wide text-brand uppercase">{stop.eyebrow}</div>
          <h2 className="tour-in mt-1 text-[18px] leading-snug font-semibold tracking-tight" style={delay(0.05)}>
            {stop.title}
          </h2>
          <div className="tour-in mt-3 space-y-3 text-[13.5px] leading-relaxed text-ink-2 [&_code]:rounded [&_code]:bg-well [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px]" style={delay(0.12)}>
            {stop.body}
          </div>
          {stop.visual && <div className="mt-4">{stop.visual}</div>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={back} disabled={i === 0}>
            <ArrowLeft size={13} /> Back
          </Button>
          <div className="flex gap-1" aria-hidden>
            {STOPS.map((_, k) => (
              <span key={k} className={cx("size-1.5 rounded-full transition-colors", k === i ? "bg-ink" : k < i ? "bg-subtle" : "bg-line-strong")} />
            ))}
          </div>
          <Button variant="primary" onClick={next} autoFocus>
            {last ? "Finish" : "Next"} {!last && <ArrowRight size={13} />}
          </Button>
        </div>
      </aside>
    </>
  );
}
