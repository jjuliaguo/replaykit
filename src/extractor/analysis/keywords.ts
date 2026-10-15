/**
 * Derives topic keywords for a tool from its name and description, so a
 * claim like "your appointment is confirmed" can be tied to
 * `book_appointment` without hardcoding either word.
 *
 * Name keywords are strong evidence that a sentence is about the tool.
 * Description keywords are weaker: "Looks up an order" makes "order" a
 * keyword of lookup_order, but "I've refunded your order" is not about the
 * lookup. Detectors use the strength to set confidence.
 */
import type { ToolDefinition } from "../../shared/types.js";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "user", "users", "returns", "return", "whether",
  "tool", "call", "calls", "api", "get", "set", "new", "data", "info", "information", "given", "using", "use",
  "used", "will", "can", "may", "must", "should", "your", "their", "them", "they", "when", "which", "also", "not",
  "succeeded", "success", "fails", "failed", "caller", "customer", "customers", "request", "requests", "handle",
  "handles", "fetch", "fetches", "run", "runs", "make", "makes", "do", "does", "by", "an", "of", "to", "on", "or",
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

function stems(words: string[]): string[] {
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(stem))];
}

export interface ToolKeywords {
  /** From the tool name: strong topical evidence. */
  name: string[];
  /** From the description only: weaker evidence. */
  description: string[];
}

export function toolKeywords(toolName: string, definition?: ToolDefinition): ToolKeywords {
  const name = stems(splitIdentifier(toolName));
  const description = definition?.description ? stems(splitIdentifier(definition.description)).filter((k) => !name.includes(k)) : [];
  return { name, description };
}

export type Relation = "name" | "description" | "none";

/** How strongly `text` is about the tool: by name keyword, description keyword, or not at all. */
export function relation(text: string, keywords: ToolKeywords): Relation {
  const tokens = new Set(splitIdentifier(text).map(stem));
  if (keywords.name.some((k) => tokens.has(k))) return "name";
  if (keywords.description.some((k) => tokens.has(k))) return "description";
  return "none";
}
