# ReplayKit: Project Context

ReplayKit is a developer tool that converts failed voice-agent calls into reproducible regression tests.

## Core workflow

1. Capture a real Bland agent execution, including the caller's request, webhook invocation, HTTP response, and agent behavior.
2. Automatically extract the external tool interaction into a structured replay fixture.
3. Reproduce the original tool response through a deterministic mock webhook server.
4. Run an updated agent against the same external conditions.
5. Evaluate whether the agent's behavior improved.

## Example scenario

A caller requests an appointment. Bland invokes `book_appointment`, and the API returns:

```json
{
  "success": false,
  "booking_id": null,
  "message": "That time slot is unavailable."
}
```

An incorrect agent might confirm the appointment anyway.

ReplayKit should preserve the exact tool response, inject it during subsequent tests, and determine whether the updated agent correctly handles the unavailable appointment.

## Technical requirements

- TypeScript and Node.js
- Zod for fixture validation
- OpenAI API for optional failure analysis and semantic evaluation
- No database for the MVP
- Preserve recorded webhook responses without LLM modification
- Never fabricate execution traces or regression results
- Support successful HTTP responses containing application-level failures, not just HTTP 4xx/5xx errors
- Keep the implementation small, modular, and testable

## Target

A polished, functional MVP that can be demonstrated to Bland engineers. Use real Bland execution data where available. If a Bland API or testing capability is unavailable, document the limitation instead of inventing an integration.

## Replay engine task (first slice)

Build the replay and regression engine: a local HTTP server on port 3000 with a POST `/book-appointment` endpoint that loads a fixture, matches requests, returns the exact recorded HTTP status and response body, and logs matched and unexpected requests. Optionally, build a real OpenAI tool-calling agent runner that invokes `book_appointment`, receives the fixture response, and generates an actual reply, supporting two agent configurations and repeated runs. Add deterministic assertions for tool invocation and booking confirmation, and produce a JSON regression report with actual execution results. Never hardcode pass/fail outcomes.

Shared fixture schema: `src/shared/types.ts`. Sample fixture: `fixtures/booking-unavailable.json`. The replay engine owns `src/replay/` and its tests only.

The public HTTPS URL and Bland integration come later. The local implementation must not depend on ngrok or Bland credentials.
