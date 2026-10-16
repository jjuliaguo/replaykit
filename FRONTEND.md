# ReplayKit frontend (branch `frontend`)

A minimal, technical UI for tracing why a voice-agent call went wrong and checking whether a fixed agent handles it. The visual language follows the reference dashboard: warm off-white canvas, a tinted sidebar with grouped navigation, underline tabs, 1px rules, black primary buttons, and a dotted canvas for topology. There are no gradients, glows, or decorative charts. Bland's name and logo are not used.

## Stack and why

| Choice | Why |
| --- | --- |
| React 19 + TypeScript | Matches the component model of the reference UI. The app imports the shared fixture types and the replay engine types directly (type-only), so the UI cannot drift from the data it renders. |
| Vite 8 | Fast builds (under a second) and a dev server that proxies the local API. |
| Tailwind CSS 4 | Design tokens live in one `@theme` block (`frontend/src/index.css`). It makes the flat, bordered, dense look cheap to keep consistent. |
| lucide-react | Thin line icons that match the reference's icon weight. |
| No router or state library | A small hash router gives every view a shareable link (`#/calls/<id>?tab=trace&event=3`). State is local to each page. |

The server (`src/web/server.ts`) serves the built app from `frontend/dist`. It has no runtime dependencies beyond the extractor and the replay engine.

## Run

```bash
npm install
```

```bash
npm run web
```

`npm run web` builds the frontend and starts the server at http://127.0.0.1:4321. For frontend work with hot reload, run `npm run serve` in one terminal and `npm run dev:web` in another, then open http://127.0.0.1:5173.

## Views

- **Calls.** On the left is every call log run through the extractor, with issue counts and filters. On the right is the selected call:
  - **Root-cause strip:** one line per finding. It shows the tool, its HTTP status, the exact failing field and value, and what the agent then told the caller. Every segment jumps to the event.
  - **Trace:** the call as events. Each tool call and its result are one request row with method, URL, status, latency, and an `app error` flag when HTTP 200 carries a failure. Expanding a row shows request arguments and headers, and the response body with the failing field highlighted inline. A copy-as-curl button reproduces the request against the real endpoint, with redacted headers left as placeholders. Agent replies have the offending claim marked.
  - **Issues:** findings with confidence, detector name, and evidence rows that link into the trace.
  - **Regression test:** the generated fixture with its replay topology, pinned responses, matching strategy, provenance, and expectations.
  - **Raw log:** the submitted JSON.
- **Issues.** Every finding across all calls, sorted by confidence. Each row deep-links to the event.
- **Regression tests.** The tests generated live from calls, plus saved fixture files. Extractor snapshots that duplicate a live test are hidden.
  - **Definition:** what the fixture pins and requires.
  - **Replay:** runs agents in order, baseline first and candidate last. It shows the fixed, still-failing, or regressed verdict and the expectation matrix with reasons. Evidence is collapsed. A per-agent replay trace shows, for each tool call, which recording matched and by which strategy. A **verbatim** badge confirms the returned status and body equal the recording, checked in the UI against the fixture, not trusted from the engine.
- **Import call log.** Paste a ReplayKit call log or an OpenAI chat transcript. It is analyzed by the local server and kept in the browser tab only.

## Review notes

The first build was reviewed from the point of view of an engineer tracing an API failure. These changes came out of that review:

- Call and fixture IDs wrapped at hyphens instead of being cut off, so the part that differs stays visible.
- A root-cause strip was added, so the failure chain is readable without opening the trace.
- The replay verbatim check was added. Faithful replay is the property everything else depends on, so it should be visible, not assumed.
- Evidence in the expectation matrix was collapsed, because it buried the pass or fail reasons.
- Duplicate tests were removed from the test list.
- The "failed tool results" plural was fixed, and relative timestamps were added for logs that record `at`.

## Known limits

- **No live runner.** Agents in the replay view are the replay engine's deterministic stand-ins. Running a real agent needs a live runner, which is not built.
- **Session-only imports.** Imported logs are lost on reload.
- **Desktop layout.** The layout targets desktop widths. The two-pane views are not adapted for phones.
- **Not yet run on real calls.** No real Bland call data has been loaded.
