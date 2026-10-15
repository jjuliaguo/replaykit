/**
 * Decides whether an incoming HTTP request corresponds to the recorded tool
 * invocation in a fixture.
 *
 * Pure function, no I/O: the server feeds it a normalized request and acts on
 * the result. Method and path must always match. Body matching is opt-in via
 * `tool.match.bodyFields`, because an updated agent may legitimately send
 * slightly different arguments (a different name spelling, a reformatted
 * time) and the point of replay is to reproduce the external response for the
 * same logical call, not to pin every byte of the request.
 */
import type { JsonValue, ReplayFixture } from "../shared/types.js";

export interface IncomingRequest {
  method: string;
  path: string;
  body: JsonValue | undefined;
}

export type MatchResult =
  | { matched: true; toolName: string }
  | { matched: false; reason: string };

export function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON values (key order does not matter). */
export function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** Strip query string and hash, and a trailing slash (except for "/"). */
export function normalizePath(path: string): string {
  const end = path.search(/[?#]/);
  let clean = end === -1 ? path : path.slice(0, end);
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  return clean;
}

export function matchRequest(fixture: ReplayFixture, req: IncomingRequest): MatchResult {
  const recorded = fixture.tool.request;
  const method = req.method.toUpperCase();
  if (method !== recorded.method) {
    return { matched: false, reason: `method ${method} does not match recorded ${recorded.method}` };
  }
  const path = normalizePath(req.path);
  const recordedPath = normalizePath(recorded.path);
  if (path !== recordedPath) {
    return { matched: false, reason: `path ${path} does not match recorded ${recordedPath}` };
  }
  const fields = fixture.tool.match?.bodyFields ?? [];
  if (fields.length > 0) {
    if (!isJsonObject(recorded.body) || !isJsonObject(req.body)) {
      return { matched: false, reason: "bodyFields matching requires a JSON object body on both sides" };
    }
    for (const field of fields) {
      if (!deepEqual(req.body[field], recorded.body[field])) {
        return { matched: false, reason: `body field "${field}" differs from the recording` };
      }
    }
  }
  return { matched: true, toolName: fixture.tool.name };
}
