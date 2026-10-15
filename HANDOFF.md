# Handoff: Claude branch (extraction and test generation)

## Status

Done and committed on `claude`, not pushed:

- **Shared fixture schema v1.0**, committed first in `1a932b5`. Zod source in `src/shared/`, JSON Schemas in `schemas/`, contract in [docs/FIXTURE_FORMAT.md](docs/FIXTURE_FORMAT.md).
- **Extractor**: adapters (native CallLog, OpenAI chat), generic tool-outcome classifier, success-claim analysis, four detectors, fixture generator, CLI. Details, design decisions, and limitations in [docs/EXTRACTOR.md](docs/EXTRACTOR.md).
- **Synthetic examples**: eight logs in `examples/call-logs/`, five failures and three clean controls. Generated fixtures in `fixtures/generated/`.
- **Tests**: Vitest, covering the schema, outcome classifier, claim analysis, every detector including negative cases, generator, end-to-end examples, CLI, and a drift guard on committed fixtures.
- **Review pass**: a critical review against CONTEXT.md fixed 15 weaknesses, listed in [docs/EXTRACTOR.md](docs/EXTRACTOR.md#review-against-contextmd), with hard-case tests in `src/extractor/tests/hard-cases.test.ts`. Contract tests in `src/extractor/tests/contract.test.ts` validate every fixture with Ajv against the JSON Schema and replay each fixture's own trace through a reference implementation of the matching rules.

Verify with:

```bash
npm install
```

```bash
npm run check
```

## For Cursor (replay engine)

- Load fixtures with `parseFixture()` from `src/shared/types.ts`, or validate against `schemas/fixture.schema.json`.
- Follow the replay contract in `docs/FIXTURE_FORMAT.md`: start from `scenario.messages`, return `replay.interactions[].response` verbatim (or simulate `error`), evaluate against `expectations`.
- `fixtures/generated/` has five real extractor outputs covering every expectation kind except `rubric`.
- Do not edit `src/shared/` or `src/extractor/` on the cursor branch. Propose schema changes instead; a breaking change bumps `schemaVersion`.
- The review pass did **not** change the schema. `src/shared/` and `schemas/` are identical to `1a932b5`. Only `docs/FIXTURE_FORMAT.md` gained a "Clarifications" section covering multi-turn `userTurns`, `path` semantics, unmatched required tools, and metadata keys. Cursor's copy of that doc predates it.
- Fixtures may carry `metadata.inferredTools` and `metadata.redactedHeaders`. Redacted headers read `[REDACTED]`. Bodies are always verbatim.

## Not done, and why

- **No Bland adapter.** No verified Bland log sample was available, and the rules forbid inventing an integration.
- **No LLM pass.** Not needed for the examples, and paid API calls need approval. The pipeline has room for an optional classifier on medium-confidence findings.
- **Accuracy on real calls is unmeasured.** Everything is tested on synthetic data.

## Suggested next steps

1. Get a real Bland call log, write its adapter, and run the extractor on it.
2. Collect a small labeled set of real failed and successful calls to measure precision and recall.
3. Agree with Cursor on how `rubric` and `consistent_with_tool_result` expectations are evaluated.
