/**
 * Compatibility with the replay side, checked without depending on any
 * replay-engine code (Cursor owns that):
 *
 * 1. Every generated fixture validates against schemas/fixture.schema.json
 *    using an independent JSON Schema validator (Ajv), not just Zod. This is
 *    what a consumer in any language would check.
 * 2. The committed JSON Schemas match the Zod source, so the two never drift.
 * 3. A minimal reference replay that follows docs/FIXTURE_FORMAT.md exactly:
 *    re-issuing the ORIGINAL agent's tool calls through the fixture's
 *    matching rules must return exactly the original tool results. If a
 *    fixture cannot reproduce its own source trace, it cannot be trusted to
 *    test an updated agent.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deepStrictEqual } from "node:assert";
import { CallLogSchema, parseFixture, ReplayFixtureSchema, type ReplayFixture, type ReplayInteraction } from "../../shared/types.js";

const DIR = "fixtures/generated";
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const load = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));

describe("JSON Schema compatibility (Ajv, independent of Zod)", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync("schemas/fixture.schema.json", "utf8")));

  it.each(files)("%s validates against schemas/fixture.schema.json", (file) => {
    const ok = validate(load(file));
    expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it("also validates the hand-written sample fixture", () => {
    expect(validate(JSON.parse(readFileSync("fixtures/booking-unavailable.json", "utf8")))).toBe(true);
  });

  it("rejects a fixture missing its replay section", () => {
    const broken = load(files[0]!);
    delete broken.replay;
    expect(validate(broken)).toBe(false);
  });
});

describe("JSON Schema files are in sync with the Zod source", () => {
  it.each([
    ["schemas/fixture.schema.json", ReplayFixtureSchema],
    ["schemas/call-log.schema.json", CallLogSchema],
  ] as const)("%s (regenerate with npm run schema)", (file, schema) => {
    const committed = JSON.parse(readFileSync(file, "utf8"));
    expect(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })).toEqual(JSON.parse(JSON.stringify(committed)));
  });
});

/** Reference implementation of the matching rules in docs/FIXTURE_FORMAT.md. */
function referenceReplay(fixture: ReplayFixture) {
  const used = new Set<string>();
  return (toolName: string, args: unknown): ReplayInteraction | "unmatched" => {
    const candidates = fixture.replay.interactions.filter((i) => i.toolName === toolName && !used.has(i.id));
    const match = candidates.find((i) => {
      if (i.match.strategy === "sequence") return true;
      const keys = i.match.argumentKeys ?? [];
      const rec = i.recordedArguments as Record<string, unknown>;
      const live = args as Record<string, unknown>;
      return keys.every((k) => JSON.stringify(rec?.[k]) === JSON.stringify(live?.[k]));
    });
    if (!match) return "unmatched";
    used.add(match.id);
    return match;
  };
}

describe("reference replay reproduces each fixture's source trace", () => {
  it.each(files)("%s", (file) => {
    const fixture = parseFixture(load(file));
    const replay = referenceReplay(fixture);
    const events = fixture.original.events;
    for (const event of events) {
      if (event.type !== "tool_call") continue;
      const original = events.find((e) => e.type === "tool_result" && e.callId === event.callId);
      const got = replay(event.toolName, event.arguments);
      if (!original || original.type !== "tool_result" || (!original.response && !original.error)) {
        expect(got).toBe("unmatched");
        continue;
      }
      expect(got).not.toBe("unmatched");
      const interaction = got as ReplayInteraction;
      deepStrictEqual(interaction.response, original.response);
      deepStrictEqual(interaction.error, original.error);
    }
    // A tool the original agent never called (e.g. a required tool it skipped) has no recording.
    for (const e of fixture.expectations) {
      if (e.kind !== "tool_called") continue;
      const recorded = fixture.replay.interactions.some((i) => i.toolName === e.toolName);
      const originallyCalled = events.some((ev) => ev.type === "tool_call" && ev.toolName === e.toolName);
      expect(recorded).toBe(originallyCalled);
    }
  });

  it("the agent's starting conversation ends with a user message", () => {
    for (const file of files) {
      const f = parseFixture(load(file));
      expect(f.scenario.messages.at(-1)?.role, file).toBe("user");
    }
  });
});
