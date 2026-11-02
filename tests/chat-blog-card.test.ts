/**
 * «Из нашего блога» — the article card the shop chat draws above the products
 * of an answer built on one of the salon's articles (public/shop2/chat.js
 * articleCard; Dim, 02.11.2026). The route only ever sends a published
 * article's slug, title and cover (articleOfAnswer in
 * src/app/api/assistant/blog-digest.ts), and the card checks them again
 * anyway: what goes into innerHTML here is the widget's own markup and
 * escaped words, never something the response could smuggle in.
 *
 * The functions are cut out of chat.js by brace matching and run against the
 * file's own string table T, the way tests/i18n-audit-r21.test.ts runs
 * reply() and paintPanel(); the drawn card in a real browser is
 * e2e/chatbot.spec.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const chat = readFileSync(fileURLToPath(new URL("../public/shop2/chat.js", import.meta.url)), "utf8");

/** `<head> { … }` cut out by brace matching. */
function block(head: string): string {
  const start = chat.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/chat.js no longer has ${head}`);
  let depth = 0;
  for (let i = chat.indexOf("{", start); i < chat.length; i++) {
    if (chat[i] === "{") depth++;
    else if (chat[i] === "}" && --depth === 0) return chat.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${head}`);
}
/** One `var NAME = …;` line. */
function line(name: string): string {
  const m = new RegExp(`var ${name} = [^\\n]*;`).exec(chat);
  if (!m) throw new Error(`public/shop2/chat.js no longer has var ${name}`);
  return m[0];
}

type Card = { articleCard: (a: unknown, link?: boolean) => string; addAllButton: (items: unknown[]) => string; T: Record<string, Record<string, unknown>>; setLang: (l: string) => void };
const h = new Function(`
  var LANG = "RU";
  function lang() { return LANG; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  ${block("var T = {")};
  function tt() { return T[lang()] || T.RU; }
  function inStock(p) { return p.stock !== "out"; }
  ${line("BLOG_SEG")}
  ${line("ART_SLUG")}
  ${block("function safeCover(")}
  ${block("function articleCard(")}
  ${block("function addAllButton(")}
  return { articleCard: articleCard, addAllButton: addAllButton, T: T, setLang: function (l) { LANG = l; } };
`)() as Card;

const A = { slug: "uhod-za-borodoy-zimoy", title: "Борода зимой", cover: "https://img.rempireshop.com/blog/1-beard.webp" };

describe("the article card (chat.js articleCard)", () => {
  it("links the article in the shopper's language, the shop's own way, eyebrow and title on it", () => {
    h.setLang("RU");
    const ru = h.articleCard(A);
    expect(ru).toContain('href="/ru/blogs/news/uhod-za-borodoy-zimoy"');
    expect(ru).toContain('data-go-blog="uhod-za-borodoy-zimoy"');
    expect(ru).toContain(">Из нашего блога<");
    expect(ru).toContain(">Борода зимой<");
    expect(ru).toContain('<img class="sbot__art-ph" src="https://img.rempireshop.com/blog/1-beard.webp" alt=""');

    h.setLang("ET");
    const et = h.articleCard({ ...A, title: "Habe talvel" });
    expect(et).toContain('href="/et/blogs/news/uhod-za-borodoy-zimoy"');
    expect(et).toContain(">Meie blogist<");

    h.setLang("EN");
    const en = h.articleCard({ ...A, title: "A beard in winter" });
    expect(en).toContain('href="/blogs/news/uhod-za-borodoy-zimoy"');
    expect(en).toContain(">From our blog<");
    h.setLang("RU");
  });

  it("escapes the title and refuses anything that is not a slug", () => {
    expect(h.articleCard({ ...A, title: '<img src=x onerror="alert(1)">' })).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;>");
    expect(h.articleCard({ ...A, slug: 'x" onclick="alert(1)' })).toBe("");
    expect(h.articleCard({ ...A, slug: "../admin" })).toBe("");
    expect(h.articleCard(null)).toBe("");
    expect(h.articleCard("uhod-za-borodoy-zimoy")).toBe("");
  });

  it("shows a cover only from a plain http(s) or same-site address — no picture rather than a wrong one", () => {
    expect(h.articleCard({ ...A, cover: "/shop/img/night-rider-0.webp" })).toContain('src="/shop/img/night-rider-0.webp"');
    for (const bad of ["javascript:alert(1)", "//evil.example/x.webp", 'https://x/a.webp" onerror="alert(1)', "data:image/png;base64,AAAA", null, 42]) {
      const card = h.articleCard({ ...A, cover: bad });
      expect(card, String(bad)).not.toContain("<img");
      expect(card).toContain(">Борода зимой<");
    }
  });

  it("falls back to the slug when the title is missing, and draws a plain box when it must not link", () => {
    expect(h.articleCard({ slug: A.slug })).toContain(">uhod-za-borodoy-zimoy<");
    const box = h.articleCard(A, false);
    expect(box.startsWith('<div class="sbot__art">')).toBe(true);
    expect(box).not.toContain("href=");
  });
});

describe("«Добавить всё в корзину» under an article's products (chat.js addAllButton)", () => {
  it("adds every product in stock, and is not drawn for fewer than two", () => {
    const btn = h.addAllButton([{ id: "a", stock: "in" }, { id: "b", stock: "low" }, { id: "c", stock: "out" }]);
    expect(btn).toContain('data-addall="a,b"');
    expect(btn).toContain(">Добавить всё в корзину<");
    expect(h.addAllButton([{ id: "a", stock: "in" }, { id: "c", stock: "out" }])).toBe("");
    expect(h.addAllButton([])).toBe("");
  });
});

describe("the words, in all three languages", () => {
  it("has the eyebrow and the pinned-article line in Russian, Estonian and English", () => {
    for (const k of ["fromBlog", "askAbout"]) {
      const [ru, et, en] = (["RU", "ET", "EN"] as const).map((l) => h.T[l][k]);
      for (const v of [ru, et, en]) expect(typeof v === "string" && v.trim().length > 3, k).toBe(true);
      expect(et, `${k}: ET is the Russian copied`).not.toBe(ru);
      expect(en, `${k}: EN is the Russian copied`).not.toBe(ru);
      expect(String(et) + String(en)).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});

describe("window.openChatAbout — the door the blog article page opens the chat through", () => {
  it("is published by chat.js, pins the slug, and sends it with every question", () => {
    expect(chat).toMatch(/window\.openChatAbout = function \(slug, title\)/);
    expect(chat).toMatch(/if \(pinned\) ask\.article = pinned\.slug;/);
  });
});
