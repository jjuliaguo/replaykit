/**
 * Readers for call logs as real platforms produce them. Each reader:
 *   - recognizes its shape with `detect` (cheap, no throwing),
 *   - converts to the normalized CallLog,
 *   - records how it interpreted the log in `notes`, so a reader of the
 *     trace knows what came from where.
 *
 * Rules (from CONTEXT.md): tool calls and tool results are created only
 * where the log itself records them. Nothing is inferred from what the
 * agent said. A transcript with no tool data yields a call log with
 * messages only, which the detectors treat honestly (usually: no finding).
 *
 * Bland: fields follow the documented call-details response
 * (GET /v1/calls/{id}): `transcripts[]` with `user` in
 * user | assistant | robot | agent-action, plus `concatenated_transcript`.
 * Bland does not document structured tool-call fields; `agent-action`
 * entries whose text contains a JSON object are read as a tool result,
 * and the rest are kept as visible system notes.
 */
import type { CallEvent, CallLog, ToolDefinition } from "../../shared/types.js";
import type { JsonValue } from "../../shared/json.js";
import { isObject, isoTime, parseMaybeJson, pick, roleOf, textOf, type Role } from "./common.js";

export interface FormatReader {
  id: string;
  label: string;
  detect(data: unknown): boolean;
  read(data: unknown, fallbackId: string): CallLog;
}

function baseLog(id: string, provider: string, events: CallEvent[], extra: Partial<CallLog> = {}): CallLog {
  return { schemaVersion: "1.0", id, provider, kind: "recorded", tools: [], events, ...extra };
}

function idOf(obj: Record<string, unknown>, fallback: string): string {
  return pick(obj, ["call_id", "callId", "id", "c_id", "conversation_id", "session_id"]) ?? (typeof obj.call_id === "number" ? String(obj.call_id) : fallback);
}

/** Collect tool names seen in calls into minimal definitions. */
function toolsFrom(events: CallEvent[]): ToolDefinition[] {
  return [...new Set(events.flatMap((e) => (e.type === "tool_call" ? [e.toolName] : [])))].map((name) => ({ name }));
}

// ---------------------------------------------------------------------------
// Plain-text transcripts: "Agent: hello\nUser: hi". Common when copying from
// a dashboard, or Bland's concatenated_transcript.

