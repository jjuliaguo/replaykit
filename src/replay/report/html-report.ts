import type { ReplayKitReport, EvaluatedRun, ExpectationResult } from "../types.js";

export function renderHtmlReport(report: ReplayKitReport): string {
  const runs = report.runs.map(renderRun).join("\n");
  const comparison = report.comparison ? renderComparison(report) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ReplayKit — ${escapeHtml(report.fixture.name)}</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2330;
      --panel-2: #243044;
      --text: #e7eef7;
      --muted: #93a4bb;
      --line: #31425a;
      --pass: #3dd68c;
      --fail: #ff6b7a;
      --skip: #f5c36e;
      --accent: #7aa2ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(1200px 600px at 10% -10%, #1c2b44 0%, var(--bg) 55%);
      color: var(--text);
      line-height: 1.5;
    }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 1.6rem; margin: 0 0 8px; }
    h2 { font-size: 1.15rem; margin: 28px 0 12px; }
    h3 { margin: 0 0 8px; font-size: 1rem; }
    .muted { color: var(--muted); }
    .badge {
      display: inline-block;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      margin-right: 6px;
    }
    .badge.pass { color: var(--pass); border-color: #245c43; }
    .badge.fail { color: var(--fail); border-color: #6d3038; }
    .badge.skipped { color: var(--skip); border-color: #6d5528; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px 18px;
      margin: 12px 0;
    }
    pre, code {
      font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
      font-size: 12.5px;
    }
    pre {
      background: #0c1117;
      border-radius: 10px;
      padding: 12px;
      overflow: auto;
      border: 1px solid var(--line);
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
    .quote { font-style: italic; color: var(--text); }
    .small { font-size: 13px; }
    a { color: var(--accent); }
  </style>
</head>
<body>
<main>
  <div class="badge">${escapeHtml(report.fixture.sourceKind)}</div>
  <div class="badge">${escapeHtml(report.mode)}</div>
  <div class="badge">${escapeHtml(report.fixture.sourceProvider)}</div>
  <h1>${escapeHtml(report.fixture.name)}</h1>
  <p class="muted">${escapeHtml(report.fixture.description ?? "")}</p>
  <p class="small muted">Fixture <code>${escapeHtml(report.fixture.id)}</code> · generated ${escapeHtml(report.generatedAt)}</p>

  <h2>Original failure</h2>
  <div class="panel">
    ${report.original.failures
      .map(
        (f) => `<p><span class="badge fail">${escapeHtml(f.confidence)}</span>
        <strong>${escapeHtml(f.type)}</strong> — ${escapeHtml(f.summary)}</p>`,
      )
      .join("")}
    ${
      report.original.finalAgentMessage
        ? `<p class="quote">“${escapeHtml(report.original.finalAgentMessage)}”</p>`
        : ""
    }
  </div>

  <h2>Recorded tool conditions</h2>
  <p class="muted small">These payloads are replayed verbatim. ReplayKit does not rewrite them.</p>
  ${report.recordedInteractions
    .map(
      (i) => `<div class="panel">
        <h3>${escapeHtml(i.toolName)} <span class="muted">#${escapeHtml(i.id)}</span></h3>
        <pre>${escapeHtml(JSON.stringify({ status: i.status, body: i.body, error: i.error }, null, 2))}</pre>
      </div>`,
    )
    .join("")}

  ${comparison}

  <h2>Replay runs</h2>
  <div class="grid">
    ${runs}
  </div>
</main>
</body>
</html>`;
}

function renderComparison(report: ReplayKitReport): string {
  const c = report.comparison;
  if (!c) return "";
  const row = (title: string, items: Array<{ id: string; description: string }>, cls: string) =>
    `<div class="panel"><h3>${title}</h3>${
      items.length === 0
        ? `<p class="muted">None</p>`
        : `<ul>${items.map((i) => `<li><span class="badge ${cls}">${escapeHtml(i.id)}</span> ${escapeHtml(i.description)}</li>`).join("")}</ul>`
    }</div>`;
  return `<h2>Version comparison</h2>
    <p class="muted">${escapeHtml(c.baselineId)} → ${escapeHtml(c.candidateId)}</p>
    ${row("Improved (fail → pass)", c.improved, "pass")}
    ${row("Still failing", c.stillFailing, "fail")}
    ${row("Regressed (pass → fail)", c.regressed, "fail")}`;
}

function renderRun(run: EvaluatedRun): string {
  const overall = run.overall;
  return `<section class="panel">
    <h3>${escapeHtml(run.trace.agentId)} <span class="badge ${overall}">${overall}</span></h3>
    <p class="small muted">${escapeHtml(run.trace.agentKind)} · ${run.passed} pass · ${run.failed} fail · ${run.skipped} skipped · ${run.trace.durationMs}ms</p>
    ${run.trace.error ? `<p class="badge fail">${escapeHtml(run.trace.error)}</p>` : ""}
    ${run.trace.finalMessage ? `<p class="quote">“${escapeHtml(run.trace.finalMessage)}”</p>` : "<p class='muted'>No final assistant message.</p>"}
    <table>
      <thead><tr><th>Expectation</th><th>Result</th></tr></thead>
      <tbody>
        ${run.expectationResults.map(renderExpectation).join("")}
      </tbody>
    </table>
    <p class="small muted">Tool calls</p>
    <pre>${escapeHtml(
      JSON.stringify(
        run.trace.toolCalls.map((c) => ({
          toolName: c.toolName,
          arguments: c.arguments,
          matched: c.result.matched,
          kind: c.result.kind,
          interactionId: c.result.matched ? c.result.interactionId : undefined,
          status: c.result.kind === "response" || c.result.kind === "unmatched" ? c.result.status : undefined,
        })),
        null,
        2,
      ),
    )}</pre>
  </section>`;
}

function renderExpectation(result: ExpectationResult): string {
  return `<tr>
    <td>
      <div><span class="badge">${escapeHtml(result.kind)}</span> ${escapeHtml(result.description)}</div>
      <div class="small muted">${escapeHtml(result.reason)}</div>
    </td>
    <td><span class="badge ${result.outcome}">${result.outcome}</span></td>
  </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
