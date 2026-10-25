/**
 * The tools Renat's Claude has in the «Rempire» connector (Dim, 20.10.2026:
 * Renat writes the blog in Claude — it should find the shop's own products
 * and their addresses, and put the article into the shop as a draft).
 *
 *   search_products · get_product · list_sections   — the shop as a shopper sees it
 *   list_posts · get_post                           — the blog, drafts included
 *   save_draft                                      — a new draft, or a change to one
 *   save_product_google_text                        — a product's Google title and description
 *
 * What it can NOT do is the point of the list: publish, unpublish, delete,
 * touch a published article, a price, a product's own text or an order. A
 * published article is changed in the admin, where its autosave goes live —
 * never from a chat in another product.
 *
 * The one live write is a product's Google pair (Dim, 25.10.2026: Renat's
 * panel button wrote «других сведений нет» into 29 of them, and he would
 * rather have his Claude write them). It is what a search result shows and
 * nothing a shopper reads on the page, it is checked the way the panel's own
 * answer is (length, language, no talk about missing data), and it lands in
 * the change journal as an ordinary product change with what it replaced —
 * «Вернуть» there puts the old pair back from any device.
 *
 * Every product a tool names comes from the shop's own data
 * (shopProducts() in src/lib/merchant-feed.ts — hidden ones are not there),
 * and save_draft holds an article to it: a link or a card for an id the
 * shop does not sell loses its link and keeps its words.
 */
import { BLOG_PRODUCTS_MAX, BlogError, BODY_MAX, getPostBySlug, listAllPosts, looksLikeHtmlBody, markdownToHtml, sanitizeHtml, upsertPost, type Post } from "@/lib/blog";
import { feedBase, loadFeedInput, shopProducts, type ShopProduct } from "@/lib/merchant-feed";
import { writeAuditSafe } from "@/lib/orders";
import { getSeoOverride, setSeoOverride, type SeoOverride } from "@/lib/product-seo";
import { seoDropMetaTalk, seoOffLanguage } from "@/lib/ai-prompts";
import { productUrls as pingUrls } from "@/lib/indexnow.mjs";
import { submitIndexNow } from "@/lib/indexnow-ping";
import { publicPath } from "@/lib/shop-paths.mjs";
import { catName, slugify } from "@/lib/seo-head.mjs";
import type { ToolDef, ToolResult } from "@/lib/mcp/protocol";

type L3 = "RU" | "ET" | "EN";
const LANGS3: L3[] = ["RU", "ET", "EN"];
const CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"];

/* ---------- the shop's products, read once a minute per instance ---------- */

let cache: { at: number; base: string; list: ShopProduct[] } | null = null;
const CACHE_MS = 60_000;

export async function productsNow(): Promise<{ base: string; list: ShopProduct[] }> {
  const base = feedBase(process.env.PUBLIC_BASE_URL);
  if (cache && cache.base === base && Date.now() - cache.at < CACHE_MS) return cache;
  const list = shopProducts(await loadFeedInput(), base);
  cache = { at: Date.now(), base, list };
  return cache;
}
/** Tests only: forget the minute's copy. */
export function resetProductCache(): void {
  cache = null;
}

const urlOf = (base: string, lang: L3, rest: string) => base + publicPath(lang, rest);
const productUrls = (base: string, id: string) =>
  ({ RU: urlOf(base, "RU", `/p/${id}`), ET: urlOf(base, "ET", `/p/${id}`), EN: urlOf(base, "EN", `/p/${id}`) });
const stockWord = (s: string) => (s === "out" ? "нет в наличии" : s === "low" ? "мало" : "в наличии");
const eur = (n: number) => n.toFixed(2).replace(".", ",") + " €";
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const searchKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ").trim();

function brief(base: string, p: ShopProduct) {
  return {
    id: p.id,
    brand: p.brand,
    name: p.names.RU,
    section: catName(p.cat, "RU"),
    price: p.sizes.length > 1
      ? p.sizes.map((s) => `${s.label ?? ""} ${eur(s.price)}`.trim()).join(" · ")
      : eur(p.sizes[0].price),
    stock: stockWord(p.stock),
    url: productUrls(base, p.id),
  };
}

