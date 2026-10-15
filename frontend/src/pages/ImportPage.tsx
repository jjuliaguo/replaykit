import { useState } from "react";
import { api, type CallSummary } from "../api";
import { Button, ErrorNote, Label } from "../components/ui";
import { navigate } from "../lib/router";
import type { ImportedLog } from "./CallsPage";

const PLACEHOLDER = `{
  "schemaVersion": "1.0",
  "id": "my-call-123",
  "provider": "bland",
  "kind": "recorded",
  "events": [
    { "type": "message", "role": "user", "content": "..." },
    { "type": "tool_call", "callId": "c1", "toolName": "...", "arguments": {} },
    { "type": "tool_result", "callId": "c1", "response": { "status": 200, "body": {} } },
    { "type": "message", "role": "assistant", "content": "..." }
  ]
}`;

export function ImportPage({ onImport }: { onImport: (name: string, log: ImportedLog) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      setError(`Not valid JSON: ${(e as Error).message}`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.extract({ log: raw });
      const name = `imported:${r.callLog.id}`;
      const summary: CallSummary = {
        name,
        id: r.callLog.id,
        format: Array.isArray((raw as { messages?: unknown }).messages) ? "openai-chat" : "calllog",
        kind: r.callLog.kind,
        notes: "Imported in this browser tab. Not saved to disk.",
        provider: r.callLog.provider,
        startedAt: r.callLog.startedAt,
        events: r.callLog.events.length,
        toolCalls: r.callLog.events.filter((e) => e.type === "tool_call").length,
        tools: [...new Set(r.callLog.events.flatMap((e) => (e.type === "tool_call" ? [e.toolName] : [])))],
        findings: r.findings.map((f) => ({ type: f.type, confidence: f.confidence, summary: f.summary, messageIndex: f.messageIndex, toolName: f.toolName ?? null })),
        fixtureId: r.fixture?.id ?? null,
        error: null,
      };
      onImport(name, { raw, summary });
      navigate(["calls", name], { tab: r.findings.length ? "issues" : "trace" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-3xl">
        <h1 className="text-[16px] font-semibold">Import call log</h1>
        <p className="mt-1 text-[13px] text-muted">
          Paste a call log to trace it and extract a regression test. Accepted formats: the ReplayKit call log (<span className="font-mono">schemas/call-log.schema.json</span>) and
          OpenAI chat transcripts (<span className="font-mono">{"{ messages: [...] }"}</span>). There is no Bland adapter yet; convert Bland logs to the call-log format.
          Imports stay in this browser tab and are analyzed by the local server only.
        </p>
        <div className="mt-4">
          <Label>Call log JSON</Label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="mt-1 h-[420px] w-full resize-y rounded-md border border-line-strong bg-panel p-3 font-mono text-[12.5px] leading-[1.6] placeholder:text-subtle"
          />
        </div>
        {error && <div className="mt-3"><ErrorNote error={error} /></div>}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? "Analyzing…" : "Analyze call"}
          </Button>
          <Button variant="ghost" onClick={() => setText("")} disabled={!text}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
