import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadFixtureFile } from "./load.js";
import { listenMockServer } from "./mock-server.js";
import { parseAgentToken, refuseLive, runReplaySuite, writeReports, type AgentSpec } from "./pipeline.js";
import type { ReplayKitReport } from "./types.js";

const HELP = `ReplayKit — replay, evaluate, report

Usage:
  npm run demo
  npm run replay -- <fixture.json> [--agents original,naive,honor]
  npm run compare -- <fixture.json>
  npm run server -- <fixture.json> [--port 3000]

Flags:
  --agents   Comma-separated: original, naive, honor, skip, policy:<id>
  --out      Report directory (default: reports)
  --live     Opt into a paid OpenAI run (refused unless approved and keyed)
  --port     Mock webhook port (default: 3000)

The demo is fully offline. It never calls a model API.
`;

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agents: { type: "string" },
      out: { type: "string", default: "reports" },
      live: { type: "boolean", default: false },
      port: { type: "string", default: "3000" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    if (positionals.length === 0 && !values.help) process.exitCode = 1;
    return;
  }

  const command = positionals[0];
  const liveBlock = refuseLive(Boolean(values.live), process.env.OPENAI_API_KEY);
  if (values.live) {
    console.error(liveBlock);
    process.exitCode = 1;
    return;
  }

  if (command === "demo") {
    await demo(values.out ?? "reports");
    return;
  }

  const fixturePath = positionals[1];
  if (!fixturePath) {
    console.error("A fixture path is required.");
    process.exitCode = 1;
    return;
  }
  const fixture = loadFixtureFile(resolve(fixturePath));

  if (command === "server") {
    const port = Number(values.port ?? 3000);
    const mock = await listenMockServer(fixture, port);
    console.log(`ReplayKit mock webhook listening on ${mock.url}`);
    console.log(`Health: ${mock.url}/health`);
    console.log(`Derived from fixture ${fixture.id}. Ctrl+C to stop.`);
    await new Promise(() => undefined);
    return;
  }

  const specs = parseAgents(values.agents, command === "compare" ? "naive,honor" : "original,honor");
  if (command === "replay" || command === "compare") {
    const report = await runReplaySuite(fixture, specs);
    const out = writeReports(report, values.out ?? "reports", fixture.id);
    printSummary(report, out.htmlPath);
    return;
  }

  console.error(`Unknown command "${command}".`);
  process.stdout.write(HELP);
  process.exitCode = 1;
}

function parseAgents(raw: string | undefined, fallback: string): AgentSpec[] {
  return (raw ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseAgentToken);
}

async function demo(outDir: string): Promise<void> {
  const booking = loadFixtureFile(resolve("fixtures/booking-unavailable.json"));
  const payment = loadFixtureFile(resolve("fixtures/synthetic-payment-declined.json"));
  const skip = loadFixtureFile(resolve("fixtures/synthetic-unverified-cancel.json"));

  const bookingReport = await runReplaySuite(booking, [
    { type: "original" },
    { type: "policy", policy: "skip" },
    { type: "policy", policy: "honor" },
  ]);
  const paymentReport = await runReplaySuite(payment, [
    { type: "original" },
    { type: "policy", policy: "honor" },
  ]);
  const skipReport = await runReplaySuite(skip, [
    { type: "original" },
    { type: "policy", policy: "honor" },
  ]);

  const bookingOut = writeReports(bookingReport, outDir, "demo-booking");
  writeReports(paymentReport, outDir, "demo-payment");
  writeReports(skipReport, outDir, "demo-cancel");

  const index = indexHtml([
    { title: booking.name, file: "demo-booking.html", overall: bookingReport.runs.at(-1)?.overall ?? "fail" },
    { title: payment.name, file: "demo-payment.html", overall: paymentReport.runs.at(-1)?.overall ?? "fail" },
    { title: skip.name, file: "demo-cancel.html", overall: skipReport.runs.at(-1)?.overall ?? "fail" },
  ]);
  mkdirSync(outDir, { recursive: true });
  const indexPath = join(outDir, "index.html");
  writeFileSync(indexPath, index, "utf8");

  console.log("ReplayKit offline demo");
  console.log("----------------------");
  printSummary(bookingReport, bookingOut.htmlPath);
  printSummary(paymentReport, join(outDir, "demo-payment.html"));
  printSummary(skipReport, join(outDir, "demo-cancel.html"));
  console.log(`\nOpen ${resolve(indexPath)}`);
}

function printSummary(report: ReplayKitReport, htmlPath: string): void {
  console.log(`\n${report.fixture.name}`);
  for (const run of report.runs) {
    console.log(
      `  ${run.overall.toUpperCase().padEnd(4)}  ${run.trace.agentId.padEnd(16)}  ${run.passed}p/${run.failed}f/${run.skipped}s  “${(run.trace.finalMessage ?? "").slice(0, 88)}"`,
    );
  }
  if (report.comparison) {
    console.log(
      `  improved ${report.comparison.improved.length}, still failing ${report.comparison.stillFailing.length}, regressed ${report.comparison.regressed.length}`,
    );
  }
  console.log(`  report  ${resolve(htmlPath)}`);
}

function indexHtml(entries: Array<{ title: string; file: string; overall: string }>): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>ReplayKit demo</title>
<style>body{font-family:Segoe UI,sans-serif;background:#0f1419;color:#e7eef7;margin:40px}a{color:#7aa2ff}li{margin:8px 0}</style>
</head><body>
<h1>ReplayKit offline demo</h1>
<p>Synthetic fixtures only. No model API calls were made.</p>
<ul>
${entries.map((e) => `<li><a href="${e.file}">${escape(e.title)}</a> — candidate ${e.overall}</li>`).join("")}
</ul>
</body></html>`;
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