/** The products whose brand, names, id or section carry every word of `q` — best first, those in stock before the rest. */
export function searchProducts(list: ShopProduct[], q: string, limit: number): ShopProduct[] {
  const words = searchKey(q).split(" ").filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored: Array<[number, ShopProduct]> = [];
  for (const p of list) {
    const hay = " " + searchKey([p.brand, p.names.RU, p.names.ET, p.names.EN, p.id, ...LANGS3.map((l) => catName(p.cat, l))].join(" ")) + " ";
    let hit = 0, whole = 0;
    for (const w of words) {
      if (hay.includes(w)) hit++;
      if (hay.includes(" " + w + " ")) whole++;
    }
    if (!hit) continue;
    const all = hit === words.length;
    scored.push([(all ? 100 : 0) + hit * 10 + whole * 3 + (p.stock === "out" ? 0 : 1), p]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  // every word, when anything carries every word; the near misses only when nothing does
  const best = scored.filter(([s]) => s >= 100);
  return (best.length ? best : scored).slice(0, limit).map(([, p]) => p);
}

/* ---------- the article body Claude writes, held to the shop ---------- */

const PRODUCT_HREF = /\bhref\s*=\s*(["'])(?:product:([a-z0-9][a-z0-9._-]*)|(?:https?:\/\/(?:www\.)?rempireshop\.com)?(?:\/(?:ru|et|en))?\/(?:products|p)\/([a-z0-9][a-z0-9._-]*)\/?)\1/gi;
const CARD = /<a data-product="([^"]*)"[^>]*>[\s\S]*?<\/a>/g;

/**
 * One language's article, as the shop stores it: markdown turned into HTML,
 * the blog's own allowlist, every link to a product page pointed at that
 * product in this language — or dropped when the shop does not sell it —
 * and every card rebuilt as the editor's own «Товар» marker (the name in
 * this language, `data-price="live"` for the price), or dropped.
 * Answers the HTML and the ids it now names, cards first, in their order.
 */
/* Read over the SANITISER's output only, never raw HTML: openTag() in
   src/lib/blog-html.mjs rebuilds every picture as exactly
   `<img src="…" alt="…" loading="lazy">` — src first, double quotes, the alt
   escaped — so this pattern matches that one shape and nothing a paste could
   dress up (security review, 20.10.2026). */
const IMG = /<img src="([^"]*)"[^>]*>/g;

/** Every photo of every product the shop shows — the only pictures an article from Claude may carry. */
export function shopPhotos(list: ShopProduct[]): Set<string> {
  return new Set(list.flatMap((p) => p.photos));
}

export function shopBody(raw: string, lang: L3, byId: Map<string, ShopProduct>, photos: Set<string> = new Set()): { html: string; ids: string[] } {
  const src = String(raw || "").trim();
  if (!src) return { html: "", ids: [] };
  const ids: string[] = [];
  const named = (id: string) => { if (!ids.includes(id)) ids.push(id); };
  const html = looksLikeHtmlBody(src) ? src : markdownToHtml(src);
  const linked = html.replace(PRODUCT_HREF, (_m, _q: string, a?: string, b?: string) => {
    const id = (a || b || "").toLowerCase();
    if (!byId.has(id)) return 'href=""';
    named(id);
    return `href="${publicPath(lang, "/p/" + id)}"`;
  });
  const clean = sanitizeHtml(linked);
  const carded = clean.replace(CARD, (_m, id: string) => {
    const p = byId.get(id);
    if (!p) return "";
    named(id);
    const words = `${p.brand} ${p.names[lang]}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<a data-product="${id}" data-price="live" href="${publicPath(lang, "/p/" + id)}">${words}</a>`;
  });
  /* Pictures: the shop's own product photos only (get_product lists them) —
     anything else, a stock photo or a picture from another site, is not
     something this shop may show, and goes; a figure left empty goes with it.
     The filter is the LAST step and reads the sanitiser's canonical output,
     which nothing re-parses afterwards: what it judged is what is stored. */
  const canonical = sanitizeHtml(carded);
  const pictured = canonical
    .replace(IMG, (tag, src: string) => (photos.has(src.replace(/&amp;/g, "&")) ? tag : ""))
    .replace(/<figure(?: data-fig="[a-z-]+")?>\s*<\/figure>/g, "");
  return { html: pictured.replace(/<p>\s*<\/p>/g, ""), ids };
}

