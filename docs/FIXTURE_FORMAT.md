# ReplayKit fixture format v1.0 (shared contract)

Owner: Claude (extractor side). Consumer: Cursor (replay engine).

- TypeScript + Zod: `src/shared/types.ts` (re-exports `json.ts`, `call-log.ts`, `fixture.ts`). Use `parseFixture(json)` to load.
- JSON Schema (language-neutral): `schemas/fixture.schema.json`, `schemas/call-log.schema.json`. Regenerate with `npm run schema`.
- Example: `fixtures/booking-unavailable.json` (SYNTHETIC).

## Shape

| Field | Meaning |
| --- | --- |
| `scenario.messages` | Conversation to start the replayed agent with (system prompt + user turns before the first tool call). |
| `tools` | Tool definitions as the agent saw them. Nothing is tool-specific in the schema. |
| `replay.interactions[]` | Recorded tool responses to return verbatim. Matched by `sequence` (Nth call to a tool gets the Nth recording) or `arguments`. May carry `error` (timeout/network) instead of `response`. |
| `replay.onUnmatchedCall` | `error_response` (default) or `fail_run`. |
| `original.events` | The unmodified original call, for audit and display. |
| `failures[]` | What went wrong, with `confidence` and `evidence` (indexes into `original.events`). |
| `expectations[]` | What a correct agent must do. Kinds: `tool_called`, `no_success_claim`, `acknowledges_failure`, `consistent_with_tool_result`, `rubric`. Pass/fail is never stored. |

## Replay contract
1. Start the agent with `scenario.messages` and `tools`.
2. On each tool call, return the matching interaction's `response.status` + `response.body` byte-for-byte as JSON, or simulate its `error`.
3. Unmatched calls follow `onUnmatchedCall`.
4. Evaluate the actual run against `expectations`.

## Clarifications (no schema change)

These pin down behavior the schema alone leaves open. The JSON Schemas are unchanged.

- **Multi-turn replays.** `scenario.userTurns` lists every user turn from the original call, in order, and always starts with the user messages already in `scenario.messages`. If `scenario.messages` contains `k` user messages, feed `userTurns[k]`, `userTurns[k+1]`, and so on as follow-up turns after each agent reply.
- **`scenario.messages` always ends with a user message.** The extractor guarantees this, and so does a test.
- **`consistent_with_tool_result.path`** is a dot path relative to the tool's response body. For example, `reservation_id` means `response.body.reservation_id`.
- **Tools the original agent never called.** For a `unverified_success_claim`, the required tool has no recorded interaction. A replayed call to it is unmatched and follows `onUnmatchedCall`. With the default `error_response`, the agent gets an error. The expectation that matters is `tool_called`.
- **Evidence and audit.** `failures[].evidence[].eventIndex` and `replay.interactions[].sourceEventIndex` index into `original.events`.
- **`metadata` keys the extractor may set:**
  - `inferredTools` names tools whose definitions were not in the log. Each was given a minimal definition built from its name and the argument types the agent actually sent.
  - `redactedHeaders` lists request and response header paths whose values were replaced with `[REDACTED]` because they carry credentials. Response bodies are never redacted.
  - `skippedInteractions` lists tool calls with no usable result, which cannot be replayed.
  - `notes` copies the source log's notes.

## Compatibility checks

`src/extractor/tests/contract.test.ts` verifies the following:

- Every generated fixture validates against `schemas/fixture.schema.json` with Ajv, independently of Zod.
- The JSON Schemas match the Zod source.
- A reference replay that follows the matching rules above returns exactly the original tool results for each fixture's own source trace.

Breaking changes bump `schemaVersion`. Additive optional fields do not.
