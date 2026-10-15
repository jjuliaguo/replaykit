/**
 * tool_result_misread (fabricated reference): the agent gave the user an
 * identifier ("confirmation number RSV-48213") that appears in no tool
 * result and nothing the user said. A tool that returned `"reservation_id":
 * null` cannot be the source of that number.
 *
 * High confidence when a prior tool result has an id-like field that is
 * null or empty (the agent contradicted the tool); medium when no tool
 * returned such a field (the agent may have hallucinated it outright).
 */
import { isJsonObject, type JsonValue } from "../../shared/json.js";
import type { Evidence } from "../../shared/types.js";
import { findReferences, normalizeReference } from "../analysis/claims.js";
import type { Detector, Finding } from "./context.js";

const ID_KEY = /(^id$|_id$|Id$|^(confirmation|reference|booking|reservation|order|ticket|tracking|case|transaction)(_?(number|code|no))?$)/i;

function findNullIdField(body: JsonValue | undefined, base: string): string | null {
  if (!isJsonObject(body)) return null;
  for (const [key, value] of Object.entries(body)) {
    const path = `${base}.${key}`;
    if (ID_KEY.test(key) && (value === null || value === "")) return path;
    if (isJsonObject(value)) {
      const inner = findNullIdField(value, path);
      if (inner) return inner;
    }
  }
  return null;
}

export const detectFabricatedReference: Detector = (ctx) => {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const message of ctx.assistantMessages) {
    const refs = findReferences(message.event.content);
    if (refs.length === 0) continue;
    // Legitimate sources for an identifier: tool results, the user, and the
    // system prompt. Compared without punctuation or spaces, so "BK-2291",
    // "bk2291", and a transcribed "B K 2 2 9 1" are the same reference.
    const priorText = normalizeReference(
      ctx.log.events
        .slice(0, message.index)
        .filter((e) => e.type === "tool_result" || (e.type === "message" && (e.role === "user" || e.role === "system")))
        .map((e) => JSON.stringify(e))
        .join(" "),
    );
    const invented = refs.filter((r) => !priorText.includes(normalizeReference(r.value)) && !reported.has(normalizeReference(r.value)));
    if (invented.length === 0) continue;
    for (const r of invented) reported.add(normalizeReference(r.value));

    // Most recent prior tool result with a null/empty id-like field.
    let source: { resultIndex: number; toolName: string; path: string } | null = null;
    for (const i of [...ctx.interactions].reverse()) {
      if (i.resultIndex === null || i.resultIndex > message.index) continue;
      const path = findNullIdField(i.result?.response?.body, "response.body");
      if (path) {
        source = { resultIndex: i.resultIndex, toolName: i.toolName, path };
        break;
      }
    }

    const evidence: Evidence[] = invented.map((r) => ({
      eventIndex: message.index,
      description: `Agent stated reference "${r.value}", which no tool result or user message contains`,
      quote: r.sentence,
    }));
    if (source) {
      evidence.unshift({
        eventIndex: source.resultIndex,
        description: `${source.toolName} returned no identifier`,
        path: source.path,
        quote: "null",
      });
    }
    findings.push({
      type: "tool_result_misread",
      summary: source
        ? `The agent gave the user reference "${invented[0]!.value}", but ${source.toolName} returned ${source.path.replace(/^response\.body\./, "")} = null.`
        : `The agent gave the user reference "${invented[0]!.value}", which does not appear in any tool result.`,
      ...(source ? { toolName: source.toolName } : {}),
      confidence: source ? "high" : "medium",
      detector: "fabricated-reference",
      evidence,
      messageIndex: message.index,
      ...(source ? { resultPath: { path: source.path.replace(/^response\.body\./, ""), expectedValue: null } } : {}),
    });
  }
  return findings;
};
