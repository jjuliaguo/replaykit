/**
 * Minimal LLM client for the optional normalizer (llm-normalizer.ts).
 * Off unless REPLAYKIT_LLM_MAPPING=1 and OPENAI_API_KEY are set: each use is
 * a paid API call. Tests pass a fake LlmClient instead.
 */
export interface LlmClient {
  /** Send a prompt, get the model's raw text reply. */
  complete(system: string, user: string): Promise<string>;
}

export function llmMappingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REPLAYKIT_LLM_MAPPING === "1" && !!env.OPENAI_API_KEY;
}

/** OpenAI chat-completions client over fetch (no SDK dependency). */
export function openAIClient(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  return {
    async complete(system, user) {
      const res = await fetch(`${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
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
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}
