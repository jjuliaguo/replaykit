import { ChevronsUpDown, FlaskConical, Inbox, LayoutGrid, Menu, PanelLeft, PhoneCall, Upload, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { IS_HOSTED } from "../api";
import { href } from "../lib/router";
import { cx } from "./ui";

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number;
}

export function Shell({
  section,
  issueCount,
  topTabs,
  actions,
  children,
}: {
  section: string;
  issueCount?: number;
  topTabs: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const groups: Array<{ label: string; items: NavItem[] }> = [
    { label: "", items: [{ id: "overview", label: "Overview", icon: <LayoutGrid size={16} strokeWidth={1.6} /> }] },
    {
      label: "Monitor",
      items: [
        { id: "calls", label: "Calls", icon: <PhoneCall size={16} strokeWidth={1.6} /> },
        { id: "issues", label: "Issues", icon: <Inbox size={16} strokeWidth={1.6} />, count: issueCount },
      ],
    },
    {
      label: "Test",
      items: [{ id: "tests", label: "Regression tests", icon: <FlaskConical size={16} strokeWidth={1.6} /> }],
    },
    {
      label: "Configure",
      items: [{ id: "import", label: "Import call log", icon: <Upload size={16} strokeWidth={1.6} /> }],
    },
  ];


  // Close the mobile menu after navigating.
  useEffect(() => {
    const close = () => setDrawer(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const body = (narrow: boolean, onToggle: () => void, toggleLabel: string, toggleIcon: ReactNode) => (
    <>
      <div className="flex h-14 items-center justify-between border-b border-line/70 px-3">
        {!narrow && <span className="pl-1 font-mono text-[15px] font-bold tracking-tight">replaykit</span>}
        <button className="rounded p-1.5 text-muted hover:bg-sidebar-hover hover:text-ink" onClick={onToggle} aria-label={toggleLabel}>
          {toggleIcon}
        </button>
      </div>

      <div className="p-2.5">
        <div className={cx("flex h-10 items-center gap-2 rounded-md border border-line-strong bg-panel px-2", narrow && "justify-center px-0")}>
          <span className="grid size-5 shrink-0 place-items-center rounded bg-brand font-mono text-[11px] font-bold text-white">{IS_HOSTED ? "D" : "L"}</span>
          {!narrow && (
            <>
              <span className="truncate text-[13.5px] font-medium text-brand">{IS_HOSTED ? "Demo workspace" : "Local workspace"}</span>
              <ChevronsUpDown size={14} className="ml-auto text-subtle" />
            </>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.map((g) => (
          <div key={g.label} className="mt-3">
            {!narrow && g.label && <div className="px-2 pb-1 text-[12.5px] text-muted">{g.label}</div>}
            {g.items.map((item) => {
              const active = section === item.id;
              return (
                <a
                  key={item.id}
                  href={href([item.id])}
                  title={narrow ? item.label : undefined}
                  className={cx(
                    "my-0.5 flex h-10 items-center gap-2.5 rounded-md border px-2 text-[13.5px] md:h-9",
                    active ? "border-ink bg-panel/60 font-medium text-ink" : "border-transparent text-ink-2 hover:bg-sidebar-hover",
                    narrow && "justify-center px-0",
                  )}
                >
                  <span className={active ? "text-ink" : "text-muted"}>{item.icon}</span>
                  {!narrow && <span className="truncate">{item.label}</span>}
                  {!narrow && item.count !== undefined && item.count > 0 && (
                    <span className="ml-auto rounded bg-err-bg px-1.5 font-mono text-[11px] text-err">{item.count}</span>
                  )}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={cx("flex items-center gap-2 border-t border-line/70 px-3 py-3", narrow && "justify-center px-0")}>
        <span className="grid size-6 shrink-0 place-items-center rounded bg-ok font-mono text-[11px] font-bold text-white" title={IS_HOSTED ? "Public demo" : "Offline"}>
          {IS_HOSTED ? "P" : "O"}
        </span>
        {!narrow && (
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-medium">{IS_HOSTED ? "Public demo" : "Offline mode"}</div>
            {!IS_HOSTED && <div className="text-[12px] text-muted">No network or model calls</div>}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Desktop sidebar */}
      <aside className={cx("hidden shrink-0 flex-col border-r border-line bg-sidebar transition-[width] md:flex", collapsed ? "w-[60px]" : "w-[248px]")}>
        {body(collapsed, () => setCollapsed((c) => !c), "Toggle sidebar", <PanelLeft size={17} strokeWidth={1.6} />)}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-ink/30" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col border-r border-line bg-sidebar">
            {body(false, () => setDrawer(false), "Close menu", <X size={17} strokeWidth={1.6} />)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-end justify-between gap-3 border-b border-line bg-chrome px-3 md:px-6">
          <div className="flex min-w-0 items-end gap-2">
            <button className="mb-2.5 rounded p-1.5 text-muted hover:bg-well hover:text-ink md:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <Menu size={18} strokeWidth={1.7} />
            </button>
            <div className="min-w-0">{topTabs}</div>
          </div>
          <div className="flex items-center gap-1.5 self-center md:gap-2">{actions}</div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
