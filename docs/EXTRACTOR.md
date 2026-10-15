# ReplayKit extractor

The extractor reads a call log, finds evidence that the agent got something wrong, and writes a replay fixture that the replay engine can run against an updated agent. The fixture format is documented in [FIXTURE_FORMAT.md](FIXTURE_FORMAT.md).

```
raw log ──adapter──> CallLog ──detectors──> findings ──generator──> fixture (validated)
```

## Usage

```bash
npm install
```

```bash
npm run extract -- examples/call-logs/booking-false-confirmation.json
```

```bash
npm run extract -- examples/call-logs --out fixtures/generated
```

| Option | Meaning |
| --- | --- |
| `--out <dir>` | Where fixtures are written. Default `fixtures/generated`. |
| `--format <fmt>` | `auto`, `calllog`, or `openai-chat`. Default `auto`. |
| `--min-confidence <lvl>` | `medium` keeps everything; `high` keeps only findings with direct evidence on both sides. |
| `--extracted-at <iso>` | Fixed timestamp for reproducible output. |
| `--dry-run` | Analyze and print, write nothing. |
| `--json` | Machine-readable output. |

Logs with no detected failure produce no fixture. Other commands:

```bash
npm run check
```

```bash
npm run fixtures
```

`npm run check` runs typecheck and tests. `npm run fixtures` regenerates `fixtures/generated/` from the examples; a test fails if the committed fixtures drift from what the extractor produces.

Programmatic use: `extract(rawJson, options)` in `src/extractor/extract.ts` returns `{ callLog, findings, fixture }`.

## Input formats

- **Native CallLog** (`schemas/call-log.schema.json`): messages, tool calls, and tool results with HTTP status, body, and transport errors.
- **OpenAI chat transcript** (`{ messages: [...] }` with `tool_calls` and `role: "tool"`). JSON tool results are parsed. This format has no HTTP status, and none is invented.
- **Bland:** no adapter yet. We have not seen a verified Bland call-log export, so we do not guess its shape. Until a real sample exists, convert Bland logs to the native CallLog format. Adding an adapter is one file in `src/extractor/adapters/`.

## What it detects

| Failure type | Fires when | Confidence |
| --- | --- | --- |
| `false_success_claim` | A tool result explicitly reports failure, and a later reply (before any retry of that tool) claims success. | High when the claim names the tool's topic and the reply does not also acknowledge a problem; otherwise medium. |
| `unverified_success_claim` | The reply claims success and a tool that `workflow.requiredTools` lists was never called. Does nothing without a declared workflow. | High when the claim names the tool's topic. |
| `tool_result_misread` | The reply gives an identifier ("confirmation number RSV-48213") that appears in no tool result and nothing the user said. | High when a prior tool returned that kind of id as null. |
| `unhandled_tool_error` | A tool failed, and the next reply neither acknowledges it nor claims success. | Always medium. |

Each finding carries evidence: event indexes into the original log, the JSON path of the failure signal, and the exact sentence the agent said.

The first example, the false appointment confirmation, is just one input. Nothing in `src/` mentions appointments, bookings, or any tool name. The same detectors catch an HTTP 500 address update, a failed restaurant reservation, a refund that was never executed, and a shipping lookup timeout in the examples.

## Design decisions and tradeoffs

**Deterministic rules, no LLM in the extraction path.** Extraction runs on every logged call, so it has to be cheap, fast, and reproducible. The rule-based pipeline costs nothing, runs in milliseconds, and gives the same output every time, which matters for a regression tool. The cost is recall: unusual phrasings of a success claim will be missed. An LLM classifier could be added later as an optional second pass for medium-confidence or unknown cases, but it should never be the only evidence.

**Precision over recall.** A false positive in a regression tool trains developers to ignore it. So:
- A tool result is classified `success`, `failure`, or `unknown`. A 200 response with no recognizable status field is `unknown`, never assumed to be a failure.
- A success claim must be a declarative sentence with completed-action language. Questions, conditionals ("once it's confirmed"), future intent ("I'll book it"), and negated sentences are excluded.
- A failed tool is not blamed for a vague claim ("You're all set!") if a different tool succeeded before that reply.
- A retry of the same tool closes the window, so "3 PM was taken, I booked 4 PM" after a successful retry is not flagged.
- A missing tool call is only a failure when the workflow declares the tool as required.

**Generic outcome signals.** Failure is read from HTTP status, transport errors, and common field conventions (`success`, `ok`, `status`, `state`, `error`, `errors`), including one level of nesting under `data` or `result`. Application-level failures inside HTTP 200 are treated as failures.

**Topic keywords instead of tool names.** To tie "your appointment is confirmed" to `book_appointment`, keywords are derived from the tool's name and description and lightly stemmed. This is what lets confidence be raised without hardcoding any tool.

**Verbatim responses.** Recorded responses are deep-copied into the fixture and never normalized. A test checks that mutating the fixture does not touch the input.

**Fixtures are validated before they exist.** `generateFixture` runs the shared Zod schema, including cross-checks that every evidence index points into `original.events`. An invalid fixture cannot be written.

**One fixture per call log.** All findings from one call share one replay scenario, so they become one fixture with several expectations, de-duplicated by id.

**Expectations, not verdicts.** The fixture says what a correct agent must do (`tool_called`, `no_success_claim`, `acknowledges_failure`, `consistent_with_tool_result`, `rubric`). It never stores pass or fail; the replay engine computes that from a real run.

## Known limitations

- **English only.** Claim and acknowledgement patterns are English regular expressions.
- **Phrasing recall.** Indirect claims ("we'll see you Friday at 3") are not detected. This is deliberate for precision, but it means some real failures are missed.
- **Mixed sentences.** A sentence that both apologizes and claims success ("Sorry for the wait, you're booked") is treated as not a claim, because it contains negation-like words.
- **Unknown outcomes are skipped.** Tools that signal failure in an unconventional field are classified `unknown` and never produce a `false_success_claim`.
- **`unhandled_tool_error` is weaker evidence.** It relies on the absence of failure language, so it is always medium confidence. Filter it out with `--min-confidence high`.
- **Single-turn replay start.** `scenario.messages` stops at the first tool call. Multi-turn conversations keep all user turns in `scenario.userTurns`, but driving later turns is up to the replay engine.
- **No Bland adapter** until a real Bland log is available.
- **Synthetic data only.** All examples are hand-written and labeled `SYNTHETIC`. Accuracy on real calls is unmeasured.
