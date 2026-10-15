import { ChevronsUpDown, FlaskConical, Inbox, PanelLeft, PhoneCall, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
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
  const groups: Array<{ label: string; items: NavItem[] }> = [
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

  return (
    <div className="flex h-full min-h-0">
      <aside className={cx("flex shrink-0 flex-col border-r border-line bg-sidebar transition-[width]", collapsed ? "w-[60px]" : "w-[248px]")}>
        <div className="flex h-14 items-center justify-between border-b border-line/70 px-3">
          {!collapsed && <span className="pl-1 font-mono text-[15px] font-bold tracking-tight">replaykit</span>}
          <button className="rounded p-1.5 text-muted hover:bg-sidebar-hover hover:text-ink" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <PanelLeft size={17} strokeWidth={1.6} />
          </button>
        </div>

        <div className="p-2.5">
          <div className={cx("flex h-10 items-center gap-2 rounded-md border border-line-strong bg-panel px-2", collapsed && "justify-center px-0")}>
            <span className="grid size-5 shrink-0 place-items-center rounded bg-brand font-mono text-[11px] font-bold text-white">L</span>
            {!collapsed && (
              <>
                <span className="truncate text-[13.5px] font-medium text-brand">Local workspace</span>
                <ChevronsUpDown size={14} className="ml-auto text-subtle" />
              </>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
          {groups.map((g) => (
            <div key={g.label} className="mt-3">
              {!collapsed && <div className="px-2 pb-1 text-[12.5px] text-muted">{g.label}</div>}
              {g.items.map((item) => {
                const active = section === item.id;
                return (
                  <a
                    key={item.id}
                    href={href([item.id])}
                    title={collapsed ? item.label : undefined}
                    className={cx(
                      "my-0.5 flex h-9 items-center gap-2.5 rounded-md border px-2 text-[13.5px]",
                      active ? "border-ink bg-panel/60 font-medium text-ink" : "border-transparent text-ink-2 hover:bg-sidebar-hover",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <span className={active ? "text-ink" : "text-muted"}>{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.count !== undefined && item.count > 0 && (
                      <span className="ml-auto rounded bg-err-bg px-1.5 font-mono text-[11px] text-err">{item.count}</span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={cx("flex items-center gap-2 border-t border-line/70 px-3 py-3", collapsed && "justify-center px-0")}>
          <span className="grid size-6 shrink-0 place-items-center rounded bg-ok font-mono text-[11px] font-bold text-white" title="Offline">
            O
          </span>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="text-[13px] font-medium">Offline mode</div>
              <div className="text-[12px] text-muted">No network or model calls</div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-end justify-between gap-4 border-b border-line bg-chrome px-6">
          <div className="min-w-0">{topTabs}</div>
          <div className="flex items-center gap-2 self-center">{actions}</div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
