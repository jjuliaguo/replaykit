import { ChevronLeft, Download } from "lucide-react";
import { exampleCopy } from "../lib/examples";
import { useIsDesktop } from "../lib/media";
import { useEffect, useState } from "react";
import { api, type CallSummary, type FixtureSummary, type ReplayFixture } from "../api";
import { FixtureView } from "../components/FixtureView";
import { JsonView } from "../components/JsonView";
import { ReplayPanel } from "../components/ReplayPanel";
import { Badge, Button, CopyButton, Empty, ErrorNote, Tabs, cx, download } from "../components/ui";
import { href, navigate, type Route } from "../lib/router";
import type { ImportedLog } from "./CallsPage";

type Tab = "definition" | "replay" | "json";

/** "call:<name>" builds the fixture live from that call; anything else is a saved fixture file. */
async function loadFixture(ref: string, imported: Record<string, ImportedLog>): Promise<ReplayFixture> {
  if (ref.startsWith("call:")) {
    const name = ref.slice(5);
    const log = imported[name]?.raw ?? (await api.example(name));
    const r = await api.extract({ log });
    if (!r.fixture) throw new Error(`Call ${name} has no detected failure, so it has no regression test.`);
    return r.fixture;
  }
  return api.fixture(ref);
}

function ListGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-line bg-well/60 px-3 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">{title}</div>
      {children}
    </div>
  );
}

function Item({ refId, selected, title, sub, badge }: { refId: string; selected?: string; title: string; sub: string; badge?: React.ReactNode }) {
  return (
    <a
      href={href(["tests", refId])}
      className={cx("block border-b border-l-2 border-b-line px-3 py-2.5", selected === refId ? "border-l-ink bg-panel" : "border-l-transparent hover:bg-well/70")}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 text-[13px] leading-snug font-medium [overflow-wrap:anywhere]" title={title}>
          {title}
        </span>
        <span className="ml-auto shrink-0">{badge}</span>
      </div>
      <div className="mt-0.5 truncate text-[12px] text-muted">{sub}</div>
    </a>
  );
}

export function TestsPage({ route, calls, imported }: { route: Route; calls: CallSummary[] | null; imported: Record<string, ImportedLog> }) {
  const selected = route.path[1];
  const tab = (["definition", "replay", "json"].includes(route.query.get("tab") ?? "") ? route.query.get("tab") : "definition") as Tab;
  const isDesktop = useIsDesktop();
  const [saved, setSaved] = useState<FixtureSummary[] | null>(null);
  const [fixture, setFixture] = useState<ReplayFixture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fixtures().then(setSaved, (e: Error) => setError(e.message));
  }, []);

  const fromCalls = [...Object.values(imported).map((i) => i.summary), ...(calls ?? [])].filter((c) => c.fixtureId);
  // Extractor snapshots duplicate the live tests; show each fixture id once.
  const liveIds = new Set(fromCalls.map((c) => c.fixtureId));
  const visibleSaved = (saved ?? []).filter((f) => !(f.origin === "extractor" && liveIds.has(f.id)) || f.ref === selected);
  const hiddenSnapshots = (saved ?? []).length - visibleSaved.length;

  useEffect(() => {
    if (!selected) {
      const first = fromCalls[0];
      if (first && isDesktop) navigate(["tests", `call:${first.name}`]);
      return;
    }
    let live = true;
    setFixture(null);
    setError(null);
    loadFixture(selected, imported).then(
      (f) => live && setFixture(f),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, imported, calls === null]);

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
      <div className={cx("min-h-0 overflow-y-auto border-line bg-canvas md:block md:border-r", selected ? "hidden" : "block")}>
        <ListGroup title="Generated from calls">
          {fromCalls.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-muted">No call has a detected failure.</div>}
          {fromCalls.map((c) => (
            <Item
              key={c.name}
              refId={`call:${c.name}`}
              selected={selected}
              title={exampleCopy(c.name, true).title}
              sub={`${c.fixtureId ?? c.name} · ${[...new Set(c.findings.map((f) => f.type))].join(" + ")}`}
              badge={<Badge tone="info">live</Badge>}
            />
          ))}
        </ListGroup>
        <ListGroup title="Saved fixture files">
          {saved === null && <div className="px-3 py-2.5 text-[12.5px] text-muted">Loading…</div>}
          {hiddenSnapshots > 0 && (
            <div className="border-b border-line px-3 py-2 text-[12px] text-muted">
              {hiddenSnapshots} snapshot{hiddenSnapshots > 1 ? "s" : ""} in fixtures/generated hidden: same id as a live test above.
            </div>
          )}
          {visibleSaved.map((f) => (
            <Item
              key={f.ref}
              refId={f.ref}
              selected={selected}
              title={f.ref}
              sub={f.valid ? `${f.origin} · ${f.failures.join(" + ") || "no failures listed"}` : `invalid: ${f.error ?? ""}`}
              badge={f.valid ? undefined : <Badge tone="err">invalid</Badge>}
            />
          ))}
        </ListGroup>
      </div>

      <div className={cx("min-h-0 min-w-0 flex-col md:flex", selected ? "flex" : "hidden")}>
        {error && <div className="p-6"><ErrorNote error={error} /></div>}
        {!error && !fixture && <div className="p-6 text-[13px] text-muted">{selected ? "Loading test…" : <Empty title="No test selected" />}</div>}
        {fixture && (
          <>
            <div className="border-b border-line px-4 pt-4 md:px-6 md:pt-5">
              <a href={href(["tests"])} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink md:hidden">
                <ChevronLeft size={14} /> All tests
              </a>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-[16px] leading-snug font-semibold">
                      {selected?.startsWith("call:") ? exampleCopy(selected.slice(5), true).title : fixture.name}
                    </h1>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className="font-mono text-[12px] break-all text-muted">{fixture.id}</span>
                    <CopyButton text={fixture.id} label="ID" />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {fixture.failures.map((f, i) => (
                      <Badge key={i} tone={f.confidence === "high" ? "err" : "warn"}>
                        {f.type} · {f.confidence}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="ml-auto flex gap-2">
                  {selected?.startsWith("call:") && (
                    <a href={href(["calls", selected.slice(5)], { tab: "trace" })}>
                      <Button>Source call</Button>
                    </a>
                  )}
                  <Button onClick={() => download(`${fixture.id}.json`, fixture)}>
                    <Download size={13} />
                    JSON
                  </Button>
                </div>
              </div>
              <Tabs<Tab>
                className="mt-4"
                value={tab}
                onChange={(t) => navigate(["tests", selected!], { tab: t })}
                tabs={[
                  { id: "definition", label: "Definition" },
                  { id: "replay", label: "Replay" },
                  { id: "json", label: "Fixture JSON" },
                ]}
              />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
              {tab === "definition" && <FixtureView fixture={fixture} />}
              {tab === "replay" && <ReplayPanel fixture={fixture} />}
              {tab === "json" && <JsonView value={fixture} maxHeight={10_000} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
