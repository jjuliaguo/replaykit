import { readFileSync } from "node:fs";
import { parseFixture, type ReplayFixture } from "../shared/types.js";

export function loadFixtureFile(path: string): ReplayFixture {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  return parseFixture(parsed, path);
}