/* ---------- the tools ---------- */

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const TOOLS: ToolDef[] = [
  {
    name: "search_products",
    title: "Найти товары магазина",
    description:
      "Search the Rempire shop's catalogue (rempireshop.com — hair, beard, styling, face, body care and fragrance). " +
      "Matches brand, product name (Russian, Estonian or English), id and section. Returns id, name, price, stock and the " +
      "product page address in Russian (RU), Estonian (ET) and English (EN). Use it before naming any product in an article — " +
      "only products found here exist in the shop.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for: a brand, a product name, a type («шампунь», «beard oil»)." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "How many to return, 12 by default." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ,
  },
  {
    name: "get_product",
    title: "Товар целиком",
    description:
      "One product of the shop by its id: names in RU/ET/EN, brand, section, every size with its price, stock, its photos " +
      "(addresses an article may use as its cover or as a picture in the text), " +
      "the page address in each language and the shop's own description texts — the facts to write from. Never invent " +
      "ingredients or effects the description does not state.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The product id from search_products." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: READ,
  },
  {
    name: "list_sections",
    title: "Разделы и бренды",
    description: "The shop's sections and brands with their page addresses in RU, ET and EN — for links to a whole section or brand.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
  },
  {
    name: "list_posts",
    title: "Статьи блога",
    description: "Every article of the shop's blog, newest first: address (slug), draft or published, Russian title, the public address of a published one.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
  },
  {
    name: "get_post",
    title: "Статья целиком",
    description: "One blog article by its slug: title, excerpt and text (HTML) in the language asked for (RU by default), its status and products.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        lang: { type: "string", enum: ["RU", "ET", "EN"] },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: READ,
  },
  {
    name: "save_product_google_text",
    title: "Записать Google-тексты товара",
    description:
      "Write a product's Google search texts — the title and the description Google shows for its page — in Russian (ru), " +
      "Estonian (et) and/or English (en). Read the product with get_product first and write from its description only: never " +
      "invent an effect, an ingredient or an audience it does not state. title: at most 60 characters — the brand, the maker's " +
      "product name exactly as get_product spells it, then what it is in that language («Kevin.Murphy Rough.Rider — глина для " +
      "укладки», «… — viimistlussavi», «… — styling clay»). description: at most 155 characters — what it is and whom it suits, " +
      "then the one thing that decides the purchase; no price, no «купить», no delivery promise, and never a sentence about " +
      "missing information. et and en are written in that language — a Russian word there is refused. Languages you leave out " +
      "keep their current text. It is saved at once and is live; each save is a line in Админка → Журнал with «Вернуть».",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The product id from search_products." },
        ru: { $ref: "#/$defs/pair" },
        et: { $ref: "#/$defs/pair" },
        en: { $ref: "#/$defs/pair" },
      },
      required: ["id"],
      additionalProperties: false,
      $defs: {
        pair: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 70 },
            description: { type: "string", maxLength: 170 },
          },
          required: ["title", "description"],
          additionalProperties: false,
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_draft",
    title: "Сохранить черновик статьи",
    description:
      "Save a blog article into the shop as a DRAFT — never published: the owner reads it in Админка → Блог, adds a cover and " +
      "publishes it himself. Without `slug` it creates a new draft; with the slug of an existing DRAFT it replaces the languages " +
      "you send and keeps everything else (cover, the languages you leave out). A published article cannot be changed here. " +
      "`ru` is required; `et` and `en` are optional translations — without them the owner translates in the editor with one button. " +
      "`body` is HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <br>, <a> (markdown is accepted too). " +
      "Link a product with the page address search_products gave for that language; put a product card on a line of its own as " +
      '<p><a data-product="ID"></a></p> right after the paragraph that recommends it. Links and cards for products the shop ' +
      "does not sell are dropped. Pictures: only the shop's own product photos (get_product → photos) — as `cover` (a product id " +
      'or one of its photo addresses), or in the text as <figure data-fig="full"><img src="PHOTO" alt="what it shows"></figure> ' +
      '(data-fig: full, half-left, half-right or small). Any other picture is dropped; the owner adds his own photos in the editor.',
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Only to change an existing draft — its slug from list_posts." },
        ru: { $ref: "#/$defs/lang" },
        et: { $ref: "#/$defs/lang" },
        en: { $ref: "#/$defs/lang" },
        tags: { type: "array", items: { type: "string" }, maxItems: 5, description: "3–5 short Russian tags." },
        cover: { type: "string", description: "The cover picture: a product id (its first photo) or one of the photo addresses get_product gave." },
        seo_title: { type: "string", maxLength: 70, description: "Russian Google title, at most 60 characters." },
        seo_description: { type: "string", maxLength: 170, description: "Russian Google description, at most 155 characters." },
      },
      required: ["ru"],
      additionalProperties: false,
      $defs: {
        lang: {
          type: "object",
          properties: {
            title: { type: "string" },
            excerpt: { type: "string", description: "One or two sentences for the blog list and search results." },
            body: { type: "string", description: "The article, HTML." },
          },
          required: ["title", "body"],
          additionalProperties: false,
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const INSTRUCTIONS =
  "This is the Rempire shop (rempireshop.com, Mardi 1, Tallinn — a barbershop's grooming shop). Use it to write the shop's " +
  "blog articles with the shop's real products. Before you name a product, find it with search_products and use its exact " +
  "name and page address; never link a product that search does not return. Write in Russian unless the owner asks otherwise. " +
  "Cosmetic effects only — no medical or treatment claims. When the owner is happy with an article, save it with save_draft: " +
  "it is saved as a draft and the owner publishes it in Админка → Блог. It also writes a product's Google texts " +
  "(save_product_google_text) — from the product's own description (get_product), checked and saved live, with «Вернуть» " +
  "in the admin's journal. Answer the owner in his language.";

const ok = (v: unknown): ToolResult => ({ text: JSON.stringify(v, null, 2) });
const no = (text: string): ToolResult => ({ text, isError: true });

function pick(t: Record<string, string> | undefined, l: L3): string {
  return (t && t[l]) || "";
}

/** The answer to one tool call. `who` is what the change journal says made it. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "search_products") {
    const q = typeof args.query === "string" ? args.query.slice(0, 200) : "";
    const limit = Math.max(1, Math.min(25, Math.floor(Number(args.limit) || 12)));
    const { base, list } = await productsNow();
    const found = searchProducts(list, q, limit);
    if (!found.length) return ok({ found: 0, products: [], hint: "Nothing matches every word — try the brand alone, or fewer words." });
    return ok({ found: found.length, products: found.map((p) => brief(base, p)) });
  }

  if (name === "get_product") {
    const id = typeof args.id === "string" ? args.id.trim().toLowerCase() : "";
    const { base, list } = await productsNow();
    const p = list.find((x) => x.id === id);
    if (!p) return no(`No product «${id}» in the shop — find it with search_products first.`);
    return ok({
      id: p.id,
      brand: p.brand,
      names: p.names,
      section: { RU: catName(p.cat, "RU"), ET: catName(p.cat, "ET"), EN: catName(p.cat, "EN") },
      sizes: p.sizes.map((s) => ({ size: s.label, price: eur(s.price) })),
      stock: stockWord(p.stock),
      photos: p.photos,
      url: productUrls(base, p.id),
      description: Object.fromEntries(Object.entries(p.texts).map(([l, t]) => [l, plain(String(t)).slice(0, 1500)])),
      /* what the owner wrote for Google, when anything — save_product_google_text changes it */
      google_text: googleOut(await getSeoOverride(p.id)),
    });
  }

  if (name === "list_sections") {
    const { base, list } = await productsNow();
    const brands = [...new Set(list.map((p) => p.brand))].sort((a, b) => a.localeCompare(b));
    return ok({
      sections: CATS.map((c) => ({
        id: c,
        name: { RU: catName(c, "RU"), ET: catName(c, "ET"), EN: catName(c, "EN") },
        url: { RU: urlOf(base, "RU", `/c/${c}`), ET: urlOf(base, "ET", `/c/${c}`), EN: urlOf(base, "EN", `/c/${c}`) },
      })),
      brands: brands.map((b) => ({
        name: b,
        url: { RU: urlOf(base, "RU", `/b/${slugify(b)}/`), ET: urlOf(base, "ET", `/b/${slugify(b)}/`), EN: urlOf(base, "EN", `/b/${slugify(b)}/`) },
      })),
    });
  }

  if (name === "list_posts") {
    const { base } = await productsNow();
    const posts = await listAllPosts(100);
    return ok(posts.map((p) => ({
      slug: p.slug,
      status: p.status,
      title: p.title.RU || p.title.ET || p.title.EN,
      ...(p.status === "published" ? { url: urlOf(base, "RU", `/blog/${p.slug}`) } : {}),
      updated: p.updatedAt,
    })));
  }

  if (name === "get_post") {
    const slug = typeof args.slug === "string" ? args.slug.trim().toLowerCase() : "";
    const lang: L3 = args.lang === "ET" || args.lang === "EN" ? args.lang : "RU";
    const post = slug ? await getPostBySlug(slug) : null;
    if (!post) return no(`No article «${slug}» — see list_posts.`);
    return ok({
      slug: post.slug,
      status: post.status,
      lang,
      title: pick(post.title, lang),
      excerpt: pick(post.excerpt, lang),
      body: pick(post.body, lang),
      written_in: LANGS3.filter((l) => pick(post.body, l)),
      products: post.products,
    });
  }

  if (name === "save_draft") return saveDraft(args);
  if (name === "save_product_google_text") return saveProductGoogleText(args);
  return no(`Unknown tool «${name}».`);
}

