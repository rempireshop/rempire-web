/**
 * The shop's text model, and the parts of a chat-completions request that
 * depend on which model it is.
 *
 * Three routes call OpenAI chat completions: the shop chat and the admin
 * assistant (src/app/api/assistant/route.ts), the panel's «✨» text tasks
 * (src/app/api/admin/ai/text/route.ts) and the search terms
 * (src/app/api/search/route.ts). Each used to name the model itself; this is
 * now the only place it is chosen.
 *
 * gpt-4.1-mini shuts down in the API on 14.01.2027 (OpenAI deprecations,
 * 2026-10-14) and gpt-6-luna is the replacement OpenAI names for it. Luna is
 * a reasoning model whose default effort is "medium": left there it would
 * think before every answer, bill the thinking as output, take it out of the
 * token cap (the search's 120 would be spent before the first term) and
 * refuse `temperature`. `reasoning_effort: "none"` makes it answer at once,
 * the way gpt-4.1-mini did, with temperature honoured.
 *
 * OPENAI_MODEL still overrides the default. A gpt-4 generation model gets no
 * `reasoning_effort` — it does not know the field and would answer 400 — so a
 * deployment that pinned gpt-4.1-mini keeps working until that model is gone.
 * A reasoning model set there has to accept effort "none" (gpt-6-luna,
 * gpt-6-sol, gpt-5.1 and later); one that does not answers 400, and every
 * route says `upstream`.
 */

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export function openaiModel(env: Record<string, string | undefined> = process.env): string {
  return (env.OPENAI_MODEL || "").trim() || DEFAULT_OPENAI_MODEL;
}

/** The o-series and gpt-5 onward think before they answer; gpt-4.1 and gpt-4o do not. */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-[5-9])/i.test(model);
}

/**
 * The model-dependent fields of a chat-completions body. The cap travels as
 * `max_completion_tokens`: `max_tokens` is deprecated and reasoning models
 * refuse it, while gpt-4.1-mini takes either.
 */
export function chatParams(model: string, opts: { maxTokens: number; temperature: number }) {
  return {
    model,
    max_completion_tokens: opts.maxTokens,
    temperature: opts.temperature,
    ...(isReasoningModel(model) ? { reasoning_effort: "none" as const } : {}),
  };
}
