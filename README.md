# ReplayKit

ReplayKit is a student-built prototype that turns failed voice-agent calls into regression tests.

**[Try the live demo](https://replaykit.vercel.app)**

## The problem

A voice agent can understand a customer and sound completely normal, but still cause an expensive mistake when an external tool fails. For example, a calendar API might return HTTP `200` with `{ "success": false }`, while the agent tells the customer their appointment is confirmed.

Bland already has tools for building, testing, monitoring, and debugging agents, including Norm, Evals, Alerts, Triage, and Norm Fix. ReplayKit explores a more specific question:

> Can we recreate the exact conditions that caused a failure and prove that a future fix still works?

Without replay, an engineer may need to manually rebuild the conversation, imitate the API failure, and hope the agent follows the same path. ReplayKit saves the original tool response and turns it into a test that can be run again after a prompt, model, agent, or Pathway change.

The goal is not to recover one failed call. It is to keep the next 10,000 calls from failing in the same way.

## What is included

- A log extractor that finds contradictions between tool results and agent responses
- Replay fixtures that preserve the original conversation and tool response
- A mock webhook and replay engine
- Checks for false confirmations, missing tool calls, timeouts, and incorrect result values
- A React interface for reviewing calls, issues, and replay results
- JSON and HTML reports

The extractor and replay engine were developed separately and communicate through a shared, versioned fixture format. The original Claude and Cursor implementations are preserved in the repository history. More detail is available in [INTEGRATION.md](INTEGRATION.md).

## Run locally

Requires Node.js 22 or newer.

```bash
git clone https://github.com/jjuliaguo/replaykit.git
cd replaykit
npm install
npm run web
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321).

```bash
npm run check   # type-check and test
npm run e2e     # run the full example
npm run demo    # replay-engine demo
```

## Important limitations

This is an early prototype, not an official Bland product. All examples are synthetic and no real customer calls are included.

ReplayKit can read Bland-like call data, but it has not been tested on a representative set of real Bland logs. It also uses deterministic stand-in agents instead of running a real Bland Pathway. The current replay covers tool responses and errors, not full voice timing, interruptions, or external side effects.

Do not paste sensitive production data into the public demo. Credential-like headers are redacted, but full PII and response-body redaction are not implemented yet.

## Potential Bland integration

The next steps I would want to explore with Bland are:

1. Validate the log reader against a few safely redacted Bland call exports.
2. Import call, Pathway, version, node, and webhook metadata directly from Bland.
3. Let ReplayKit replace a tool endpoint with its deterministic replay webhook during a test.
4. Run a selected Pathway version against the saved failure conditions.
5. Capture the resulting Bland trace and evaluate whether the agent still makes the same mistake.
6. Save successful replays as regression cases that run before future prompt, model, or Pathway releases.

The main integration question is whether a specific Bland Pathway version can be run programmatically with an overridden webhook endpoint or recorded tool response.

## More detail

- [Fixture format](docs/FIXTURE_FORMAT.md)
- [Extractor design](docs/EXTRACTOR.md)
- [Replay engine](docs/REPLAY_ENGINE.md)
- [Deployment guide](DEPLOY.md)
