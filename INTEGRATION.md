# ReplayKit integrated build

This folder joins Claude's extractor and Cursor's replay engine, and adds a local web app over both.

## Where everything came from

| Part | Source | Commit |
| --- | --- | --- |
| Shared fixture schema (`src/shared/`, `schemas/`) | Claude | `1a932b5` |
| Extractor (`src/extractor/`, `examples/`, `fixtures/generated/`) | Claude, branch `claude` | `34d4bd5` |
| Replay engine (`src/replay/`, extra fixtures) | Cursor, branch `cursor` | `4d70ccf` |
| Web app (`src/web/`) | Written for this integration | this branch |

This folder is an independent clone on its own branch, `integrated`. The original repositories, worktrees, and branches were not modified, and push is disabled on every remote here.

## Merge decisions

Only configuration and docs conflicted. No source file conflicted, and `src/shared/` was identical on both sides.

- **`docs/FIXTURE_FORMAT.md`:** Claude's version. Cursor's copy was unchanged from `1a932b5`, so Claude's adds only the clarifications section.
- **`package.json`:** the union of both script sets, on Claude's newer toolchain (TypeScript 7, Vitest 5). The `openai` package was dropped because neither implementation imports it.
- **`tsconfig.json`:** Claude's, which includes `scripts/`, plus `forceConsistentCasingInFileNames`.
- **`.env.example`:** combined. No key is needed for anything here.
- **`package-lock.json`:** regenerated.

## Launch

```bash
npm install
```

```bash
npm run web
```

Then open http://127.0.0.1:4321. Use `npm run web -- --port 4322` if that port is taken.

## Using the app

1. **Call log.** Pick a synthetic example or paste a log, then select **Detect failures**.
2. **Failures and test.** Review the findings, their evidence, and the generated regression test. Select **Replay this test**.
3. **Replay and evaluate.** Pick agents and select **Run replay**. Results show per-agent pass or fail, a baseline-versus-candidate comparison, each expectation with its reason, and Cursor's full HTML report.

Saved fixtures under `fixtures/` and `fixtures/generated/` can also be replayed directly from step 3.

## API

| Route | Does |
| --- | --- |
| `GET /api/examples`, `GET /api/example?name=` | List and read example call logs |
| `GET /api/fixtures`, `GET /api/fixture?ref=` | List and read saved fixtures |
| `GET /api/agents` | The offline agents: `original`, `naive`, `skip`, `honor` |
| `POST /api/extract` | `{ "log": {...} }` or `{ "example": "name" }`. Returns findings and a fixture, or `fixture: null` when nothing failed |
| `POST /api/replay` | `{ "fixture": {...} }` or `{ "fixtureRef": "name" }`, plus `"agents": [...]`. Returns the report and its HTML |

The server binds to 127.0.0.1 only and reads only files from its own example and fixture lists. It makes no network or model calls.

## Verification

- `npm run check` runs typecheck and every test from both implementations plus the web server: 11 files, 146 tests.
- Cursor's engine was run on every fixture Claude's extractor generates:

| Generated fixture | Original agent | Fixed stand-in |
| --- | --- | --- |
| address-update-http-500 | fail | pass |
| booking-false-confirmation | fail | pass |
| order-status-timeout | fail | pass |
| reservation-openai-format | fail | pass |
| refund-without-tool-call | fail | fail |

The app was also driven in a browser end to end, including a check at phone width.

## Known issues found during integration

- **Cursor's fixed stand-in fails the refund fixture.** The `honor` stand-in calls workflow-required tools only when a fixture has no recorded interactions. The refund fixture records a `lookup_order` call, so the stand-in replays that and never calls the required `issue_refund`. Cursor's evaluator correctly fails it. This is a limit of Cursor's demo agent, not of the fixture contract, and it was left unchanged.
- **The stand-in also said "I can confirm that this completed"** in that run, and Cursor's `no_success_claim` check passed it. The check found no claim about `issue_refund` in that sentence. Claude's extractor would count that sentence as a success claim. The two claim detectors differ in wording coverage, and aligning them is follow-up work.
- **Agents are stand-ins.** Running a real agent needs a live runner. Cursor's `--live` path deliberately refuses, and the web app offers no live option.
- **Synthetic data only.** Accuracy on real Bland calls is unmeasured.
