/**
 * «Тема статьи» is the subject of the article — the owner's words, not the
 * old title and not whatever the products happen to be.
 *
 * The owner, /test pass of 23.09.2026 (ai-blog-translate): «When I gave the
 * assistant the topic "cool vibes" it still writes me about "Create a Stylish
 * Look with Proper Hair Care and Styling" — I am not sure how the assistant
 * works.» Three doors let the old subject back in:
 *
 *   1. the editor's «Тема статьи» box was PRE-FILLED with the article's own
 *      title as its value. On a phone a tap puts the caret at the end of it,
 *      so «cool vibes» was typed onto «Создайте стильный образ…», and the
 *      article was written about the stylish look again;
 *   2. the chat assistant's draft_post names the topic in «one plain Russian
 *      line» of its own — and a model told to stay on grooming rewrote
 *      «cool vibes» into a generic hair-care subject; the owner's own words
 *      never reached the article generator;
 *   3. the generator itself was told «a grooming-advice article on the
 *      topic» and handed the previous article's products first, with nothing
 *      saying a loose topic stays the subject — so it wrote about the
 *      products.
 *
 * The prompt is built without the network; the panel's own functions are cut
 * out of app.js and the request they would send is caught.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildBlogOutlinePrompt, buildPostFullPrompt } from "@/lib/ai-prompts";
import { draftPostWithAsk, sanitizeAction } from "@/app/api/assistant/actions";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const routeSrc = readFileSync(fileURLToPath(new URL("../src/app/api/assistant/route.ts", import.meta.url)), "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
function block(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in «${head}»`);
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const OLD = "Создайте стильный образ с правильным уходом за волосами и укладкой";
const draft = () => ({ title: { RU: OLD, ET: "", EN: "Create a Stylish Look with Proper Hair Care and Styling" }, products: ["kevin-murphy-hair-resort"] });

describe("the editor's «Тема статьи» box", () => {
  const field = new Function("S", "esc", `${slice("blogTopicValue")}\n${slice("admBlogTopicFieldHTML")}\nreturn admBlogTopicFieldHTML;`);

  it("holds only what the owner typed; the article's title is a grey hint, not text to type after", () => {
    const html = (field({ adminBlogTopic: "" }, esc) as (d: unknown, busy: boolean) => string)(draft(), false);
    expect(html).toMatch(/\bvalue=""/);
    expect(html).toContain(`placeholder="${OLD}"`);
  });

  it("…and a new article's hint is the example it always had", () => {
    const html = (field({ adminBlogTopic: "" }, esc) as (d: unknown, busy: boolean) => string)({ title: { RU: "", ET: "", EN: "" } }, false);
    expect(html).toContain('placeholder="уход за бородой зимой"');
  });

  it("what was typed stays in the box through the generator's repaints", () => {
    const html = (field({ adminBlogTopic: "cool vibes" }, esc) as (d: unknown, busy: boolean) => string)(draft(), true);
    expect(html).toContain('value="cool vibes"');
    expect(html).toContain(" disabled");
  });
});

describe("«Написать статью целиком» sends the topic the owner typed", () => {
  function press(typed: string) {
    const S: Record<string, unknown> = { adminBlogEdit: draft(), adminBlogTopic: typed };
    const sent: { topic: string; hint: string }[] = [];
    // 1a: a draft is written straight away — blogAiAsks() asks only over a published article
    const run = new Function(
      "S", "document", "admBlogWriteFull", "t", "blogAiAsks",
      `${slice("blogTopicValue")}\nvar d = { admblogfull: "" };\n${block("if (d.admblogfull !== undefined) {")}`,
    );
    run(
      S,
      { querySelector: (s: string) => (s === "[data-admblogtopic]" ? { value: typed } : null) },
      (_d: unknown, topic: string, hint: string) => sent.push({ topic, hint }),
      { disabled: false },
      () => false,
    );
    return { S, sent };
  }

  it("the typed words, not the old title in front of them", () => {
    const { sent } = press("cool vibes");
    expect(sent).toEqual([{ topic: "cool vibes", hint: "" }]);
  });

  it("an empty box still writes the article its title names — without pinning that title into the box", () => {
    const { S, sent } = press("");
    expect(sent[0].topic).toBe(OLD);
    expect(S.adminBlogTopic, "the old title would stay in the box after the article got a new one").toBe("");
  });

  it("the request carries the topic as it was given", () => {
    const calls: { url: string; body: { task: string; input: { topic: string; ask?: string } } }[] = [];
    const S: Record<string, unknown> = { adminBlogGen: null };
    // 1a: the progress line is in the assistant's fold, opened as the writing starts
    const write = new Function(
      "S", "toast", "refocus", "render", "apiSend", "productsById", "CAT_NAMES", "ADM_FOLD", "admFoldToggle",
      `${slice("admBlogWriteFull")}\nreturn admBlogWriteFull;`,
    )(
      S, () => {}, () => {}, () => {},
      (url: string, _m: string, body: never) => { calls.push({ url, body }); return new Promise(() => {}); },
      () => [], {}, {}, () => true,
    ) as (d: unknown, topic: string, hint: string, ask?: string) => void;
    write(draft(), "cool vibes", "", "");
    expect(calls[0].body.task).toBe("post_full");
    expect(calls[0].body.input.topic).toBe("cool vibes");
    S.adminBlogGen = null;                        // that article finished; the assistant asks for the next
    write(draft(),"Крутой вайб: стиль и уход", "", "напиши статью про cool vibes");
    expect(calls[1].body.input.ask).toBe("напиши статью про cool vibes");
  });
});

describe("the chat assistant hands over the owner's own words", () => {
  it("draft_post leaves the route with the owner's last message on it", () => {
    const known = new Set<string>();
    const act = sanitizeAction({ type: "draft_post", topic: "Уход за волосами и укладка", lang: "RU" }, known, true);
    const out = draftPostWithAsk(act, "  напиши статью про   cool vibes  ") as { topic: string; ask: string };
    expect(out.topic).toBe("Уход за волосами и укладка");
    expect(out.ask).toBe("напиши статью про cool vibes");
  });

  it("a model cannot supply the «owner's words» itself, and other actions are left alone", () => {
    const act = sanitizeAction({ type: "draft_post", topic: "Борода зимой", ask: "придумано моделью" }, new Set(), true);
    expect(act).not.toHaveProperty("ask");
    expect(draftPostWithAsk({ type: "set_price", id: "x", value: 9 }, "поставь 9 €")).toEqual({ type: "set_price", id: "x", value: 9 });
    expect(draftPostWithAsk(null, "что-то")).toBeNull();
  });

  it("the route attaches them, and the prompt asks for the owner's subject, not a tidier one", () => {
    expect(routeSrc).toContain("draftPostWithAsk(");
    expect(routeSrc).toContain("the owner's OWN subject");
  });

  it("the panel passes them to the article generator", () => {
    expect(slice("startArticleFromAssistant")).toContain("admBlogWriteFull(S.adminBlogEdit, topic, a.hint || \"\", a.ask || \"\")");
  });
});

describe("the article generator is told the topic IS the subject", () => {
  const old = [{ id: "kevin-murphy-hair-resort", brand: "Kevin.Murphy", name: "Hair.Resort — спрей для укладки", category: "Стайлинг" }];

  it("a loose topic stays the subject — the products do not choose it", () => {
    const { system, user } = buildPostFullPrompt("RU", { topic: "cool vibes", products: old });
    expect(user).toContain("Topic: cool vibes");
    expect(system).toContain("THE SUBJECT");
    expect(system).toMatch(/never choose the subject/);
    expect(system).toMatch(/title names/i);
  });

  it("the owner's own request rides along and decides where it and the topic differ", () => {
    const { user } = buildPostFullPrompt("RU", { topic: "Крутой вайб", ask: "напиши статью про cool vibes" });
    expect(user).toContain("«напиши статью про cool vibes»");
    const plain = buildPostFullPrompt("RU", { topic: "Крутой вайб" }).user;
    expect(plain).not.toContain("word for word");
  });

  it("«Только план по теме» is held to the same subject", () => {
    const { system, user } = buildBlogOutlinePrompt("EN", { topic: "cool vibes" });
    expect(user).toContain("Topic: cool vibes");
    expect(system).toContain("THE SUBJECT");
  });
});
