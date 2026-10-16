/**
 * src/lib/openai-chat.ts — the one place the shop's text model is chosen.
 *
 * Pinned: unset OPENAI_MODEL means gpt-6-luna (gpt-4.1-mini shuts down on
 * 14.01.2027); a reasoning model is asked for effort "none", so it answers
 * at once, keeps `temperature` and spends the whole token cap on the answer;
 * a gpt-4 generation model pinned in OPENAI_MODEL gets no reasoning field it
 * would refuse; the cap always travels as max_completion_tokens.
 */
import { describe, expect, it } from "vitest";
import { chatParams, DEFAULT_OPENAI_MODEL, isReasoningModel, openaiModel } from "@/lib/openai-chat";

describe("openaiModel", () => {
  it("is gpt-6-luna when OPENAI_MODEL is unset or blank", () => {
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-6-luna");
    expect(openaiModel({})).toBe("gpt-6-luna");
    expect(openaiModel({ OPENAI_MODEL: "" })).toBe("gpt-6-luna");
    expect(openaiModel({ OPENAI_MODEL: "  " })).toBe("gpt-6-luna");
  });

  it("takes OPENAI_MODEL when it is set", () => {
    expect(openaiModel({ OPENAI_MODEL: "gpt-4.1-mini" })).toBe("gpt-4.1-mini");
    expect(openaiModel({ OPENAI_MODEL: " gpt-6-sol " })).toBe("gpt-6-sol");
  });
});

describe("isReasoningModel", () => {
  it.each(["gpt-6-luna", "gpt-6-sol", "gpt-5.1", "gpt-5-mini", "o3", "o4-mini"])("%s thinks before it answers", (m) => {
    expect(isReasoningModel(m)).toBe(true);
  });
  it.each(["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"])("%s does not", (m) => {
    expect(isReasoningModel(m)).toBe(false);
  });
});

describe("chatParams", () => {
  it("asks gpt-6-luna for no reasoning, so temperature and the whole cap still apply", () => {
    expect(chatParams("gpt-6-luna", { maxTokens: 120, temperature: 0 })).toEqual({
      model: "gpt-6-luna",
      max_completion_tokens: 120,
      temperature: 0,
      reasoning_effort: "none",
    });
  });

  it("sends gpt-4.1-mini no reasoning_effort — it would answer 400", () => {
    const p = chatParams("gpt-4.1-mini", { maxTokens: 900, temperature: 0.4 });
    expect(p).toEqual({ model: "gpt-4.1-mini", max_completion_tokens: 900, temperature: 0.4 });
    expect("reasoning_effort" in p).toBe(false);
  });

  it("never sends the deprecated max_tokens", () => {
    for (const m of ["gpt-6-luna", "gpt-4.1-mini"]) {
      expect("max_tokens" in chatParams(m, { maxTokens: 400, temperature: 0.4 })).toBe(false);
    }
  });
});
