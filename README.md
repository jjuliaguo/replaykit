# ReplayKit

ReplayKit turns a failed voice-agent call into a regression test. It finds the moment the agent told a caller something the API contradicted. It pins the API's exact response as a replayable fixture, serves that response from a mock webhook, and checks whether an updated agent still makes the mistake.

The product context and rules are in [CONTEXT.md](CONTEXT.md).

## MVP: one test, end to end

The MVP guarantees one complete test. A caller asks to book an appointment, and the booking API returns HTTP 200 with `{"success": false, "message": "Slot unavailable"}`. The agent tells the caller the appointment is confirmed.

| Step | Part | What is checked |
| --- | --- | --- |
| 1. Load call log | input | The log parses into the normalized call-log format |
| 2. Detect failure and generate test | Extractor (Claude) | A `false_success_claim` is found with evidence, and a schema-valid fixture is written |
| 3. Serve recorded response over HTTP | Mock webhook (Cursor) | `POST /book-appointment` returns status 200 and a body equal to the recording |
| 4. Original agent reproduces the failure | Replay engine (Cursor) | The original agent fails the test's expectations |
| 5. Fixed agent passes | Replay engine (Cursor) | A corrected agent passes every expectation, with no regressions |

Every step reports the expected and actual values from the run. Nothing is precomputed.

## Run it

```bash
npm install
```

**Web app.** This builds the UI and serves it at http://127.0.0.1:4321. The Overview page runs the end-to-end test on load.

```bash
npm run web
```

**Command line.** This prints each step and writes `reports/e2e/fixture.json`, `report.json`, and `report.html`. It exits 0 only if every step passed.

```bash
npm run e2e
```

**All checks.** This runs typecheck and the full test suite, including the golden-path test.

```bash
npm run check
```

## How the parts connect

```
examples/call-logs/*.json
  └─ src/extractor/     Claude   detect failures with evidence, generate fixture
       └─ src/shared/   Claude   fixture schema, the contract between the parts
            ├─ src/replay/mock-server.ts   Cursor   serve recorded responses over HTTP
            └─ src/replay/pipeline.ts      Cursor   run agents, evaluate expectations, report
src/e2e/golden-path.ts   runs all of the above as one test
src/web/server.ts        local API over the same code
frontend/                React UI: Overview, Calls, Issues, Regression tests, Import
```

## Web app

- **Overview:** the end-to-end test, live. Each step links to its detail.
- **Calls:** every call log, with a root-cause strip and a trace. The trace shows each tool call's status, flags HTTP 200 with an app-level error, highlights the failing JSON field, and marks the agent's false claim.
- **Issues:** all findings across calls.
- **Regression tests:** each fixture's definition, plus a replay that checks recorded responses are returned verbatim, with an expectation matrix.
- **Import call log:** paste a log to analyze it.

## Honest limits

- **Synthetic data.** All call logs are hand-written and labeled synthetic. No real Bland call has been processed. There is no Bland log adapter yet.
- **Stand-in agents.** The fixed agent is a deterministic stand-in. Running a production agent against a fixture needs a live runner, which is not built, and no paid model calls are made.
- **One guaranteed test.** Other examples work in the UI. The refund case shows a known gap: the replay engine's stand-in agent does not call a required tool when other calls are recorded, documented in [INTEGRATION.md](INTEGRATION.md).

## More detail

- [docs/FIXTURE_FORMAT.md](docs/FIXTURE_FORMAT.md): the shared fixture contract.
- [docs/EXTRACTOR.md](docs/EXTRACTOR.md): detectors, design decisions, and limitations.
- [docs/REPLAY_ENGINE.md](docs/REPLAY_ENGINE.md): replay, evaluation, and reports.
- [FRONTEND.md](FRONTEND.md): UI stack and review notes.
- [INTEGRATION.md](INTEGRATION.md): how the branches were merged.
