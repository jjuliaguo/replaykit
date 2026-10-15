/**
 * Minimal LLM client for the optional normalizer (llm-normalizer.ts).
 *
 * Off unless REPLAYKIT_LLM_MAPPING=1 and OPENAI_API_KEY are set. It is only
 * used as a fallback (see toCallLogAsync): logs the built-in readers handle
 * never reach the model. Tests pass a fake LlmClient instead.
 *
 *   OPENAI_API_KEY         required to enable
 *   REPLAYKIT_LLM_MAPPING  "1" to enable
 *   OPENAI_MODEL           optional; defaults below, with one fallback model
 *   OPENAI_BASE_URL        optional; for OpenAI-compatible endpoints
 */
export interface LlmClient {
  /** Send a prompt, get the model's raw text reply. */
  complete(system: string, user: string): Promise<string>;
}

const DEFAULT_MODEL = "gpt-4.1-mini";
const FALLBACK_MODEL = "gpt-4o-mini";

export function llmMappingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REPLAYKIT_LLM_MAPPING === "1" && !!env.OPENAI_API_KEY;
}

/** OpenAI chat-completions client over fetch (no SDK dependency). */
export function openAIClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): LlmClient {
  const configured = env.OPENAI_MODEL || DEFAULT_MODEL;
  const call = async (model: string, system: string, user: string) =>
    fetchImpl(`${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
  return {
    async complete(system, user) {
      let res = await call(configured, system, user);
      // An unknown or retired model id: retry once with a widely available one.
      if ((res.status === 404 || res.status === 400) && !env.OPENAI_MODEL && configured !== FALLBACK_MODEL) {
        const text = await res.text();
        if (/model/i.test(text)) res = await call(FALLBACK_MODEL, system, user);
        else throw new Error(`LLM request failed: HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}
