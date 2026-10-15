# ReplayKit — Project Context

## The Problem

AI voice agents sometimes tell customers something happened when it actually didn't.

For example, an AI might confirm an appointment even though the booking system rejected it.

Developers can fix the AI's instructions, but it's difficult to recreate the exact situation to verify that the fix works.

ReplayKit turns failed AI interactions into reusable tests.

## First Example: Failed Appointment Booking

1. Customer: "Book me an appointment for Friday."
2. AI calls the booking API.
3. API returns `{"success": false, "message": "Slot unavailable"}`.
4. AI incorrectly says: "Your appointment is confirmed."
5. ReplayKit saves the API response and replays it against an updated AI to check whether the mistake is fixed.

This is our first test case, not hardcoded product behavior.

## Other Failures ReplayKit Should Eventually Handle

Add more as you want.

- AI claims an action succeeded without calling the required tool.
- AI misinterprets information returned by a tool.
- External API times out or returns an error.
- AI incorrectly handles missing or unexpected data.

## How ReplayKit Works

1. **Capture:** Read an AI call log containing messages, tool calls, and responses.
2. **Extract:** Identify the mistake and generate a JSON test file (fixture).
3. **Replay:** Recreate the original external tool conditions.
4. **Evaluate:** Run an updated agent and check whether it makes the same mistake.
5. **Compare:** Show results in a simple HTML report.

## Important Rules

- Never hardcode appointment booking, tool names, or API responses into the core system.
- Extract actual tool information from call logs.
- Never invent tool calls, failures, or test results.
- A missing tool call is only a failure if the expected workflow required it.
- Use clearly labeled synthetic data until real Bland logs are available.
- External tool responses should be reproducible, even if AI responses vary.
- Build locally first; integrate with Bland AI afterward.

## Tech Stack

Use what is most efficient. Prioritize the main issues when facing problems like this (latency, accuracy), and be able to explain why each choice was prioritized. Also consider: TypeScript, Node.js, Zod, Vitest, OpenAI API, JSON fixtures, and a simple HTML report.
