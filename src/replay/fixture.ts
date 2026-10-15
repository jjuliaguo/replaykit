/**
 * Fixture loading and validation.
 *
 * The shared Zod schema is the single source of truth for what a fixture must
 * contain. Everything downstream (matcher, server, runner, assertions) receives
 * an already-validated `ReplayFixture`, so a malformed fixture fails here with a
 * readable message instead of surfacing as a confusing runtime error later.
 */
import { readFile } from "node:fs/promises";
import { ReplayFixtureSchema, type ReplayFixture } from "../shared/types.js";

export class FixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureError";
  }
}

/** Validate already-parsed JSON against the shared schema. */
export function parseFixture(data: unknown, sourceLabel = "fixture"): ReplayFixture {
  const result = ReplayFixtureSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new FixtureError(`${sourceLabel} failed schema validation:\n${details}`);
  }
  return result.data;
}

/** Read a fixture file from disk and validate it. */
export async function loadFixture(filePath: string): Promise<ReplayFixture> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new FixtureError(`cannot read fixture ${filePath}: ${(error as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new FixtureError(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
  return parseFixture(data, filePath);
}
