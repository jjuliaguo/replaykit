# ReplayKit

ReplayKit is a developer tool that converts failed voice-agent calls into reproducible regression tests. It captures a real Bland agent execution, extracts the external tool interaction into a replay fixture, reproduces the recorded tool response through a deterministic mock webhook server, runs an updated agent against the same conditions, and reports whether the agent's behavior improved.

**Start here:** [CONTEXT.md](CONTEXT.md) is the project context: the problem, the first test case, the rules every implementation must follow, and the tech stack guidance. The original brief for the replay-engine slice is in [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md).

## Integrated build

This build combines Claude's extractor and Cursor's replay engine, with a local web app. See [INTEGRATION.md](INTEGRATION.md). On the `frontend` branch the web app is a React + Vite + Tailwind UI; see [FRONTEND.md](FRONTEND.md).

```bash
npm install
```

```bash
npm run web
```

Then open http://127.0.0.1:4321.

## Repository layout

This repository holds two independent implementations of the same brief, built with two different AI coding tools, so they can be compared side by side.

| Branch   | Built with  | Notes                                   |
| -------- | ----------- | --------------------------------------- |
| `main`   | n/a         | The brief and this README only.         |
| `claude` | Claude Code | Claude's implementation.                |
| `cursor` | Cursor      | Cursor's implementation.                |

Each tool works only on its own branch. On `cursor`, the replay engine, evaluator, and HTML report live in `src/replay/`. They consume the shared fixture schema in `src/shared/` (see `docs/FIXTURE_FORMAT.md` and `docs/REPLAY_ENGINE.md`).

```bash
npm install
npm test
npm run demo
```

Open `reports/index.html`. The demo is offline and uses labeled synthetic fixtures only.

To compare the two branches:

```bash
git diff main claude --stat
```

```bash
git diff claude cursor --stat
```

## Requirements common to both implementations

- TypeScript and Node.js
- Zod for fixture validation
- OpenAI API for optional failure analysis and semantic evaluation
- No database for the MVP
- Recorded webhook responses are preserved without LLM modification
- Execution traces and regression results are never fabricated
- Successful HTTP responses that carry application-level failures are supported, not only HTTP 4xx/5xx
- Small, modular, testable code

## On this branch (`claude`)

The extractor and the shared fixture format. Start with [HANDOFF.md](HANDOFF.md), then [docs/EXTRACTOR.md](docs/EXTRACTOR.md) and [docs/FIXTURE_FORMAT.md](docs/FIXTURE_FORMAT.md).

```bash
npm install
```

```bash
npm run check
```

```bash
npm run extract -- examples/call-logs --dry-run
```
