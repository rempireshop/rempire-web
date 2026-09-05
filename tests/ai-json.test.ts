/**
 * The tolerant JSON reader both AI routes parse the model through
 * (src/lib/ai-json.ts). What the owner actually saw — the raw text of a
 * reply cut by max_tokens printed into the panel — is the case that must
 * never come back: a cut document still yields its `reply`, a fenced or
 * prefixed one yields the object, and a string that is JSON is recognised
 * as one so it is never shown as a sentence.
 */
import { describe, expect, it } from "vitest";
import { extractJsonObject, looksLikeJson } from "@/lib/ai-json";

const FULL = { reply: "Ставлю цену 9 €.", product_ids: [], tab: "goods", action: { type: "set_price", id: "x", value: 9 } };

describe("extractJsonObject — the plain case", () => {
  it("parses a clean object untouched", () => {
    const out = extractJsonObject(JSON.stringify(FULL));
    expect(out.value).toEqual(FULL);
    expect(out.truncated).toBe(false);
    expect(out.repaired).toBe(false);
  });

  it("returns null for nothing, for prose without a brace, for an array", () => {
    expect(extractJsonObject("").value).toBeNull();
    expect(extractJsonObject(undefined).value).toBeNull();
    expect(extractJsonObject("Извините, не могу.").value).toBeNull();
    expect(extractJsonObject("[1,2,3]").value).toBeNull();
  });

  it("flags finish_reason length even when the object happened to close", () => {
    const out = extractJsonObject(JSON.stringify(FULL), { finishReason: "length" });
    expect(out.value).toEqual(FULL);
    expect(out.truncated).toBe(true);
  });
});

describe("extractJsonObject — fences and prose", () => {
  it("reads an object wrapped in a ```json fence", () => {
    const out = extractJsonObject("```json\n" + JSON.stringify(FULL) + "\n```");
    expect(out.value).toEqual(FULL);
    expect(out.repaired).toBe(true);
    expect(out.truncated).toBe(false);
  });

  it("reads an object with a sentence before it and one after it", () => {
    const out = extractJsonObject("Вот ответ:\n" + JSON.stringify(FULL) + "\nГотово.");
    expect(out.value).toEqual(FULL);
    expect(out.repaired).toBe(true);
  });

  it("reads a fence that was never closed", () => {
    const out = extractJsonObject("```json\n" + JSON.stringify(FULL));
    expect(out.value).toEqual(FULL);
  });

  it("is not fooled by braces inside strings", () => {
    const tricky = { reply: "Скобки {вот такие} и } ещё \"кавычки\"", tab: "" };
    const out = extractJsonObject("ответ: " + JSON.stringify(tricky) + " конец");
    expect(out.value).toEqual(tricky);
  });
});

describe("extractJsonObject — a document cut by max_tokens", () => {
  const draft = {
    reply: "Написал черновик статьи об уходе за бородой зимой на трёх языках.",
    product_ids: [],
    tab: "blog",
    action: {
      type: "draft_post",
      title: { RU: "Как ухаживать за бородой зимой", ET: "Kuidas hooldada habet talvel", EN: "How to care for your beard in winter" },
      body: { RU: "# Зимний уход\n\nЗимой борода становится суше — виновата не только погода." },
    },
  };
  const text = JSON.stringify(draft);

  it("cut mid-string inside the body: the reply, the tab and the action's type survive", () => {
    const cut = text.slice(0, text.indexOf("виновата") + 4);
    const out = extractJsonObject(cut, { finishReason: "length" });
    expect(out.truncated).toBe(true);
    expect(out.repaired).toBe(true);
    expect(out.value).not.toBeNull();
    expect(out.value!.reply).toBe(draft.reply);
    expect(out.value!.tab).toBe("blog");
    const action = out.value!.action as Record<string, unknown>;
    expect(action.type).toBe("draft_post");
    expect((action.title as Record<string, string>).RU).toBe("Как ухаживать за бородой зимой");
  });

  it("cut right after a key's colon: the dangling member is dropped", () => {
    const cut = text.slice(0, text.indexOf('"body":') + 7);
    const out = extractJsonObject(cut);
    expect(out.value!.reply).toBe(draft.reply);
    expect((out.value!.action as Record<string, unknown>).type).toBe("draft_post");
    expect((out.value!.action as Record<string, unknown>).body).toBeUndefined();
  });

  it("cut inside a key name: the half key is dropped", () => {
    const cut = text.slice(0, text.indexOf('"body"') + 3);
    const out = extractJsonObject(cut);
    expect(out.value!.reply).toBe(draft.reply);
    expect((out.value!.action as Record<string, unknown>).type).toBe("draft_post");
  });

  it("cut after a comma: the trailing comma goes", () => {
    const cut = text.slice(0, text.indexOf('"product_ids"') );
    const out = extractJsonObject(cut);
    expect(out.value).toEqual({ reply: draft.reply });
  });

  it("cut inside an array of strings closes the last item — a cut string is kept, like a cut reply is", () => {
    const cut = '{"reply":"ок","product_ids":["a","b","c';
    const out = extractJsonObject(cut);
    expect(out.value).toEqual({ reply: "ок", product_ids: ["a", "b", "c"] });
    // …and cut between items, the dangling comma goes
    expect(extractJsonObject('{"reply":"ок","product_ids":["a","b",').value).toEqual({ reply: "ок", product_ids: ["a", "b"] });
  });

  it("cut on a backslash at the very end still closes the string", () => {
    const cut = '{"reply":"строка со сло\\';
    const out = extractJsonObject(cut);
    expect(out.value).not.toBeNull();
    expect(String(out.value!.reply)).toMatch(/^строка со сло/);
  });

  it("cut inside a number drops that member", () => {
    const cut = '{"reply":"ок","action":{"type":"set_price","id":"x","value":1';
    const out = extractJsonObject(cut);
    expect(out.value!.reply).toBe("ок");
    // 1 is a whole number as far as the text goes — kept; nothing invented after it
    expect((out.value!.action as Record<string, unknown>).type).toBe("set_price");
  });

  it("cut right after the opening brace yields an empty object, not a crash", () => {
    expect(extractJsonObject("{").value).toEqual({});
    expect(extractJsonObject('{"reply"').value).toEqual({});
  });

  it("the raw text of a cut answer is never what comes back", () => {
    const cut = text.slice(0, 120);
    const out = extractJsonObject(cut);
    expect(typeof out.value).toBe("object");
    expect(JSON.stringify(out.value)).not.toContain("{\"reply\":\"{");
  });
});

describe("looksLikeJson", () => {
  it("spots an object, an array, a fence and a bare reply key", () => {
    expect(looksLikeJson('{"reply":"…"}')).toBe(true);
    expect(looksLikeJson("  {\"reply\": \"cut")).toBe(true);
    expect(looksLikeJson("[1]")).toBe(true);
    expect(looksLikeJson("```json\n{}")).toBe(true);
    expect(looksLikeJson('Написал: "reply": "x"')).toBe(true);
  });
  it("leaves a sentence alone", () => {
    expect(looksLikeJson("Ставлю цену 9 € — подтвердите.")).toBe(false);
    expect(looksLikeJson("")).toBe(false);
    expect(looksLikeJson(null)).toBe(false);
  });
});
