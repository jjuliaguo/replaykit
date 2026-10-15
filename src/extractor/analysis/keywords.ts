/**
 * Derives topic keywords for a tool from its name and description, so a
 * claim like "your appointment is confirmed" can be tied to
 * `book_appointment` without hardcoding either word.
 */
import type { ToolDefinition } from "../../shared/types.js";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "user", "users", "returns", "return", "whether",
  "tool", "call", "calls", "api", "get", "set", "new", "data", "info", "information", "given", "using", "use",
  "used", "will", "can", "may", "must", "should", "your", "their", "them", "they", "when", "which", "also", "not",
  "succeeded", "success", "fails", "failed",
]);

export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suffix of ["ments", "ment", "ings", "ing", "ions", "ion", "ed", "es", "s"]) {
    if (suffix === "s" && w.endsWith("ss")) continue; // address, access, process
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function splitIdentifier(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}

export function toolKeywords(toolName: string, definition?: ToolDefinition): string[] {
  const words = [...splitIdentifier(toolName)];
  if (definition?.description) words.push(...splitIdentifier(definition.description));
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(stem))];
}

/** Keyword stems that appear in `text`. */
export function mentionedKeywords(text: string, keywordStems: string[]): string[] {
  const tokens = new Set(splitIdentifier(text).map(stem));
  return keywordStems.filter((k) => tokens.has(k));
}
