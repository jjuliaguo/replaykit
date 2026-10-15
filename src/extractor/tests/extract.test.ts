import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFixture } from "../../shared/types.js";
import { InputFormatError, toCallLog } from "../adapters/index.js";
import { main } from "../cli.js";
import { extract } from "../extract.js";
import { generateFixture } from "../generate.js";
import { loadExample } from "./helpers.js";

const FIXED = "2026-10-15T00:00:00.000Z";

describe("example logs end to end", () => {
  it.each([
    ["booking-false-confirmation", ["false_success_claim"]],
    ["address-update-http-500", ["false_success_claim"]],
    ["refund-without-tool-call", ["unverified_success_claim"]],
    ["order-status-timeout", ["unhandled_tool_error"]],
    ["reservation-openai-format", ["false_success_claim", "tool_result_misread"]],
    ["booking-handled-correctly", []],
    ["booking-retry-succeeds", []],
  ] as const)("%s -> %j", (name, expected) => {
    const r = extract(loadExample(name), { extractedAt: FIXED });
    expect(r.findings.map((f) => f.type)).toEqual(expected);
    if (expected.length === 0) expect(r.fixture).toBeNull();
    else expect(() => parseFixture(r.fixture)).not.toThrow();
  });
});

describe("generated fixture for the booking example", () => {
  const raw = loadExample("booking-false-confirmation");
  const { fixture, callLog } = extract(raw, { extractedAt: FIXED });

  it("labels synthetic data and records provenance", () => {
    expect(fixture!.name.startsWith("SYNTHETIC: ")).toBe(true);
    expect(fixture!.source).toMatchObject({ kind: "synthetic", callLogId: callLog.id, extractedAt: FIXED, capturedAt: "2026-10-15T14:02:11Z" });
  });

  it("copies the recorded response verbatim", () => {
    const original = callLog.events[3];
    expect(original?.type).toBe("tool_result");
    expect(fixture!.replay.interactions).toHaveLength(1);
    expect(fixture!.replay.interactions[0]!.response).toEqual(original?.type === "tool_result" ? original.response : undefined);
    expect(fixture!.replay.interactions[0]).toMatchObject({ toolName: "book_appointment", match: { strategy: "sequence" }, sourceEventIndex: 3 });
  });

  it("starts the replay from the conversation before the first tool call", () => {
    expect(fixture!.scenario.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(fixture!.original.finalAgentMessage).toContain("confirmed");
  });

  it("produces expectations tied to the evidence", () => {
    expect(fixture!.expectations.map((e) => e.kind)).toEqual(["tool_called", "no_success_claim", "acknowledges_failure"]);
    const ack = fixture!.expectations.find((e) => e.kind === "acknowledges_failure");
    expect(ack?.kind === "acknowledges_failure" && ack.signals).toEqual(["Slot unavailable"]);
  });

  it("is deterministic for a fixed timestamp", () => {
    expect(extract(raw, { extractedAt: FIXED }).fixture).toEqual(fixture);
  });

  it("does not mutate the input or share references with it", () => {
    const before = JSON.stringify(raw);
    const r = extract(raw, { extractedAt: FIXED });
    (r.fixture!.replay.interactions[0]!.response!.body as Record<string, unknown>).success = true;
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("guards", () => {
  it("refuses to generate a fixture with no findings", () => {
    const callLog = toCallLog(loadExample("booking-handled-correctly"));
    expect(() => generateFixture(callLog, [])).toThrow(/at least one detected failure/);
  });

  it("can keep only high-confidence findings", () => {
    const r = extract(loadExample("order-status-timeout"), { minConfidence: "high" });
    expect(r.findings).toEqual([]);
    expect(r.fixture).toBeNull();
  });

  it("rejects unknown and invalid input formats", () => {
    expect(() => toCallLog({ foo: 1 })).toThrow(InputFormatError);
    expect(() => toCallLog({ schemaVersion: "1.0", events: [] })).toThrow(/not a valid calllog log/);
  });

  it("converts OpenAI chat logs, parsing JSON tool results", () => {
    const callLog = toCallLog(loadExample("reservation-openai-format"));
    expect(callLog.provider).toBe("openai-chat");
    const res = callLog.events.find((e) => e.type === "tool_result");
    expect(res?.type === "tool_result" && res.toolName).toBe("create_reservation");
    expect(res?.type === "tool_result" && res.response?.body).toMatchObject({ status: "failed", reservation_id: null });
  });
});

describe("committed fixtures in fixtures/generated", () => {
  it("match what the extractor produces today (regenerate with npm run fixtures)", async () => {
    const files = (await readdir("fixtures/generated")).filter((f) => f.endsWith(".json")).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const committed = JSON.parse(await readFile(path.join("fixtures/generated", file), "utf8"));
      const fresh = extract(loadExample(committed.source.callLogId.replace(/^synthetic-/, "")), { extractedAt: committed.source.extractedAt });
      expect(fresh.fixture, file).toEqual(committed);
    }
  });
});

describe("CLI", () => {
  it("writes one valid fixture per failing log and nothing for clean logs", async () => {
    const out = await mkdtemp(path.join(os.tmpdir(), "replaykit-extract-"));
    const code = await main(["examples/call-logs", "--out", out, "--extracted-at", FIXED]);
    expect(code).toBe(0);
    const files = (await readdir(out)).sort();
    expect(files).toEqual([
      "synthetic-address-update-http-500.json",
      "synthetic-booking-false-confirmation.json",
      "synthetic-order-status-timeout.json",
      "synthetic-refund-without-tool-call.json",
      "synthetic-reservation-openai-format.json",
    ]);
    for (const f of files) parseFixture(JSON.parse(await readFile(path.join(out, f), "utf8")), f);
  });

  it("returns 1 for bad usage or unreadable input", async () => {
    expect(await main([])).toBe(1);
    expect(await main(["does-not-exist.json"])).toBe(1);
    expect(await main(["examples/call-logs", "--format", "xml"])).toBe(1);
  });
});
