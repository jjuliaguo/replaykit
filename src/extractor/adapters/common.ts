/**
 * Shared helpers for platform adapters: speaker-role mapping, text
 * extraction, and JSON parsing that never throws.
 */
import type { JsonValue } from "../../shared/json.js";

export type Role = "system" | "user" | "assistant";

const USER = /^(user|human|caller|customer|client|callee|lead|prospect|patient|guest|you)$/i;
const ASSISTANT = /^(assistant|agent|ai|bot|robot|model|llm|ai[ _-]?agent|voice[ _-]?agent|receptionist|rep|representative)$/i;
const SYSTEM = /^(system|developer|instructions?)$/i;

/** Map a speaker label to a role, or null if it is not a conversational speaker. */
export function roleOf(label: unknown): Role | null {
  if (typeof label !== "string") return null;
  const l = label.trim();
  if (USER.test(l)) return "user";
  if (ASSISTANT.test(l)) return "assistant";
  if (SYSTEM.test(l)) return "system";
  return null;
}

/** Plain text from a string, a {text} object, or an array of content parts. */
export function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => (typeof p === "string" ? p : p && typeof p === "object" ? ((p as Record<string, unknown>).text ?? (p as Record<string, unknown>).content) : null))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    return parts.length ? parts.join("\n") : null;
  }
  if (content && typeof content === "object") {
    const t = (content as Record<string, unknown>).text;
    if (typeof t === "string") return t;
  }
  return null;
}

export function parseMaybeJson(value: unknown): JsonValue {
  if (typeof value !== "string") return (value ?? null) as JsonValue;
  const s = value.trim();
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s) as JsonValue;
    } catch {
      /* fall through */
    }
  }
  return value;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** First field among `keys` that holds a string. */
export function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length) return v;
  }
  return undefined;
}

/** ISO timestamp if `v` looks like one (or epoch seconds/ms), else undefined. */
export function isoTime(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === "string") {
    const d = new Date(v.includes("T") || v.includes(" ") ? v.replace(" ", "T") : v);
    if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(v)) return d.toISOString();
  }
  return undefined;
}