const LINE = /^\s*\[?([A-Za-z][\w .'-]{0,30}?)\]?\s*[:：]\s*(.*)$/;

export function readTranscriptText(text: string, id: string, provider = "transcript-text"): CallLog {
  const events: CallEvent[] = [];
  const unknownSpeakers = new Map<string, Role>();
  let current: { role: Role; parts: string[] } | null = null;
  const flush = () => {
    if (current && current.parts.join(" ").trim()) events.push({ type: "message", role: current.role, content: current.parts.join(" ").trim() });
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(LINE);
    if (m) {
      const speaker = m[1]!.trim();
      let role = roleOf(speaker);
      if (!role) {
        // A named speaker ("Riley: ...") we can't classify: first unknown name is the agent.
        role = unknownSpeakers.get(speaker.toLowerCase()) ?? (unknownSpeakers.size === 0 ? "assistant" : "user");
        unknownSpeakers.set(speaker.toLowerCase(), role);
      }
      flush();
      current = { role, parts: [m[2] ?? ""] };
    } else if (raw.trim() && current) {
      (current as { parts: string[] }).parts.push(raw.trim());
    }
  }
  flush();
  const named = [...unknownSpeakers.entries()].map(([s, r]) => `"${s}" as ${r}`);
  return baseLog(id, provider, events, {
    notes: `Read as a plain-text transcript: ${events.length} turns, no tool data.${named.length ? ` Speakers mapped: ${named.join(", ")}.` : ""}`,
  });
}

export const transcriptText: FormatReader = {
  id: "transcript-text",
  label: "Plain-text transcript",
  detect: (d) => typeof d === "string" && d.split(/\r?\n/).filter((l) => LINE.test(l)).length >= 2,
  read: (d, fallbackId) => readTranscriptText(d as string, fallbackId),
};

// ---------------------------------------------------------------------------
// Bland call details.

const BLAND_SPEAKERS = new Set(["user", "assistant", "robot", "agent-action"]);

function blandEntries(d: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const t = d.transcripts;
  if (!Array.isArray(t) || t.length === 0) return null;
  const ok = t.every((e) => isObject(e) && typeof e.text === "string" && typeof e.user === "string" && BLAND_SPEAKERS.has(e.user));
  return ok ? (t as Array<Record<string, unknown>>) : null;
}

/** First balanced {...} JSON object inside a string, if any. */
function embeddedJson(text: string): { json: JsonValue; before: string } | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return { json: JSON.parse(text.slice(start, i + 1)) as JsonValue, before: text.slice(0, start) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function blandToolName(before: string, index: number): string {
  const m = before.match(/(?:tool|webhook|function|action|api)\s*(?:call(?:ed)?|response|result)?\s*[:\-"'`(]?\s*([A-Za-z_][\w-]{1,60})/i);
  const name = m?.[1];
  return name && !/^(response|result|returned|called|with|the|a)$/i.test(name) ? name : `agent_action_${index}`;
}

export const bland: FormatReader = {
  id: "bland",
  label: "Bland call details",
  detect: (d) => isObject(d) && (blandEntries(d) !== null || (typeof d.concatenated_transcript === "string" && ("call_id" in d || "c_id" in d))),
  read: (d, fallbackId) => {
    const obj = d as Record<string, unknown>;
    const id = idOf(obj, fallbackId);
    const entries = blandEntries(obj);
    if (!entries) {
      const log = readTranscriptText(String(obj.concatenated_transcript), id, "bland");
      log.startedAt = isoTime(obj.started_at) ?? isoTime(obj.created_at);
      log.notes = `Read as Bland call details from concatenated_transcript (no transcripts array): ${log.events.length} turns, no tool data.`;
      return log;
    }
    const events: CallEvent[] = [];
    let actions = 0;
    let toolResults = 0;
    const sorted = [...entries].sort((a, b) => (isoTime(a.created_at) ?? "").localeCompare(isoTime(b.created_at) ?? "") || Number(a.id ?? 0) - Number(b.id ?? 0));
    sorted.forEach((e, i) => {
      const at = isoTime(e.created_at);
      const text = String(e.text);
      if (e.user === "agent-action") {
        actions++;
        const found = embeddedJson(text);
        if (found && isObject(found.json)) {
          // The log records an action with a structured payload: keep it as a tool result.
          toolResults++;
          const callId = `bland-action-${e.id ?? i}`;
          const toolName = blandToolName(found.before, toolResults);
          events.push({ type: "tool_call", callId, toolName, arguments: {}, ...(at ? { at } : {}) });
          events.push({ type: "tool_result", callId, toolName, response: { body: found.json }, ...(at ? { at } : {}) });
        } else {
          events.push({ type: "message", role: "system", content: `[agent action] ${text}`, ...(at ? { at } : {}) });
        }
        return;
      }
      const role: Role = e.user === "user" ? "user" : "assistant";
      events.push({ type: "message", role, content: text, ...(at ? { at } : {}) });
    });
    const robot = sorted.some((e) => e.user === "robot");
    return baseLog(id, "bland", events, {
      startedAt: isoTime(obj.started_at) ?? isoTime(obj.created_at),
      tools: toolsFrom(events),
      notes:
        `Read as Bland call details: ${sorted.length} transcript entries.` +
        (actions ? ` ${actions} agent action(s): ${toolResults} with a JSON payload read as tool results, the rest kept as system notes.` : " No agent actions, so no tool data.") +
        (robot ? ' Entries from "robot" were treated as the agent.' : "") +
        (isObject(obj.variables) && Object.keys(obj.variables).length ? " Bland's variables object is not read: it does not say which tool produced each value." : ""),
    });
  },
};

// ---------------------------------------------------------------------------
// Retell: transcript_with_tool_calls.

export const retell: FormatReader = {
  id: "retell",
  label: "Retell call",
  detect: (d) => isObject(d) && Array.isArray(d.transcript_with_tool_calls),
  read: (d, fallbackId) => {
    const obj = d as Record<string, unknown>;
    const events: CallEvent[] = [];
    for (const e of obj.transcript_with_tool_calls as unknown[]) {
      if (!isObject(e)) continue;
      const callId = pick(e, ["tool_call_id", "id"]) ?? `retell-${events.length}`;
      if (e.role === "tool_call_invocation") {
        events.push({ type: "tool_call", callId, toolName: pick(e, ["name"]) ?? "tool", arguments: parseMaybeJson(e.arguments ?? {}) });
      } else if (e.role === "tool_call_result") {
        events.push({ type: "tool_result", callId, response: { body: parseMaybeJson(e.content) } });
      } else {
        const role = roleOf(e.role);
        const text = textOf(e.content);
        if (role && text) events.push({ type: "message", role, content: text });
      }
    }
    return baseLog(pick(obj, ["call_id"]) ?? fallbackId, "retell", events, { tools: toolsFrom(events), notes: "Read as a Retell call (transcript_with_tool_calls)." });
  },
};

// ---------------------------------------------------------------------------
// Vapi: messages with role bot/user/tool_calls/tool_call_result.

function vapiMessages(d: unknown): unknown[] | null {
  if (!isObject(d)) return null;
  const msgs = (isObject(d.artifact) && Array.isArray(d.artifact.messages) ? d.artifact.messages : d.messages) as unknown;
  if (!Array.isArray(msgs)) return null;
  return msgs.some((m) => isObject(m) && (m.role === "bot" || m.role === "tool_calls" || m.role === "tool_call_result")) ? msgs : null;
}

export const vapi: FormatReader = {
  id: "vapi",
  label: "Vapi call",
  detect: (d) => vapiMessages(d) !== null,
  read: (d, fallbackId) => {
    const events: CallEvent[] = [];
    for (const m of vapiMessages(d)!) {
      if (!isObject(m)) continue;
      if (m.role === "tool_calls" && Array.isArray(m.toolCalls)) {
        for (const c of m.toolCalls) {
          if (!isObject(c) || !isObject(c.function)) continue;
          events.push({ type: "tool_call", callId: pick(c, ["id"]) ?? `vapi-${events.length}`, toolName: pick(c.function, ["name"]) ?? "tool", arguments: parseMaybeJson(c.function.arguments ?? {}) });
        }
      } else if (m.role === "tool_call_result") {
        events.push({ type: "tool_result", callId: pick(m, ["toolCallId", "tool_call_id"]) ?? `vapi-${events.length}`, ...(pick(m, ["name"]) ? { toolName: pick(m, ["name"]) } : {}), response: { body: parseMaybeJson(m.result) } });
      } else {
        const role = m.role === "bot" ? "assistant" : roleOf(m.role);
        const text = pick(m, ["message", "content"]);
        if (role && text) events.push({ type: "message", role, content: text });
      }
    }
    return baseLog(idOf(d as Record<string, unknown>, fallbackId), "vapi", events, { tools: toolsFrom(events), notes: "Read as a Vapi call (messages with bot / tool_calls / tool_call_result)." });
  },
};

// ---------------------------------------------------------------------------
// Generic message lists: a bare array, or an object holding one under a
// common key. Handles OpenAI-style tool_calls / role "tool", legacy
// function_call, and Anthropic tool_use / tool_result content blocks.

const LIST_KEYS = ["messages", "transcript", "conversation", "turns", "dialog", "dialogue", "utterances", "history", "chat", "events"];
const SPEAKER_KEYS = ["role", "speaker", "from", "author", "sender", "participant", "user", "party"];
const TEXT_KEYS = ["content", "text", "message", "utterance", "transcript", "body"];

function findList(d: unknown): { list: unknown[]; key: string | null; container: Record<string, unknown> | null } | null {
  if (Array.isArray(d)) return { list: d, key: null, container: null };
  if (!isObject(d)) return null;
  for (const k of LIST_KEYS) if (Array.isArray(d[k]) && (d[k] as unknown[]).length) return { list: d[k] as unknown[], key: k, container: d };
  // One level of wrapping: {call: {...}}, {data: {...}}.
  for (const v of Object.values(d)) {
    if (isObject(v)) for (const k of LIST_KEYS) if (Array.isArray(v[k]) && (v[k] as unknown[]).length) return { list: v[k] as unknown[], key: k, container: v };
  }
  return null;
}

function looksLikeMessages(list: unknown[]): boolean {
  const sample = list.filter(isObject).slice(0, 20);
  if (sample.length === 0) return false;
  const hits = sample.filter((m) => SPEAKER_KEYS.some((k) => typeof m[k] === "string") && (TEXT_KEYS.some((k) => m[k] !== undefined) || Array.isArray(m.tool_calls)));
  return hits.length / sample.length >= 0.6;
}

export const genericMessages: FormatReader = {
  id: "messages",
  label: "Message list",
  detect: (d) => {
    const f = findList(d);
    return !!f && looksLikeMessages(f.list);
  },
  read: (d, fallbackId) => {
    const { list, key, container } = findList(d)!;
    const events: CallEvent[] = [];
    const names = new Map<string, string>();
    const unknown = new Set<string>();
    let n = 0;
    const nextId = () => `call_${++n}`;
    for (const m of list) {
      if (!isObject(m)) continue;
      const speaker = SPEAKER_KEYS.map((k) => m[k]).find((v) => typeof v === "string") as string | undefined;
      const at = isoTime(m.created_at ?? m.timestamp ?? m.time ?? m.at);
      const stamp = at ? { at } : {};

      // OpenAI tool result / legacy function result.
      if (speaker === "tool" || speaker === "function") {
        const callId = pick(m, ["tool_call_id", "toolCallId", "id"]) ?? [...names.keys()].at(-1) ?? nextId();
        const toolName = pick(m, ["name"]) ?? names.get(callId);
        events.push({ type: "tool_result", callId, ...(toolName ? { toolName } : {}), response: { body: parseMaybeJson(textOf(m.content) ?? m.content) }, ...stamp });
        continue;
      }
      const role = roleOf(speaker) ?? (speaker ? (unknown.add(speaker), "assistant" as Role) : null);
      if (!role) continue;

      const content = TEXT_KEYS.map((k) => m[k]).find((v) => v !== undefined);
      // Anthropic content blocks.
      if (Array.isArray(content) && content.some((b) => isObject(b) && (b.type === "tool_use" || b.type === "tool_result"))) {
        for (const b of content) {
          if (!isObject(b)) continue;
          if (b.type === "text" && typeof b.text === "string" && b.text.trim()) events.push({ type: "message", role, content: b.text, ...stamp });
          else if (b.type === "tool_use") {
            const callId = pick(b, ["id"]) ?? nextId();
            const toolName = pick(b, ["name"]) ?? "tool";
            names.set(callId, toolName);
            events.push({ type: "tool_call", callId, toolName, arguments: (b.input ?? {}) as JsonValue, ...stamp });
          } else if (b.type === "tool_result") {
            const callId = pick(b, ["tool_use_id"]) ?? nextId();
            const body = parseMaybeJson(textOf(b.content) ?? b.content);
            events.push({
              type: "tool_result",
              callId,
              ...(names.get(callId) ? { toolName: names.get(callId) } : {}),
              ...(b.is_error === true ? { error: { kind: "unknown" as const, message: typeof body === "string" ? body : JSON.stringify(body) } } : { response: { body } }),
              ...stamp,
            });
          }
        }
        continue;
      }
      const text = textOf(content);
      if (text && text.trim()) events.push({ type: "message", role, content: text, ...stamp });
      // OpenAI tool_calls and legacy function_call on an assistant turn.
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : isObject(m.function_call) ? [{ function: m.function_call }] : [];
      for (const c of calls) {
        if (!isObject(c) || !isObject(c.function)) continue;
        const callId = pick(c, ["id"]) ?? nextId();
        const toolName = pick(c.function, ["name"]) ?? "tool";
        names.set(callId, toolName);
        events.push({ type: "tool_call", callId, toolName, arguments: parseMaybeJson(c.function.arguments ?? {}), ...stamp });
      }
    }
    const src = key ? `the "${key}" list` : "a JSON array";
    return baseLog(container ? idOf(container, fallbackId) : fallbackId, "messages", events, {
      tools: toolsFrom(events),
      notes:
        `Read as a message list from ${src}: ${events.filter((e) => e.type === "message").length} messages, ${events.filter((e) => e.type === "tool_call").length} tool calls.` +
        (unknown.size ? ` Unrecognized speakers treated as the agent: ${[...unknown].join(", ")}.` : ""),
    });
  },
};

/** Tried in order after the native CallLog and strict OpenAI formats. */
export const READERS: FormatReader[] = [bland, retell, vapi, genericMessages, transcriptText];
