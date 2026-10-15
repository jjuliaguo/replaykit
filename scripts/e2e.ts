/**
 * npm run e2e [-- <call-log.json>]
 *
 * Runs the golden path on one call log (default: the booking false
 * confirmation example), prints every step with its checks, and writes the
 * fixture and the replay report to reports/e2e/. Exits 0 only if every step
 * passed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runGoldenPath } from "../src/e2e/golden-path.js";
import { renderHtmlReport } from "../src/replay/report/html-report.js";

const file = process.argv[2] ?? "examples/call-logs/booking-false-confirmation.json";
const outDir = "reports/e2e";

const log = JSON.parse(readFileSync(file, "utf8"));
const r = await runGoldenPath({ log, fallbackId: path.basename(file, ".json") });

const mark = { pass: "PASS", fail: "FAIL", skipped: "SKIP" } as const;
console.log(`\nReplayKit golden path: ${file}\n`);
r.steps.forEach((st, i) => {
  console.log(`${i + 1}. [${mark[st.status]}] ${st.title}  (${st.owner}, ${st.durationMs} ms)`);
  console.log(`   ${st.detail}`);
  for (const c of st.checks) console.log(`   ${c.ok ? "ok " : "BAD"} ${c.label}: expected ${c.expected}, got ${c.actual}`);
});

if (r.fixture || r.report) {
  mkdirSync(outDir, { recursive: true });
  if (r.fixture) writeFileSync(path.join(outDir, "fixture.json"), JSON.stringify(r.fixture, null, 2) + "\n");
  if (r.report) {
    writeFileSync(path.join(outDir, "report.json"), JSON.stringify(r.report, null, 2) + "\n");
    writeFileSync(path.join(outDir, "report.html"), renderHtmlReport(r.report));
  }
  console.log(`\nArtifacts: ${outDir}/fixture.json, report.json, report.html`);
}
console.log(`\n${r.ok ? "END-TO-END PASS" : "END-TO-END FAIL"}\n`);
process.exit(r.ok ? 0 : 1);