/* ---------- a product's Google pair ---------- */

const GOOGLE_TITLE_MAX = 70;   // the panel's field; the tool asks for 60
const GOOGLE_DESC_MAX = 170;   // the panel's field; the tool asks for 155

/** The stored shape ({RU:{title,desc}}) as the tool speaks it ({ru:{title,description}}); null when nothing is written. */
function googleOut(seo: SeoOverride | null): Record<string, { title: string; description: string }> | null {
  if (!seo) return null;
  const out: Record<string, { title: string; description: string }> = {};
  for (const l of LANGS3) {
    const pair = seo[l];
    if (pair && (pair.title || pair.desc)) out[l.toLowerCase()] = { title: pair.title ?? "", description: pair.desc ?? "" };
  }
  return Object.keys(out).length ? out : null;
}

async function saveProductGoogleText(args: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof args.id === "string" ? args.id.trim().toLowerCase() : "";
  const { list } = await productsNow();
  const p = list.find((x) => x.id === id);
  if (!p) return no(`No product «${id}» in the shop — find it with search_products first. Nothing was saved.`);

  const given: Partial<Record<L3, { title: string; desc: string }>> = {};
  for (const l of LANGS3) {
    const v = args[l.toLowerCase()];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const src = v as Record<string, unknown>;
    const title = typeof src.title === "string" ? src.title.replace(/\s+/g, " ").trim() : "";
    const desc = typeof src.description === "string" ? src.description.replace(/\s+/g, " ").trim() : "";
    if (!title || !desc) return no(`${l}: both a title and a description, please. Nothing was saved.`);
    if (title.length > GOOGLE_TITLE_MAX) return no(`${l} title is ${title.length} characters — at most 60 (Google cuts the rest). Nothing was saved.`);
    if (desc.length > GOOGLE_DESC_MAX) return no(`${l} description is ${desc.length} characters — at most 155 (Google cuts the rest). Nothing was saved.`);
    /* the panel's own net (src/lib/ai-prompts.ts): a sentence about missing
       data is not a description */
    if (seoDropMetaTalk(desc) !== desc) {
      return no(`The ${l} description talks about missing information («${desc.slice(0, 90)}») — write about the product from its description instead. Nothing was saved.`);
    }
    if (seoOffLanguage(`${title}\n${desc}`, l, { name: p.names.RU, brand: p.brand })) {
      return no(`The ${l} texts still have Russian words in them — write every word in ${l === "ET" ? "Estonian" : "English"} except the brand and the maker's product name. Nothing was saved.`);
    }
    given[l] = { title, desc };
  }
  if (!Object.keys(given).length) return no("Send at least one of ru, et, en with a title and a description. Nothing was saved.");

  const was = await getSeoOverride(p.id);
  const next: SeoOverride = { ...(was ?? {}) };
  for (const l of LANGS3) if (given[l]) next[l] = given[l];
  const saved = await setSeoOverride(p.id, next);
  /* An ordinary product change in the journal, with the pair it replaced:
     «Вернуть» there sends {seo: <old>} back through PUT /api/admin/overrides
     (src/lib/audit-undo.ts) — on any device, like the panel's own edits. */
  await writeAuditSafe("admin", "override.set", { id: p.id, patch: { seo: saved }, via: "claude" }, { before: { seo: was ?? null } });
  submitIndexNow(pingUrls(p.id));
  return ok({
    saved: LANGS3.filter((l) => given[l]).map((l) => l.toLowerCase()),
    product: `${p.brand} ${p.names.RU}`,
    google_text: googleOut(saved),
    next: "Live now (search engines re-read the page in their own time). The owner sees it in Админка → Товары → this product → «Для Google», " +
      "and «Вернуть» on its line in Админка → Журнал puts the old texts back.",
  });
}

