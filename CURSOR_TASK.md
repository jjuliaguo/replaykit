# Cursor Task

Read `CONTEXT.md` at the repository root first. This is the primary source of truth for ReplayKit. Treat `docs/PROJECT_CONTEXT.md` as secondary, older documentation.

You are responsible for the replay, evaluation, and reporting side of ReplayKit.

**Goal:** Recreate failed AI-agent interactions and determine whether an updated agent handles them correctly.

## What to do

1. Inspect the shared fixture format produced by Claude. Use it rather than creating an incompatible format.
2. Build a general-purpose system that recreates recorded external tool conditions.
3. Build a way to run an agent against those conditions.
4. Evaluate whether the agent handles the situation correctly.
5. Support comparing agent versions where practical.
6. Present the results in a clear, polished developer-facing report.

Start with a failed appointment-booking API response, but design for arbitrary tools, APIs, and agent workflows.

## Creative freedom

You choose the architecture, libraries, evaluation methods, and user experience. Consider what would make developers prefer ReplayKit over manually rerunning their agents.

Prioritize faithful replay, explainable evaluations, low latency, cost efficiency, and a useful end-to-end experience.

## Expected result

A working prototype that loads a fixture, runs a replay, evaluates the actual behavior, and produces a report.

Include automated tests, an offline demonstration, usage instructions, design decisions, and known limitations.

If Claude's fixture schema is not available yet, inspect the repository and work on independent components without inventing a competing schema. Integrate only after the shared format is available.

Work autonomously, commit your changes on the `cursor` branch, and leave a clear handoff. Do not deploy, push, or make paid API calls without approval. Do not modify Claude-owned extractor code.
