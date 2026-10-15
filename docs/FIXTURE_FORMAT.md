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

Breaking changes bump `schemaVersion`. Additive optional fields do not.
