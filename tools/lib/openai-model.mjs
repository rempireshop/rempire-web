/**
 * src/lib/openai-chat.ts for plain-Node tools — the build cannot import
 * TypeScript. Same model choice, same request fields; tests/search-cards.test.ts
 * holds the two copies to the same answers, so they cannot drift apart.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export function openaiModel(env = process.env) {
  return (env.OPENAI_MODEL || "").trim() || DEFAULT_OPENAI_MODEL;
}

export function isReasoningModel(model) {
  return /^(o\d|gpt-[5-9])/i.test(model);
}

export function chatParams(model, opts) {
  return {
    model,
    max_completion_tokens: opts.maxTokens,
    temperature: opts.temperature,
    ...(isReasoningModel(model) ? { reasoning_effort: "none" } : {}),
  };
}