type LangIn = { title?: unknown; excerpt?: unknown; body?: unknown };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function saveDraft(args: Record<string, unknown>): Promise<ToolResult> {
  const given: Partial<Record<L3, LangIn>> = {};
  for (const l of LANGS3) {
    const v = args[l.toLowerCase()];
    if (v && typeof v === "object" && !Array.isArray(v)) given[l] = v as LangIn;
  }
  if (!given.RU || !text(given.RU.title, 200) || !text(given.RU.body, BODY_MAX * 2)) {
    return no("`ru` needs a title and a body — the Russian article is the one the shop keeps first.");
  }

  const slug = typeof args.slug === "string" ? args.slug.trim().toLowerCase() : "";
  let was: Post | null = null;
  if (slug) {
    was = await getPostBySlug(slug);
    if (!was) return no(`No article «${slug}» — leave slug out to make a new draft.`);
    if (was.status === "published") {
      return no(`«${slug}» is published — it is changed in Админка → Блог, not from here (every change there is live at once). ` +
        "Save the new version as a NEW draft instead, without slug, or ask the owner to unpublish it first.");
    }
  }

  const { base, list } = await productsNow();
  const byId = new Map(list.map((p) => [p.id, p]));
  const photos = shopPhotos(list);
  /* The cover: a product's first photo by its id, or one of the shop's own
     photo addresses; anything else is refused rather than quietly dropped, so
     Claude can tell the owner the picture did not go in. */
  let coverUrl: string | null = was?.coverUrl ?? null;
  let coverNew = false;
  const coverAsk = typeof args.cover === "string" ? args.cover.trim() : "";
  if (coverAsk) {
    const byProduct = byId.get(coverAsk.toLowerCase())?.photo ?? null;
    const url = byProduct ?? (photos.has(coverAsk) ? coverAsk : null);
    if (!url) return no(`The cover must be a product id or one of the photo addresses get_product gave — «${coverAsk.slice(0, 120)}» is neither. Nothing was saved.`);
    coverNew = url !== coverUrl;
    coverUrl = url;
  }
  const title = { RU: "", ET: "", EN: "" }, excerpt = { RU: "", ET: "", EN: "" }, body = { RU: "", ET: "", EN: "" };
  const named: string[] = [];
  for (const l of LANGS3) {
    const g = given[l];
    if (g && text(g.title, 200) && text(g.body, BODY_MAX * 2)) {
      const shaped = shopBody(text(g.body, BODY_MAX * 2), l, byId, photos);
      if (shaped.html.length > BODY_MAX) return no(`The ${l} text is too long for the shop (${shaped.html.length} characters, at most ${BODY_MAX}). Shorten it.`);
      title[l] = text(g.title, 200);
      excerpt[l] = text(g.excerpt, 500);
      body[l] = shaped.html;
      for (const id of shaped.ids) if (!named.includes(id)) named.push(id);
    } else if (was) {
      // a language not sent keeps what the draft had
      title[l] = pick(was.title, l);
      excerpt[l] = pick(was.excerpt, l);
      body[l] = pick(was.body, l);
    }
  }
  const products = [...(was?.products ?? [])];
  for (const id of named) if (!products.includes(id) && products.length < BLOG_PRODUCTS_MAX) products.push(id);
  const tags = Array.isArray(args.tags) ? args.tags.map((t) => text(t, 30)).filter(Boolean).slice(0, 5) : was?.tags ?? [];
  const seoTitle = { ...(was?.seoTitle ?? { RU: "", ET: "", EN: "" }) };
  const seoDesc = { ...(was?.seoDesc ?? { RU: "", ET: "", EN: "" }) };
  if (text(args.seo_title, 70)) seoTitle.RU = text(args.seo_title, 70);
  if (text(args.seo_description, 170)) seoDesc.RU = text(args.seo_description, 170);

  let saved: Post;
  try {
    saved = await upsertPost({
      ...(was ? { id: was.id, slug: was.slug } : {}),
      title, excerpt, body, products, tags, seoTitle, seoDesc,
      coverUrl,
      coverAlt: was?.coverAlt,
      // a new picture starts from the middle; the point chosen for the old one belonged to it
      coverFocus: coverNew ? null : was?.coverFocus ?? null,
      tagsI18n: was?.tagsI18n,
      author: was?.author ?? "Rempire",
    }, { onlyDraft: true }); // held in the write too: published in the admin meanwhile is still refused
  } catch (e) {
    if (e instanceof BlogError && (e.code === "not_draft" || e.code === "not_found")) {
      return no(`«${slug}» is no longer a draft — it was published or deleted in the admin just now. Nothing was changed. Save the new version without slug to make a new draft.`);
    }
    if (e instanceof BlogError && e.code === "body_too_long") return no("The text is too long for the shop — shorten it.");
    throw e;
  }
  await writeAuditSafe("admin", "mcp.save_draft", { slug: saved.slug, created: !was, langs: LANGS3.filter((l) => given[l]), products: products.length });
  const dropped = LANGS3.filter((l) => given[l] && !body[l]);
  return ok({
    saved: was ? "changed" : "created",
    status: "draft",
    slug: saved.slug,
    languages: LANGS3.filter((l) => body[l]),
    cover: coverUrl ? "set" : "none — the owner adds one in the editor",
    products: products.map((id) => byId.get(id) ? `${byId.get(id)!.brand} ${byId.get(id)!.names.RU}` : id),
    ...(dropped.length ? { not_saved: dropped } : {}),
    admin: base + "/admin",
    next: "The draft is in Админка → Блог (the list refreshes within half a minute). The owner opens it, checks it" +
      (coverUrl ? "" : ", adds a cover photo") + " and presses «Опубликовать»" +
      (body.ET && body.EN ? "." : "; the missing languages are one button there: «Перевести на ET и EN»."),
  });
}
