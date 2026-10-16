import { Compass, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type CallSummary } from "./api";
import { Shell } from "./components/Shell";
import { Tour } from "./components/Tour";
import { Button, Tabs } from "./components/ui";
import { CallsPage, type ImportedLog } from "./pages/CallsPage";
import { ImportPage } from "./pages/ImportPage";
import { IssuesPage } from "./pages/IssuesPage";
import { OverviewPage } from "./pages/OverviewPage";
import { TestsPage } from "./pages/TestsPage";
import { navigate, useRoute } from "./lib/router";

const TITLES: Record<string, string> = {
  overview: "Overview",
  calls: "Calls",
  issues: "Issues",
  tests: "Regression tests",
  import: "Import call log",
};

export function App() {
  const route = useRoute();
  const section = route.path[0] && TITLES[route.path[0]] ? route.path[0] : "overview";
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, ImportedLog>>({});

  const load = useCallback(() => {
    setError(null);
    api.calls().then(setCalls, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const allSummaries = [...Object.values(imported).map((i) => i.summary), ...(calls ?? [])];
  const issueCount = allSummaries.reduce((n, c) => n + c.findings.length, 0);

  // Every load of the Overview opens the tour; the Tour button reopens it.
  const [tour, setTour] = useState(section === "overview");
  const closeTour = () => setTour(false);

  return (
    <Shell
      section={section}
      issueCount={calls ? issueCount : undefined}
      topTabs={<Tabs tabs={[{ id: section, label: TITLES[section] }]} value={section} onChange={() => {}} />}
      side={tour ? <Tour onClose={closeTour} /> : null}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigate(["overview"]);
              setTour(true);
            }}
            title="Take a guided tour"
            aria-label="Take a guided tour"
          >
            <Compass size={13} />
            <span className="hidden sm:inline">Tour</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={load} title="Re-run the extractor over every call log">
            <RefreshCw size={13} />
            <span className="hidden sm:inline">Re-analyze</span>
          </Button>
          {section !== "import" && (
            <Button variant="primary" onClick={() => navigate(["import"])} title="Import a call log" aria-label="Import a call log" data-tour="import">
              <Upload size={13} />
              <span className="hidden sm:inline">Import log</span>
            </Button>
          )}
        </>
      }
    >
      {section === "overview" && <OverviewPage calls={calls} />}
      {section === "calls" && <CallsPage route={route} calls={calls} imported={imported} error={error} />}
      {section === "issues" && <IssuesPage calls={calls ? allSummaries : null} error={error} />}
      {section === "tests" && <TestsPage route={route} calls={calls} imported={imported} />}
      {section === "import" && <ImportPage onImport={(name, log) => setImported((m) => ({ ...m, [name]: log }))} />}
    </Shell>
  );
}
