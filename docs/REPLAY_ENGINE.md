# Replay engine (Cursor)

Owner: Cursor. Consumes the shared fixture contract in `src/shared/` (owned by Claude). Do not treat this document as a license to change the extractor.

## What it does

ReplayKit's replay side loads a fixture, recreates the **recorded external tool conditions**, runs an agent against those conditions, scores the **actual** reply against `expectations`, and writes JSON + HTML reports.

Appointment booking is only the first fixture. Matching, mocking, evaluation, and reporting take tool names, URLs, payloads, and expectations from data.

## Offline demonstration

```bash
npm install
npm test
npm run demo
```

Then open `reports/index.html`.

The demo never calls OpenAI or Bland. It runs deterministic policy/scripted agents against three **SYNTHETIC** fixtures:

| Fixture | What failed originally | What “honor” should do |
| --- | --- | --- |
| `fixtures/booking-unavailable.json` | HTTP 200 + `success: false`, agent said the appointment was confirmed | Call `book_appointment`, tell the user the slot is unavailable |
| `fixtures/synthetic-payment-declined.json` | HTTP 200 + `ok: false`, agent said payment went through | Same pattern for `capture_payment` |
| `fixtures/synthetic-unverified-cancel.json` | Agent claimed cancellation with **no** tool call | Call `cancel_subscription` because `workflow.requiredTools` says it is required |

## Commands

```bash
npm run replay -- fixtures/booking-unavailable.json --agents original,naive,honor
npm run compare -- fixtures/synthetic-payment-declined.json
npm run server -- fixtures/booking-unavailable.json --port 3000
```

`npm run server` mounts routes from the fixture (for the booking sample: `POST /book-appointment` and `POST /tools/book_appointment`). Check `GET /health` and `GET /log`.

`--live` is parsed and **refused**. Paid model calls need explicit approval, `OPENAI_API_KEY`, and a real runner. See `src/replay/agent/openai-runner.ts`.

## Architecture

```
fixture JSON  →  parseFixture (shared Zod schema)
              →  ReplaySession (match recorded interactions)
              →  agent (scripted | policy | future live)
              →  evaluate expectations
              →  reports/*.json + reports/*.html
```

- **`ReplaySession`**: consumes each recorded interaction at most once. `sequence` = next unused row for that tool name. `arguments` = listed keys equal the recorded keys. Unmatched calls follow `replay.onUnmatchedCall` (`error_response` returns a clearly labeled ReplayKit payload; `fail_run` aborts). Recorded bodies are not rewritten.
- **Mock server**: general HTTP adapter over the same session. Paths come from `tools[].endpoint.url`.
- **Agents**: `original` replays recorded calls then the original assistant text. `naive` / `skip` are buggy stand-ins. `honor` is a deterministic “fixed” stand-in that inspects `success` / `ok` / HTTP status / simulated errors. These exist so the product can be demoed without a billed API.
- **Evaluator**: `tool_called`, `no_success_claim`, `acknowledges_failure`, `consistent_with_tool_result` are deterministic and cite evidence. `rubric` is skipped offline so an LLM cannot be faked.
- **Reports**: pass/fail is computed from the run. Original failures, verbatim tool payloads, transcripts, and version diffs (fail→pass / still failing / regressions) are shown.

## Design choices

- **Faithful replay over clever mocks.** The value of ReplayKit is that the booking API still returns `success: false` with the same body. Latency of the mock is irrelevant next to getting that payload wrong.
- **Explainable scoring before an LLM judge.** Phrase hits, tool-call counts, and JSON-path checks are cheap, stable, and auditable. A rubric judge is optional and never the only gate.
- **Scripted agents for CI.** Live voice agents will vary; CI should not. Policy agents prove the pipeline; they are not a replacement for your production agent.
- **TypeScript + Zod + Vitest.** Matches the shared contract, keeps fixture validation identical on both sides of the repo, and stays local (no database).

## Limitations

- No Bland integration, public HTTPS webhook, or ngrok. Local `127.0.0.1` only.
- No live model runs in this MVP. The OpenAI path is a documented refusal, not a silent stub that invents transcripts.
- Claim detection is heuristic. `claimPhrases` / `signals` on the fixture are the primary evidence; generic English patterns are backup. Unusual wording can false-positive or false-negative.
- `honor` is a stand-in agent. Shipping a prompt fix still requires running **your** agent (or `--live` once approved) against the same fixture.
- Fixtures with no recorded interactions (unverified success) cannot replay a tool **response**; the corrected agent’s call is unmatched unless you later capture a real result.
- `src/shared/` and Claude’s extractor are out of scope. This branch only adds `src/replay/` plus extra synthetic fixtures used by the demo.
