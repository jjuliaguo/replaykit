/**
 * A regression test (fixture) as an engineer needs to read it: what the
 * replayed agent starts with, which external responses are pinned and how
 * calls are matched to them, and what a correct agent must do.
 */
import type { ReplayFixture } from "../api";
import { EXPECTATION_LABEL } from "../lib/format";
import { JsonView } from "./JsonView";
import { Badge, Label, SectionTitle, StatusCode, cx } from "./ui";

function ReplayFlow({ fixture }: { fixture: ReplayFixture }) {
  const node = "rounded-md border border-line-strong bg-panel px-3 py-2 text-[12.5px]";
  const link = <div className="mx-auto h-5 w-px bg-line-strong" />;
  const firstUser = [...fixture.scenario.messages].reverse().find((m) => m.role === "user");
  return (
    <div className="dotgrid rounded-md border border-line px-4 py-5">
      <div className="mx-auto flex max-w-[460px] flex-col">
        <div className={node}>
          <Label>Scenario</Label>
          <div className="mt-0.5 line-clamp-2 text-ink-2">{firstUser?.content ?? "(no user turn)"}</div>
        </div>
        {link}
        <div className={cx(node, "border-ink")}>
          <Label>Agent under test</Label>
          <div className="mt-0.5 text-ink-2">
            {fixture.tools.length} tool{fixture.tools.length === 1 ? "" : "s"} exposed: <span className="font-mono">{fixture.tools.map((t) => t.name).join(", ") || "none"}</span>
          </div>
        </div>
        {link}
        <div className={node}>
          <Label>Replay server</Label>
          {fixture.replay.interactions.length === 0 ? (
            <div className="mt-0.5 text-ink-2">No recorded responses. Every call is unmatched → {fixture.replay.onUnmatchedCall}.</div>
          ) : (
            <div className="mt-1 space-y-1">
              {fixture.replay.interactions.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px]">{i.toolName}</span>
                  <span className="text-subtle">→</span>
                  {i.error ? <Badge tone="err" mono>{i.error.kind}</Badge> : <StatusCode status={i.response?.status} />}
                  <span className="ml-auto font-mono text-[11px] text-subtle">{i.match.strategy}</span>
                </div>
              ))}
              <div className="text-[11.5px] text-muted">Anything else → {fixture.replay.onUnmatchedCall}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FixtureView({ fixture }: { fixture: ReplayFixture }) {
  const meta = fixture.metadata as Record<string, unknown> | undefined;
  const inferred = (meta?.inferredTools as string[] | undefined) ?? [];
  const redacted = (meta?.redactedHeaders as string[] | undefined) ?? [];
  const skipped = (meta?.skippedInteractions as string[] | undefined) ?? [];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <SectionTitle>Replay topology</SectionTitle>
          <ReplayFlow fixture={fixture} />
        </div>
        <div>
          <SectionTitle>Provenance</SectionTitle>
          <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md border border-line bg-panel px-4 py-3 text-[13px]">
            <dt className="text-muted">Fixture id</dt>
            <dd className="font-mono break-all">{fixture.id}</dd>
            <dt className="text-muted">Source</dt>
            <dd>
              <span className="font-mono text-[12px]">{fixture.source.provider}</span>
            </dd>
            <dt className="text-muted">Call log</dt>
            <dd className="font-mono break-all">{fixture.source.callLogId}</dd>
            <dt className="text-muted">Extracted</dt>
            <dd className="font-mono text-[12px]">
              {fixture.source.extractedAt} · {fixture.source.extractor.name}@{fixture.source.extractor.version}
            </dd>
            <dt className="text-muted">Unmatched calls</dt>
            <dd className="font-mono text-[12px]">{fixture.replay.onUnmatchedCall}</dd>
            {fixture.workflow?.requiredTools && (
              <>
                <dt className="text-muted">Required tools</dt>
                <dd className="font-mono text-[12px]">{fixture.workflow.requiredTools.join(", ")}</dd>
              </>
            )}
            {inferred.length > 0 && (
              <>
                <dt className="text-muted">Inferred tools</dt>
                <dd className="text-[12.5px]">
                  <span className="font-mono">{inferred.join(", ")}</span> <span className="text-muted">(not defined in the log; built from observed arguments)</span>
                </dd>
              </>
            )}
            {redacted.length > 0 && (
              <>
                <dt className="text-muted">Redacted</dt>
                <dd className="font-mono text-[12px]">{redacted.length} credential header(s)</dd>
              </>
            )}
            {skipped.length > 0 && (
              <>
                <dt className="text-muted">Not replayable</dt>
                <dd className="text-[12.5px]">{skipped.join("; ")}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div>
        <SectionTitle>Pinned responses · returned verbatim to the agent</SectionTitle>
        {fixture.replay.interactions.length === 0 ? (
          <div className="rounded-md border border-line bg-panel px-4 py-3 text-[13px] text-muted">None recorded. The original agent never called the required tool.</div>
        ) : (
          <div className="space-y-3">
            {fixture.replay.interactions.map((i) => (
              <div key={i.id} className="rounded-md border border-line bg-panel">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2">
                  <span className="font-mono text-[13px] font-semibold">{i.toolName}</span>
                  {i.request?.method && <span className="font-mono text-[11.5px] font-semibold text-muted">{i.request.method}</span>}
                  {i.request?.url && <span className="truncate font-mono text-[12px] text-muted">{i.request.url}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {i.error ? <Badge tone="err" mono>{i.error.kind}</Badge> : <StatusCode status={i.response?.status} />}
                    <Badge mono>
                      {i.match.strategy}
                      {i.match.argumentKeys?.length ? `(${i.match.argumentKeys.join(",")})` : ""}
                    </Badge>
                    <span className="font-mono text-[11px] text-subtle">id {i.id} · src #{i.sourceEventIndex}</span>
                  </span>
                </div>
                <div className="grid gap-3 p-3 lg:grid-cols-2">
                  <div className="min-w-0">
                    <Label>Recorded arguments</Label>
                    <div className="mt-1">
                      <JsonView value={i.recordedArguments} maxHeight={220} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <Label>{i.error ? "Simulated error" : "Response body"}</Label>
                    <div className="mt-1">{i.error ? <JsonView value={i.error} maxHeight={220} /> : <JsonView value={i.response?.body} maxHeight={220} />}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Expectations · what a correct agent must do</SectionTitle>
        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line text-[11px] tracking-wide text-subtle uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Check</th>
                <th className="px-4 py-2 font-medium">Requirement</th>
                <th className="px-4 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fixture.expectations.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[12px]">{EXPECTATION_LABEL[e.kind] ?? e.kind}</div>
                    <div className="font-mono text-[11px] text-subtle">{e.id}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {e.description}
                    {e.kind === "no_success_claim" && e.claimPhrases.length > 0 && <div className="mt-1 font-mono text-[11.5px] text-muted">original claim: {e.claimPhrases.map((p) => `“${p}”`).join(", ")}</div>}
                    {e.kind === "acknowledges_failure" && e.signals.length > 0 && <div className="mt-1 font-mono text-[11.5px] text-muted">signals: {e.signals.map((p) => `“${p}”`).join(", ")}</div>}
                    {e.kind === "consistent_with_tool_result" && (
                      <div className="mt-1 font-mono text-[11.5px] text-muted">
                        body.{e.path} must stay {JSON.stringify(e.expectedValue)}
                      </div>
                    )}
                    {e.kind === "rubric" && <div className="mt-1 text-[12px] text-warn">Needs an LLM judge. Skipped offline.</div>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{e.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
