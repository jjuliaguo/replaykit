// ReplayKit web app. Talks only to the local server; renders with
// textContent everywhere, so log and model text can never inject HTML.

const $ = (id) => document.getElementById(id);
const state = { fixture: null, fixtureLabel: null, report: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  return node;
}

const SERVER_HELP =
  "Can't reach the ReplayKit server. Start it from the replaykit-integrated folder with `npm run web`, then reload this page.";

async function api(path, body) {
  if (location.protocol === "file:") {
    throw new Error("This page was opened as a file. Run `npm run web` in replaykit-integrated and open http://127.0.0.1:4321 instead.");
  }
  let res;
  try {
    res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    // fetch only throws when no HTTP response arrived: the server is down or unreachable.
    throw new Error(SERVER_HELP);
  }
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function setStatus(id, text, isError = false) {
  const s = $(id);
  s.textContent = text;
  s.classList.toggle("error", isError);
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pretty = (v) => JSON.stringify(v, null, 2);
const TYPE_LABEL = {
  false_success_claim: "False success claim",
  unverified_success_claim: "Success claimed without required tool",
  tool_result_misread: "Contradicts tool result",
  unhandled_tool_error: "Tool error not handled",
};
const KIND_LABEL = {
  tool_called: "Must call tool",
  no_success_claim: "Must not claim success",
  acknowledges_failure: "Must tell the user it failed",
  consistent_with_tool_result: "Must agree with tool result",
  rubric: "Rubric (LLM judge, skipped offline)",
};

// ---------- Step 1: call log ----------

async function loadExamples() {
  const examples = await api("/api/examples");
  const select = $("example-select");
  select.replaceChildren(
    el("option", { value: "", text: "Paste your own log…" }),
    ...examples.map((e) => el("option", { value: e.name, text: `${e.name}  (${e.format})` })),
  );
  select.dataset.notes = JSON.stringify(Object.fromEntries(examples.map((e) => [e.name, e.notes])));
  const first = examples.find((e) => e.name === "booking-false-confirmation") ?? examples[0];
  if (first) {
    select.value = first.name;
    await showExample(first.name);
  }
}

async function showExample(name) {
  const notes = JSON.parse($("example-select").dataset.notes || "{}");
  $("example-notes").textContent = name ? notes[name] ?? "" : "Paste a ReplayKit call log or an OpenAI chat transcript ({\"messages\": [...]}).";
  if (!name) {
    $("log-input").value = "";
    return;
  }
  $("log-input").value = pretty(await api(`/api/example?name=${encodeURIComponent(name)}`));
}

async function runExtract() {
  let log;
  try {
    log = JSON.parse($("log-input").value);
  } catch (e) {
    setStatus("extract-status", `The call log is not valid JSON: ${e.message}`, true);
    return;
  }
  $("extract-btn").disabled = true;
  setStatus("extract-status", "Analyzing…");
  try {
    const r = await api("/api/extract", { log, minConfidence: $("min-confidence").value });
    renderFindings(r);
    setStatus("extract-status", `Done in ${r.durationMs} ms. ${r.findings.length} finding(s).`);
    $("step-findings").scrollIntoView();
  } catch (e) {
    setStatus("extract-status", e.message, true);
  } finally {
    $("extract-btn").disabled = false;
  }
}

// ---------- Step 2: findings and fixture ----------

function renderFindings(r) {
  $("findings-empty").hidden = true;
  $("findings").hidden = false;
  const flagged = new Set(r.findings.flatMap((f) => f.evidence.map((e) => e.eventIndex)));

  const summary = $("findings-summary");
  if (r.findings.length === 0) {
    summary.className = "summary clean";
    summary.textContent = `No failure detected in ${r.callLog.id}. No test was generated: ReplayKit does not invent failures.`;
  } else {
    summary.className = "summary found";
    summary.textContent = `${r.findings.length} failure(s) found in ${r.callLog.id} (${r.callLog.kind}, ${r.callLog.provider}).`;
  }

  $("findings-list").replaceChildren(
    ...r.findings.map((f) =>
      el(
        "div",
        { class: "finding" },
        el(
          "div",
          { class: "finding-top" },
          el("span", { class: "type", text: TYPE_LABEL[f.type] ?? f.type }),
          el("span", { class: `badge ${f.confidence}`, text: `${f.confidence} confidence` }),
          f.toolName ? el("code", { text: f.toolName }) : null,
        ),
        el("div", { text: f.summary }),
        el(
          "ul",
          { class: "evidence" },
          f.evidence.map((e) =>
            el(
              "li",
              {},
              el("span", { class: "ev-idx", text: `event ${e.eventIndex}${e.path ? ` · ${e.path}` : ""}` }),
              e.description,
              e.quote ? el("q", { text: e.quote }) : null,
            ),
          ),
        ),
      ),
    ),
  );

  $("transcript").replaceChildren(
    ...r.callLog.events.map((ev, i) => {
      let text;
      if (ev.type === "message") text = [el("span", { class: "role", text: ev.role }), ev.content];
      else if (ev.type === "tool_call") text = [el("span", { class: "role", text: "tool call" }), `${ev.toolName}(${JSON.stringify(ev.arguments)})`];
      else {
        const what = ev.error ? `ERROR ${ev.error.kind}: ${ev.error.message}` : `${ev.response?.status ?? ""} ${JSON.stringify(ev.response?.body ?? null)}`;
        text = [el("span", { class: "role", text: "tool result" }), what.trim()];
      }
      return el("li", { class: flagged.has(i) ? "flagged" : "" }, el("span", { class: "ev-idx", text: `${i} ` }), ...text);
    }),
  );

  const panel = $("fixture-panel");
  if (!r.fixture) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const fx = r.fixture;
  $("fixture-meta").textContent = `${fx.name} · id ${fx.id} · ${fx.expectations.length} expectation(s) · ${fx.replay.interactions.length} recorded interaction(s)`;
  $("interactions").replaceChildren(
    ...(fx.replay.interactions.length
      ? fx.replay.interactions.map((i) =>
          el(
            "div",
            { class: "interaction" },
            el("strong", { text: i.toolName }),
            " ",
            el("span", { class: "muted", text: i.error ? `simulated ${i.error.kind}` : `HTTP ${i.response?.status ?? "(no status recorded)"}` }),
            el("pre", { class: "code", text: pretty(i.error ?? i.response?.body ?? null) }),
          ),
        )
      : [el("p", { class: "muted", text: "None. The original agent never called the required tool, so there is no response to replay." })]),
  );
  $("expectations").replaceChildren(
    ...fx.expectations.map((e) => el("li", {}, el("span", { class: "kind", text: KIND_LABEL[e.kind] ?? e.kind }), e.description)),
  );
  $("fixture-json").textContent = pretty(fx);
  state.fixture = fx;
  state.fixtureLabel = `Just generated: ${fx.id}`;
  refreshFixtureSelect();
}

// ---------- Step 3: replay ----------

async function loadAgents() {
  const agents = await api("/api/agents");
  const defaults = new Set(["original", "honor"]);
  $("agent-list").replaceChildren(
    ...agents.map((a) =>
      el(
        "label",
        { class: "agent" },
        el("input", { type: "checkbox", value: a.id, checked: defaults.has(a.id) }),
        el("span", {}, el("strong", { text: a.label }), a.description),
      ),
    ),
  );
}

let savedFixtures = [];
async function loadFixtures() {
  savedFixtures = await api("/api/fixtures");
  refreshFixtureSelect();
}

function refreshFixtureSelect() {
  const select = $("fixture-select");
  const previous = select.value;
  const options = [];
  if (state.fixture) options.push(el("option", { value: "__generated__", text: state.fixtureLabel }));
  for (const f of savedFixtures.filter((x) => x.valid)) {
    options.push(el("option", { value: f.ref, text: `${f.ref}  ·  ${f.origin}` }));
  }
  select.replaceChildren(...options);
  if (state.fixture) select.value = "__generated__";
  else if (previous) select.value = previous;
}

async function runReplay() {
  const agents = [...document.querySelectorAll("#agent-list input:checked")].map((i) => i.value);
  if (agents.length === 0) {
    setStatus("replay-status", "Choose at least one agent.", true);
    return;
  }
  const choice = $("fixture-select").value;
  const body = choice === "__generated__" ? { fixture: state.fixture, agents } : { fixtureRef: choice, agents };
  $("replay-btn").disabled = true;
  setStatus("replay-status", "Replaying…");
  try {
    const r = await api("/api/replay", body);
    renderReplay(r);
    setStatus("replay-status", `Done in ${r.durationMs} ms.`);
  } catch (e) {
    setStatus("replay-status", e.message, true);
  } finally {
    $("replay-btn").disabled = false;
  }
}

function renderReplay(r) {
  state.report = r;
  $("replay-results").hidden = false;
  const runs = r.report.runs;

  $("run-cards").replaceChildren(
    ...runs.map((run) =>
      el(
        "div",
        { class: `run-card ${run.overall}` },
        el("div", { class: "muted", text: run.trace.agentId }),
        el("div", { class: "verdict", text: run.overall === "pass" ? "PASS" : "FAIL" }),
        el("div", { text: `${run.passed} passed · ${run.failed} failed · ${run.skipped} skipped` }),
        el("div", { class: "muted", text: `${run.trace.toolCalls.length} tool call(s) · ${run.trace.status}` }),
        run.trace.finalMessage ? el("div", { class: "reply", text: `“${run.trace.finalMessage}”` }) : null,
      ),
    ),
  );

  const c = r.report.comparison;
  const cmp = $("comparison");
  if (c) {
    const list = (title, items) =>
      items.length ? el("div", {}, el("strong", { text: `${title} (${items.length})` }), el("ul", {}, items.map((d) => el("li", { text: `${d.description}: ${d.from} → ${d.to}` })))) : null;
    const verdict =
      c.regressed.length > 0 ? "Regression: something that passed now fails." : c.stillFailing.length === 0 && c.improved.length > 0 ? "Fixed: every failing expectation now passes." : c.improved.length > 0 ? "Partly fixed." : "No improvement.";
    cmp.replaceChildren(
      el(
        "div",
        { class: "compare" },
        el("strong", { text: `${c.candidateId} vs ${c.baselineId}: ${verdict}` }),
        list("Fixed", c.improved),
        list("Still failing", c.stillFailing),
        list("Regressed", c.regressed),
      ),
    );
  } else cmp.replaceChildren();

  const ids = [...new Map(runs.flatMap((run) => run.expectationResults.map((e) => [e.id, e.description]))).entries()];
  $("matrix").replaceChildren(
    el("thead", {}, el("tr", {}, el("th", { text: "Expectation" }), runs.map((run) => el("th", { text: run.trace.agentId })))),
    el(
      "tbody",
      {},
      ids.map(([id, description]) =>
        el(
          "tr",
          {},
          el("td", { text: description }),
          runs.map((run) => {
            const e = run.expectationResults.find((x) => x.id === id);
            return el("td", {}, e ? el("span", { class: `badge ${e.outcome}`, text: e.outcome }) : "–", e ? el("span", { class: "reason", text: e.reason }) : null);
          }),
        ),
      ),
    ),
  );

  $("report-frame").srcdoc = r.html;
}

// ---------- wiring ----------

$("example-select").addEventListener("change", (e) => showExample(e.target.value).catch((err) => setStatus("extract-status", err.message, true)));
$("extract-btn").addEventListener("click", runExtract);
$("use-fixture-btn").addEventListener("click", () => {
  refreshFixtureSelect();
  $("step-replay").scrollIntoView();
});
$("download-fixture-btn").addEventListener("click", () => state.fixture && download(`${state.fixture.id}.json`, pretty(state.fixture) + "\n"));
$("replay-btn").addEventListener("click", runReplay);
$("open-report-btn").addEventListener("click", () => {
  if (!state.report) return;
  const url = URL.createObjectURL(new Blob([state.report.html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
$("download-report-btn").addEventListener("click", () => state.report && download(`replay-report-${state.report.report.fixture.id}.json`, pretty(state.report.report) + "\n"));

Promise.all([loadExamples(), loadAgents(), loadFixtures()]).catch((e) => setStatus("extract-status", `Could not reach the server: ${e.message}`, true));
