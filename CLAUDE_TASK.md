# Claude Task

Read `CONTEXT.md` at the repository root first. This is the primary source of truth for ReplayKit. Treat `docs/PROJECT_CONTEXT.md` as secondary, older documentation.

You are responsible for the extraction and test-generation side of ReplayKit.

**Goal:** Turn failed AI-agent interactions into reusable regression tests.

## What to do

1. Design a flexible, general-purpose fixture format that both the extractor and replay engine can use.
2. Implement and commit the shared fixture format first. Make it easy for Cursor to consume.
3. Build a system that reads agent conversations, tool calls, and tool responses.
4. Identify potential failures based on evidence from those interactions.
5. Generate reusable regression tests automatically.
6. Test the system with realistic, clearly labeled synthetic examples.

Start with an AI agent falsely confirming an appointment after its booking API reports failure, but do not hardcode appointment booking into the product.

## Creative freedom

You choose the architecture, libraries, algorithms, and implementation details. Think critically about what would make ReplayKit genuinely useful to developers.

Prioritize accuracy, generalizability, latency, and cost. Avoid false positives and invented evidence. Explain important tradeoffs.

## Expected result

A working extractor that turns an example failed interaction into a validated regression-test fixture.

Include automated tests, usage instructions, a summary of design decisions, and known limitations.

Work autonomously, commit your changes on the `claude` branch, and leave a clear handoff. Do not deploy, push, or make paid API calls without approval. Do not modify Cursor-owned replay-engine code.
