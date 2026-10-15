import { describe, expect, it } from "vitest";
import { toCallLogAsync } from "../adapters/index.js";
import { llmMappingEnabled, openAIClient, type LlmClient } from "../adapters/llm-client.js";

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("llm client", () => {
  it("is enabled only with both the flag and a key", () => {
    expect(llmMappingEnabled({})).toBe(false);
    expect(llmMappingEnabled({ OPENAI_API_KEY: "k" })).toBe(false);
    expect(llmMappingEnabled({ REPLAYKIT_LLM_MAPPING: "1" })).toBe(false);
    expect(llmMappingEnabled({ REPLAYKIT_LLM_MAPPING: "1", OPENAI_API_KEY: "k" })).toBe(true);
  });

  it("sends a JSON-mode chat request with the key, and retries once on an unknown model", async () => {
    const calls: Array<{ url: string; body: { model: string; response_format: unknown; temperature: number }; auth: string | null }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
      return calls.length === 1 ? new Response('{"error":{"message":"The model does not exist"}}', { status: 404 }) : ok('{"events":[]}');
    }) as typeof fetch;
    const reply = await openAIClient({ OPENAI_API_KEY: "test-key" }, fetchImpl).complete("sys", "user");
    expect(reply).toBe('{"events":[]}');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.auth).toBe("Bearer test-key");
    expect(calls[0]!.body).toMatchObject({ temperature: 0, response_format: { type: "json_object" } });
    expect(calls[1]!.body.model).not.toBe(calls[0]!.body.model);
  });

  it("does not retry when the model was chosen explicitly", async () => {
    let n = 0;
    const fetchImpl = (async () => (n++, new Response("model not found", { status: 404 }))) as unknown as typeof fetch;
    await expect(openAIClient({ OPENAI_API_KEY: "k", OPENAI_MODEL: "custom" }, fetchImpl).complete("s", "u")).rejects.toThrow(/HTTP 404/);
    expect(n).toBe(1);
  });
});

describe("the LLM is a fallback, not called for every paste", () => {
  const spy = (): LlmClient & { calls: number } => {
    const c = { calls: 0, async complete() { c.calls++; return '{"events":[]}'; } };
    return c;
  };

  it.each([
    ["a known format", { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }],
    ["an event log with tools", { events: [{ type: "user_message", content: "Book me in" }, { type: "tool_request", tool: "book", time: "15:00" }, { type: "tool_response", tool: "book", ok: false }, { type: "agent_message", content: "Booked!" }] }],
    ["an inferred format with tools and conversation", { data: { rows: [{ actor: "customer", kind: "speech", words: "Cancel my plan please." }, { actor: "bot", kind: "function_call", function: "cancel_plan", params: { id: 1 } }, { actor: "system", kind: "function_result", function: "cancel_plan", output: { ok: false } }, { actor: "bot", kind: "speech", words: "Done, your plan is cancelled." }] } }],
    ["a plain transcript that never mentions tools", "Agent: Hello, how can I help?\nCaller: What are your hours?\nAgent: We're open nine to five."],
  ])("%s", async (_name, log) => {
    const llm = spy();
    await toCallLogAsync(log, { llm });
    expect(llm.calls).toBe(0);
  });

  it("is called when nothing else can read the log", async () => {
    const llm = spy();
    await toCallLogAsync("<CallRecord><Turn who='agent'>hi</Turn><Action name='x' status='500'/></CallRecord>", { llm }).catch(() => undefined);
    expect(llm.calls).toBe(1);
  });
});
