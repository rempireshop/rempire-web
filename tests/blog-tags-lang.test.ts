/**
 * An article's tags in the language of its page — verification pass on
 * staging, 25.09.2026: the Estonian article showed Russian tag chips («лето»,
 * «уход за волосами», «летний образ»).
 *
 * `tags` was one text[] per post, written in Russian, and every page in every
 * language printed it. The article's translation even came back with Estonian
 * tags (post_translate keeps only tags written in the language) and the panel
 * dropped them. Now:
 *
 *   · `tags` is the Russian set, as before; `tagsI18n` {ET, EN} the other two
 *     (db/migrations/209_blog_tags_i18n.sql), cleaned in upsertPost — a
 *     Cyrillic word is not an Estonian tag — and kept by a save that does not
 *     carry them;
 *   · pickTags() (src/lib/seo-head.mjs) chooses for a page: the language's own
 *     set, else only the Russian set's non-Russian words — never a Russian chip;
 *     both public routes, the request-time page and the build use it;
 *   · the panel keeps one set per language: the tags box follows the language
 *     tab, the article's translation fills the ET/EN set, and a save sends them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { getPostById, publishPost, upsertPost } from "@/lib/blog";
import { exec } from "@/lib/db";
import { pickTags } from "@/lib/seo-head.mjs";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const LIVE = "https://rempireshop.com";
const CYR = /[а-яё]/i;

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
function slice(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

const POST = {
  title: { RU: "Летний образ: уход и стиль", ET: "Suvine välimus: hooldus ja stiil", EN: "Summer look: care and style" },
  excerpt: { RU: "Коротко.", ET: "Lühidalt.", EN: "In short." },
  body: { RU: "<p>Текст.</p>", ET: "<p>Tekst.</p>", EN: "<p>Text.</p>" },
  tags: ["лето", "уход за волосами", "летний образ"],
};

describe("pickTags — the set a page in that language shows", () => {
  it("each language its own set; Russian keeps the Russian one", () => {
    const i18n = { ET: ["suvi", "juuksehooldus"], EN: ["summer", "hair care"] };
    expect(pickTags(POST.tags, i18n, "RU")).toEqual(POST.tags);
    expect(pickTags(POST.tags, i18n, "ET")).toEqual(["suvi", "juuksehooldus"]);
    expect(pickTags(POST.tags, i18n, "EN")).toEqual(["summer", "hair care"]);
  });

  it("a language without a set of its own shows no Russian chip — only a word every language shares, a brand", () => {
    expect(pickTags(POST.tags, {}, "ET")).toEqual([]);
    expect(pickTags(["борода", "proraso", "зима"], null, "EN")).toEqual(["proraso"]);
    // …and a Russian word that got into an Estonian set by hand is still not shown there
    expect(pickTags(POST.tags, { ET: ["лето", "suvi"] }, "ET")).toEqual(["suvi"]);
  });
});

describe("stored per language, shown per language", () => {
  const savedSecret = process.env.SESSION_SECRET;
  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = LIVE;
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(async () => {
    await teardownDb();
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  });
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await exec("truncate posts, custom_products restart identity cascade");
  });

  it("upsertPost keeps the Estonian and English sets, drops a Russian word from them, and a save without them keeps them", async () => {
    const post = await upsertPost({ ...POST, tagsI18n: { ET: ["suvi", "лето", "juuksehooldus"], EN: ["summer"] } });
    expect(post.tags).toEqual(POST.tags);
    expect(post.tagsI18n).toEqual({ ET: ["suvi", "juuksehooldus"], EN: ["summer"] });
    // a cover-only PATCH of the panel's (blogPatchCover) carries no tagsI18n — the sets stay
    const again = await upsertPost({ ...POST, id: post.id, coverUrl: "/shop/img/night-rider-0.webp" });
    expect(again.tagsI18n).toEqual({ ET: ["suvi", "juuksehooldus"], EN: ["summer"] });
    // …and an empty set sent on purpose empties it
    const cleared = await upsertPost({ ...POST, id: post.id, tagsI18n: { ET: [], EN: ["summer"] } });
    expect(cleared.tagsI18n).toEqual({ ET: [], EN: ["summer"] });
    expect((await getPostById(post.id))!.tagsI18n).toEqual({ ET: [], EN: ["summer"] });
  });

  it("the admin route saves what the panel sends", async () => {
    const { POST: create, PATCH } = await import("@/app/api/admin/blog/route");
    const cookie = `${ADMIN_COOKIE}=${makeSessionToken()}`;
    const send = (method: string, body: unknown) => new Request(`${LIVE}/api/admin/blog/`, {
      method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
    });
    const made = await (await create(send("POST", { ...POST, tagsI18n: { ET: ["suvi"], EN: ["summer"] } }))).json();
    expect(made.post.tagsI18n).toEqual({ ET: ["suvi"], EN: ["summer"] });
    const edited = await (await PATCH(send("PATCH", { id: made.post.id, ...POST, tagsI18n: { ET: ["suvi", "stiil"], EN: ["summer"] } }))).json();
    expect(edited.post.tagsI18n.ET).toEqual(["suvi", "stiil"]);
  });

  it("both public routes answer the set of the language asked — and no Russian chip where there is none", async () => {
    const withSets = (await publishPost((await upsertPost({ ...POST, tagsI18n: { ET: ["suvi", "juuksehooldus"], EN: ["summer"] } })).id))!;
    const without = (await publishPost((await upsertPost({ ...POST, title: { RU: "Старая статья", ET: "Vana artikkel", EN: "Old article" } })).id))!;
    const list = await import("@/app/api/blog/route");
    const one = await import("@/app/api/blog/[slug]/route");
    for (const [lang, want] of [["RU", POST.tags], ["ET", ["suvi", "juuksehooldus"]], ["EN", ["summer"]]] as const) {
      const body = await (await list.GET(new Request(`${LIVE}/api/blog/?lang=${lang}`))).json();
      const byslug = (s: string) => (body.posts as Array<{ slug: string; tags: string[] }>).find((p) => p.slug === s)!;
      expect(byslug(withSets.slug).tags, lang).toEqual(want);
      const post = await (await one.GET(new Request(`${LIVE}/api/blog/${withSets.slug}/?lang=${lang}`), { params: Promise.resolve({ slug: withSets.slug }) })).json();
      expect(post.post.tags, lang).toEqual(want);
      if (lang !== "RU") expect(byslug(without.slug).tags, `${lang}: an article with Russian tags only`).toEqual([]);
    }
  });

  it("the Estonian article page at request time prints Estonian chips, and its snapshot carries them", async () => {
    const post = (await publishPost((await upsertPost({ ...POST, tagsI18n: { ET: ["suvi", "juuksehooldus"], EN: ["summer"] } })).id))!;
    const bare = (await publishPost((await upsertPost({ ...POST, title: { RU: "Без переводов тегов", ET: "Ilma siltideta", EN: "No tags" } })).id))!;
    const et = await import("@/app/shop2/et/blog/[slug]/route");
    const page = async (slug: string) =>
      (await et.GET(new Request(`${LIVE}/shop2/et/blog/${slug}/`), { params: Promise.resolve({ slug }) })).text();
    const html = await page(post.slug);
    const chips = (html.match(/<ul class="blog__tags">([\s\S]*?)<\/ul>/) || [])[1] ?? "";
    expect(chips).toBe("<li>suvi</li><li>juuksehooldus</li>");
    const snap = JSON.parse((html.match(/<script type="application\/json" id="blogpost">([\s\S]*?)<\/script>/) || [])[1] ?? "{}");
    expect(snap.post.tags).toEqual(["suvi", "juuksehooldus"]);
    const list = JSON.parse((html.match(/<script type="application\/json" id="blogdata">([\s\S]*?)<\/script>/) || [])[1] ?? "{}");
    for (const p of list.posts as Array<{ tags: string[] }>) expect(p.tags.join(" "), "a Russian chip in the Estonian list snapshot").not.toMatch(CYR);
    // an article whose tags were never translated: no chips at all, rather than Russian ones
    expect(await page(bare.slug)).not.toContain('<ul class="blog__tags">');
  });
});

describe("the panel keeps one tag set per language", () => {
  it("a new draft and an opened post carry the Estonian and English sets, and a save sends them", () => {
    const fns = new Function(
      "BLOG_EMPTY3", "blogBody3ToHtml",
      `${slice("blogNewDraft")}\n${slice("blogDraftFromPost")}\n${slice("blogFieldsPayload")}\nreturn { fresh: blogNewDraft, open: blogDraftFromPost, payload: blogFieldsPayload };`,
    )({ RU: "", ET: "", EN: "" }, (b: unknown) => b) as {
      fresh: () => Record<string, unknown>; open: (p: unknown) => Record<string, unknown>; payload: (d: unknown) => Record<string, unknown>;
    };
    expect(fns.fresh().tagsI18n).toEqual({ ET: "", EN: "" });
    const d = fns.open({ id: "1", slug: "s", status: "draft", title: POST.title, excerpt: POST.excerpt, body: POST.body, tags: POST.tags, tagsI18n: { ET: ["suvi", "stiil"], EN: [] }, products: [] });
    expect(d.tagsText).toBe("лето, уход за волосами, летний образ");
    expect(d.tagsI18n).toEqual({ ET: "suvi, stiil", EN: "" });
    const out = fns.payload(d);
    expect(out.tags).toEqual(POST.tags);
    expect(out.tagsI18n).toEqual({ ET: ["suvi", "stiil"], EN: [] });
  });

  it("the tags box writes into the language on the tab — the Estonian box into the Estonian set", () => {
    const d: Record<string, unknown> = { title: { RU: "", ET: "", EN: "" }, tagsText: "лето", tagsI18n: { ET: "", EN: "" }, body: { RU: "", ET: "", EN: "" } };
    const tagsBox = { value: "suvi, stiil", dataset: { blogl: "ET" } };
    const read = new Function(
      "S", "document", "blogBox", "blogBoxLang", "blogBoxHtml",
      `${slice("blogFieldLang")}\n${slice("blogReadForm")}\nreturn blogReadForm;`,
    )(
      { adminBlogEdit: d, adminTab: "blog" },
      { querySelectorAll: () => [], querySelector: (s: string) => (s === "[data-blogtags]" ? tagsBox : null) },
      () => null, () => "", () => "",
    ) as () => void;
    read();
    expect(d.tagsText, "the Estonian box wrote over the Russian tags").toBe("лето");
    expect(d.tagsI18n).toEqual({ ET: "suvi, stiil", EN: "" });
  });

  it("the article's translation keeps the tags it came back with, in their language", async () => {
    const d = {
      title: { RU: "Летний образ", ET: "", EN: "" }, excerpt: { RU: "", ET: "", EN: "" }, body: { RU: "<p>x</p>", ET: "", EN: "" },
      seoTitle: { RU: "", ET: "", EN: "" }, seoDesc: { RU: "", ET: "", EN: "" }, tagsText: "лето", tagsI18n: { ET: "", EN: "" }, products: [],
    };
    const translate = new Function(
      "apiSend", "productsById", "blogCardsOut", "blogFigsOut", "blogFigsIn", "blogCardsIn", "blogCleanHtml", "blogTags", "txt", "blogGenErrText",
      `${slice("blogGenTranslate")}\nreturn blogGenTranslate;`,
    )(
      async () => ({ status: 200, body: { ok: true, text: { title: "Suvine välimus", body: "<p>y</p>", tags: ["suvi", "stiil"] } } }),
      () => [], (h: string) => ({ html: h, cards: [] }), (h: string) => ({ html: h, figs: [] }), (h: string) => h, (h: string) => h, (h: string) => h,
      () => ["лето"], (v: unknown) => (typeof v === "string" ? v : ""), () => "x",
    ) as (d: unknown, L: string) => Promise<void>;
    await translate(d, "ET");
    expect(d.title.ET).toBe("Suvine välimus");
    expect(d.tagsI18n.ET).toBe("suvi, stiil");
    expect(d.tagsText, "the Russian tags were touched").toBe("лето");
  });
});
