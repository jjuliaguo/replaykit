import { isJsonObject, type JsonValue } from "../shared/json.js";

/** Read a dotted path such as `response.body.success` from an arbitrary JSON value. */
export function getByPath(value: unknown, path: string): JsonValue | undefined {
  if (!path) return value as JsonValue;
  const parts = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isJsonObject(current as JsonValue)) return undefined;
    current = (current as Record<string, JsonValue>)[part];
  }
  return current as JsonValue;
}

export function pickKeys(value: JsonValue, keys: string[]): JsonValue {
  if (!isJsonObject(value)) return value;
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    if (key in value) out[key] = value[key] as JsonValue;
  }
  return out;
}

export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
