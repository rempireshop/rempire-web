/**
 * The tools Renat's Claude has in the «Rempire» connector (Dim, 20.10.2026:
 * Renat writes the blog in Claude — it should find the shop's own products
 * and their addresses, and put the article into the shop as a draft).
 *
 *   search_products · get_product · list_sections   — the shop as a shopper sees it
 *   list_posts · get_post                           — the blog, drafts included
 *   save_draft                                      — a new draft, or a change to one
 *   save_product_google_text                        — a product's Google title and description
 *   save_product_description                        — the text on a product's page
 *   save_product_name                               — a product's name, brand and section
 *   save_product_price                              — its prices, a big change only once confirmed
 *   save_product_stock                              — a count on the shelf, only over the count it read
 *
 * What it can NOT do is the point of the list: publish, unpublish, delete,
 * touch a published article, an order or a customer. A published article is
 * changed in the admin, where its autosave goes live — never from a chat in
 * another product.
 *
 * The live writes are a product's words (Dim, 25–26.10.2026: Renat's panel
 * button wrote «других сведений нет» into 29 Google texts and he would rather
 * have his Claude write them; then «he needs to be able to manage his shop» —
 * the page text and the name too). Each is checked the way the panel checks
 * it (length, language, no talk about missing data, a name every language can
 * say), is written where the panel writes it — a catalogue product's into
 * product_overrides, the owner's own («c-…») onto its own row — and lands in
 * the change journal with what it replaced: «Вернуть» there puts it back from
 * any device (src/lib/audit-undo.ts).
 *
 * Prices and counts (Dim, 26.10.2026: «if he can do it through his Claude
 * that would make it much easier»). A price that moves more than 30 % is
 * refused until Claude sends it again with `confirm` — after asking the
 * owner — because a typo there is money; a count is set only over the count
 * Claude read (`was`), because a sale or a scan in between would otherwise
 * be wiped by «осталось 6».
 *
 * Every product a tool names comes from the shop's own data
 * (shopProducts() in src/lib/merchant-feed.ts — hidden ones are not there),
 * and save_draft holds an article to it: a link or a card for an id the
 * shop does not sell loses its link and keeps its words.
 */
import { BLOG_PRODUCTS_MAX, BlogError, BODY_MAX, getPostBySlug, listAllPosts, looksLikeHtmlBody, markdownToHtml, sanitizeHtml, upsertPost, type Post } from "@/lib/blog";
import { feedBase, loadFeedInput, shopProducts, type ShopProduct } from "@/lib/merchant-feed";
import { getOverrideRow, upsertOverride, writeAuditSafe, type Override } from "@/lib/orders";
import { getSeoOverride, setSeoOverride, type SeoOverride } from "@/lib/product-seo";
import { getDescriptionOverride, setDescriptionOverride, type DescriptionOverride } from "@/lib/product-descriptions";
import { getLevel, InventoryError, setQty, shelfCount, shelfKey } from "@/lib/inventory";
import {
  CustomProductError, getCustomProduct, isCustomId, MAX_BRAND, MAX_NAME, ownPrev, PRICE_MAX, PRICE_MIN, PRODUCT_CATS,
  updateCustomProduct,
  type CustomProduct,
} from "@/lib/custom-products";
import { nameTranslatable, TRANSLATABLE_TAILS, translateProductName } from "@/lib/product-name";
import { requestRebuild } from "@/lib/rebuild";
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
/** A page text as plain text with its paragraphs and list lines kept — the shape save_product_description takes back. */
const paragraphs = (html: string) => html
  .replace(/<li[^>]*>/gi, "\n— ")
  .replace(/<\/(p|ul|ol|h[1-6]|div)>|<br\s*\/?>/gi, "\n\n")
  .split(/\n{2,}/)
  .map((block) => block.split("\n").map(plain).filter(Boolean).join("\n"))
  .filter(Boolean)
  .join("\n\n");
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
    name: "save_product_description",
    title: "Записать описание товара",
    description:
      "Write the description on a product's page — the text a shopper reads under the price — in Russian (ru), Estonian (et) " +
      "and/or English (en). Read the product with get_product first. Plain text only: the page shows every character as " +
      "typed, so no HTML and no markdown (**, #, * lists); paragraphs are separated by an empty line, a list is lines " +
      "starting with «— ». At most 4000 characters per language. Cosmetic effects only — no medical claims — and never " +
      "invent an ingredient or an effect the owner did not give you. et and en are written in that language — a Russian " +
      "word there is refused. When the Russian text changes in substance, send all three, or the other languages go on " +
      "saying the old thing. Languages you leave out keep their current text. It is saved at once and is live; each save " +
      "is a line in Админка → Журнал with «Вернуть».",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The product id from search_products." },
        ru: { type: "string", maxLength: 4000 },
        et: { type: "string", maxLength: 4000 },
        en: { type: "string", maxLength: 4000 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_product_name",
    title: "Переименовать товар",
    description:
      "Change a product's name, brand and/or section. The name is written the shop's way: the maker's product name in Latin " +
      "letters exactly as the maker spells it, then « — » and what it is in Russian, from the type words the shop translates " +
      "(«Bio Botanical Shampoo — шампунь», «White — бальзам после бритья»); a name the Estonian and English pages could not " +
      "say is refused with the list of those words. section is one of the ids list_sections gives (hair, styling, beard, " +
      "face, body, perfume, merch); moving a product to another section puts its subsection back to automatic. The product " +
      "keeps its id, page address and stock; orders already placed keep the old name. Live in the shop at once; the static " +
      "pages search engines read are rebuilt within about a quarter of an hour. Each save is a line in Админка → Журнал " +
      "with «Вернуть».",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The product id from search_products." },
        name: { type: "string", maxLength: 120, description: "«Latin product name — русский тип»." },
        brand: { type: "string", maxLength: 60 },
        section: { type: "string", enum: [...PRODUCT_CATS] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_product_price",
    title: "Изменить цену товара",
    description:
      "Change a product's price in euros, VAT included, as the shop sells it — per size for a product with sizes (the size " +
      "labels get_product lists), or the one price of a product without. Sizes are not added or removed here. A change of " +
      "more than 30 % up or down is refused unless confirm is true: tell the owner the old and the new price, ask, and send " +
      "confirm: true only after he says yes. Live at once — the shop, the checkout and the Google feed; each save is a line " +
      "in Админка → Журнал with «Вернуть».",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The product id from search_products." },
        prices: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              size: { type: "string", description: "The size label from get_product; leave out for a product without sizes." },
              price: { type: "number", exclusiveMinimum: 0 },
            },
            required: ["price"],
            additionalProperties: false,
          },
        },
        confirm: { type: "boolean", description: "true only after the owner said yes to a change of more than 30 %." },
      },
      required: ["id", "prices"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_product_stock",
    title: "Записать остаток товара",
    description:
      "Set how many units of a product (one size) are on the shelf after the owner counted them — «осталось 6». was is the " +
      "count get_product showed for that size in stock_count (null when it said never counted): if the shelf changed since " +
      "— a sale, a scan — nothing is saved and the answer says the count now; tell the owner and ask again. size is a label " +
      "from get_product, left out for a product without sizes. The shop's «в наличии / мало / нет» follows the count; " +
      "going from 0 to more sends the «back in stock» letters to the people who asked for one. The change is in Админка → " +
      "Склад → История as «Claude» and a line in Админка → Журнал.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The product id from search_products." },
        size: { type: "string" },
        count: { type: "integer", minimum: 0, maximum: 100000 },
        was: { type: ["integer", "null"], minimum: 0, description: "The count get_product showed (stock_count), null for never counted." },
      },
      required: ["id", "count", "was"],
      additionalProperties: false,
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
  "it is saved as a draft and the owner publishes it in Админка → Блог. It also changes a product's words — its Google " +
  "texts (save_product_google_text), the description on its page (save_product_description), its name, brand and section " +
  "(save_product_name), its prices (save_product_price) and its count on the shelf (save_product_stock) — when the owner " +
  "asks: read the product with get_product first, show the owner what you will save, then save. A price change of more " +
  "than 30 % needs his explicit yes first. Those are live at once, checked like the admin's own fields, and every change " +
  "but a count has «Вернуть» in Админка → Журнал. Answer the owner in his language.";

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
    /* The owner's words as stored — the shop list carries his page text
       flattened for the feed, and save_product_description is written from
       this answer, so it gets the paragraphs. The owner's own product keeps
       its texts on its row; a catalogue product's are in product_overrides. */
    const row = isCustomId(p.id) ? await getCustomProduct(p.id) : null;
    const ownDesc = row ? row.description : await getDescriptionOverride(p.id);
    const description: Partial<Record<L3, string>> = {};
    for (const l of LANGS3) {
      const t = ownDesc?.[l] || (p.texts[l] ? paragraphs(String(p.texts[l])) : "");
      if (t) description[l] = t.slice(0, DESC_MAX);
    }
    return ok({
      id: p.id,
      brand: p.brand,
      names: p.names,
      section: { id: p.cat, RU: catName(p.cat, "RU"), ET: catName(p.cat, "ET"), EN: catName(p.cat, "EN") },
      sizes: p.sizes.map((s) => ({ size: s.label, price: eur(s.price) })),
      stock: stockWord(p.stock),
      /* the count on the shelf per size, null while nobody has counted it —
         save_product_stock takes it back as `was` */
      stock_count: await Promise.all(p.sizes.map(async (s) => ({
        size: s.label, count: await shelfCount(p.id, await shelfKey(p.id, s.label ?? "")),
      }))),
      photos: p.photos,
      url: productUrls(base, p.id),
      description,
      /* which of those the owner wrote; the rest is the catalogue's */
      description_by_owner: LANGS3.filter((l) => ownDesc?.[l]),
      /* what the owner wrote for Google, when anything — save_product_google_text changes it */
      google_text: googleOut(row ? row.seo : await getSeoOverride(p.id)),
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
  if (name === "save_product_description") return saveProductDescription(args);
  if (name === "save_product_name") return saveProductName(args);
  if (name === "save_product_price") return saveProductPrice(args);
  if (name === "save_product_stock") return saveProductStock(args);
  return no(`Unknown tool «${name}».`);
}

/* ---------- the product a write is about ---------- */

/** A product a write may touch: one the shop shows, or the owner's own («c-…») — that one even while it is hidden. */
type Target = { id: string; brand: string; name: string; cat: string; own: CustomProduct | null };

async function target(raw: unknown): Promise<Target | null> {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!id) return null;
  if (isCustomId(id)) {
    // read past the minute's copy: the row is what the write merges into
    const own = await getCustomProduct(id);
    return own ? { id, brand: own.brand, name: own.name, cat: own.cat, own } : null;
  }
  const { list } = await productsNow();
  const p = list.find((x) => x.id === id);
  return p ? { id, brand: p.brand, name: p.names.RU, cat: p.cat, own: null } : null;
}
const notFound = (raw: unknown) =>
  no(`No product «${typeof raw === "string" ? raw.trim().slice(0, 80) : ""}» in the shop — find it with search_products first. Nothing was saved.`);

/** One product change in the journal with what it replaced — «Вернуть» on its line puts that back (src/lib/audit-undo.ts). */
async function journal(t: Target, patch: Record<string, unknown>, before: Record<string, unknown>): Promise<void> {
  if (t.own) await writeAuditSafe("admin", "product.update", { id: t.id, keys: Object.keys(patch), via: "claude" }, { before });
  else await writeAuditSafe("admin", "override.set", { id: t.id, patch, via: "claude" }, { before });
}

/* ---------- a product's page text ---------- */

const DESC_MAX = 4000;  // cleanDescriptionPatch() in src/lib/product-descriptions.ts cuts there

async function saveProductDescription(args: Record<string, unknown>): Promise<ToolResult> {
  const t = await target(args.id);
  if (!t) return notFound(args.id);
  const given: DescriptionOverride = {};
  for (const l of LANGS3) {
    const v = args[l.toLowerCase()];
    if (v == null) continue;
    if (typeof v !== "string") return no(`${l.toLowerCase()} is text. Nothing was saved.`);
    const text = v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return no(`${l.toLowerCase()} is empty — send the text, or leave ${l.toLowerCase()} out to keep the current one. Nothing was saved.`);
    if (text.length > DESC_MAX) return no(`The ${l} text is ${text.length} characters — at most ${DESC_MAX}. Shorten it. Nothing was saved.`);
    /* descOvHtml() in public/shop2/app.js escapes the text and makes a <p> of
       each block: a tag or a ** would be printed on the page as it is */
    if (/<\/?[a-z][^>]*>/i.test(text) || /\*\*|__|^ {0,3}#{1,6} |^\s*[*+] /m.test(text)) {
      return no(`The ${l} text has HTML or markdown in it — the page shows every character as typed. Plain text: paragraphs ` +
        "separated by an empty line, a list as lines starting with «— ». Nothing was saved.");
    }
    const talk = text.split(/(?<=[.!?…])\s+/).find((s) => s && !seoDropMetaTalk(s));
    if (talk) return no(`The ${l} text talks about missing information («${talk.slice(0, 90)}») — write about the product instead. Nothing was saved.`);
    if (seoOffLanguage(text, l, { name: t.name, brand: t.brand })) {
      return no(`The ${l} text still has Russian words in it — write every word in ${l === "ET" ? "Estonian" : "English"} except the brand and the maker's product name. Nothing was saved.`);
    }
    given[l] = text;
  }
  const langs = LANGS3.filter((l) => given[l]);
  if (!langs.length) return no("Send at least one of ru, et, en. Nothing was saved.");

  const was = t.own ? t.own.description : await getDescriptionOverride(t.id);
  const next: DescriptionOverride = { ...(was ?? {}), ...given };
  let saved: DescriptionOverride | null;
  if (t.own) saved = (await updateCustomProduct(t.id, { description: next }))?.description ?? null;
  else saved = await setDescriptionOverride(t.id, next);
  await journal(t, { description: saved }, { description: was ?? null });
  resetProductCache();
  submitIndexNow(pingUrls(t.id));
  return ok({
    saved: langs.map((l) => l.toLowerCase()),
    product: `${t.brand} ${t.name}`,
    description: saved,
    next: "Live on the product page now. The owner sees it in Админка → Товары → this product → «Описание», and «Вернуть» " +
      "on its line in Админка → Журнал puts the old text back.",
  });
}

/* ---------- a product's name, brand and section ---------- */

const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim() : "");

/** The refusal Dim asked for (26.10.2026, «block + suggest»): why, what each language would say, and the words that work. */
function untranslatable(name: string): string {
  return `«${name}» would stay partly Russian on the Estonian and English pages and in the Google feed ` +
    `(ET: «${translateProductName(name, "ET")}», EN: «${translateProductName(name, "EN")}»). Write the maker's product ` +
    "name in Latin letters, then « — » and one of the type words the shop translates (it may go on with «для волос», " +
    `«для лица», «для бороды», «для бритья», «для укладки» or «для кожи головы»): ${TRANSLATABLE_TAILS.join(", ")}. ` +
    "If none fits, the owner asks Dim to add the word. Nothing was saved.";
}

async function saveProductName(args: Record<string, unknown>): Promise<ToolResult> {
  const t = await target(args.id);
  if (!t) return notFound(args.id);
  const patch: { name?: string; brand?: string; cat?: string } = {};
  if (args.name != null) {
    const name = oneLine(args.name);
    if (!name || name.length > MAX_NAME) return no(`name: one line of 1–${MAX_NAME} characters. Nothing was saved.`);
    if (!nameTranslatable(name)) return no(untranslatable(name));
    patch.name = name;
  }
  if (args.brand != null) {
    const brand = oneLine(args.brand);
    if (!brand || brand.length > MAX_BRAND) return no(`brand: one line of 1–${MAX_BRAND} characters. Nothing was saved.`);
    patch.brand = brand;
  }
  if (args.section != null) {
    const cat = oneLine(args.section).toLowerCase();
    if (!(PRODUCT_CATS as readonly string[]).includes(cat)) {
      return no(`section is one of ${PRODUCT_CATS.join(", ")} — list_sections names them. Nothing was saved.`);
    }
    patch.cat = cat;
  }
  if (!Object.keys(patch).length) return no("Send at least one of name, brand, section. Nothing was saved.");

  if (t.own) {
    const before = ownPrev(t.own, patch);
    try {
      await updateCustomProduct(t.id, patch);
    } catch (e) {
      if (e instanceof CustomProductError) return no(`The shop refused it (${e.code}). Nothing was saved.`);
      throw e;
    }
    await journal(t, patch, before);
  } else {
    /* the override route's own rule (nameFields in
       src/app/api/admin/overrides/route.ts): a subsection belongs to its
       section, so a move starts from «Авто — по названию» */
    const full: Partial<Override> = { ...patch, ...("cat" in patch ? { subcat: null } : {}) };
    const old = await getOverrideRow(t.id);
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(full) as Array<keyof Override>) before[k] = old?.[k] ?? null;
    await upsertOverride(t.id, full);
    await journal(t, full, before);
  }
  resetProductCache();
  requestRebuild("product-rename");
  submitIndexNow(pingUrls(t.id));
  const name = patch.name ?? t.name;
  return ok({
    saved: Object.keys(patch).map((k) => (k === "cat" ? "section" : k)),
    id: t.id,
    brand: patch.brand ?? t.brand,
    names: { RU: name, ET: translateProductName(name, "ET"), EN: translateProductName(name, "EN") },
    section: catName(patch.cat ?? t.cat, "RU"),
    next: "Live in the shop now under the same id and page address. Orders already placed keep the old name. The static pages " +
      "search engines read are rebuilt within about a quarter of an hour. «Вернуть» on its line in Админка → Журнал puts " +
      "the old name back.",
  });
}

/* ---------- prices ---------- */

const PRICE_GUARD = 0.3;          // Dim, 26.10.2026: more than 30 % needs the owner's yes
const CATALOGUE_PRICE_MAX = 100000; // the override route's own bound (src/app/api/admin/overrides/route.ts)

type Rung = { label: string | null; price: number };

/** The prices the till charges now, per size — the shop's own list, or the row of a hidden own product. */
async function liveRungs(t: Target): Promise<Rung[]> {
  const shown = (await productsNow()).list.find((p) => p.id === t.id);
  if (shown) return shown.sizes.map((s) => ({ label: s.label, price: s.price }));
  if (!t.own) return [];
  return t.own.sizes.length
    ? t.own.sizes.map((label, i) => ({ label, price: t.own!.prices[i] ?? t.own!.prices[0] }))
    : [{ label: null, price: t.own.prices[0] }];
}
const sizeList = (rungs: Rung[]) => rungs.map((r) => r.label).filter(Boolean).join(", ");

async function saveProductPrice(args: Record<string, unknown>): Promise<ToolResult> {
  const t = await target(args.id);
  if (!t) return notFound(args.id);
  const rungs = await liveRungs(t);
  if (!rungs.length) return no("This product has no price in the shop yet — it is set in the admin. Nothing was saved.");
  const asked = Array.isArray(args.prices) ? args.prices : [];
  if (!asked.length) return no("Send prices: [{ size, price }] — size as get_product lists it, left out for a product without sizes. Nothing was saved.");
  const max = t.own ? PRICE_MAX : CATALOGUE_PRICE_MAX;
  const next = rungs.map((r) => ({ ...r }));
  const named = new Set<number>();
  for (const item of asked) {
    const o = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const size = oneLine(o.size);
    const one = rungs.length === 1 && !size;
    const i = one ? 0 : rungs.findIndex((r) => (r.label ?? "").toLowerCase() === size.toLowerCase());
    if (i < 0) return no(`No size «${size}» on this product — its sizes: ${sizeList(rungs) || "none, send one price without size"}. Nothing was saved.`);
    if (named.has(i)) return no(`«${rungs[i].label ?? "the price"}» is named twice. Nothing was saved.`);
    named.add(i);
    const n = typeof o.price === "number" ? o.price : Number(String(o.price ?? "").trim().replace(",", "."));
    if (!Number.isFinite(n) || n < PRICE_MIN || n > max) {
      return no(`${rungs[i].label ?? "price"}: a price in euros from ${PRICE_MIN} to ${max}. Nothing was saved.`);
    }
    next[i].price = Math.round(n * 100) / 100;
  }
  const moved = next
    .map((r, i) => ({ label: r.label, from: rungs[i].price, to: r.price }))
    .filter((c) => c.from !== c.to);
  if (!moved.length) return ok({ saved: [], note: "Those are the prices already — nothing changed." });
  const big = moved.filter((c) => c.from > 0 && Math.abs(c.to - c.from) / c.from > PRICE_GUARD);
  if (big.length && args.confirm !== true) {
    return no(big.map((c) => `${c.label ?? "price"} ${eur(c.from)} → ${eur(c.to)} (${Math.round(((c.to - c.from) / c.from) * 100)} %)`).join(", ") +
      " — more than 30 %. Ask the owner whether this is right; only after his yes send the same prices again with confirm: true. Nothing was saved.");
  }

  const single = next.length === 1 && !next[0].label;
  if (t.own) {
    const fields: Record<string, unknown> = single ? { price: next[0].price } : { sizes: next.map((r) => ({ size: r.label, price: r.price })) };
    const before = ownPrev(t.own, fields);
    await updateCustomProduct(t.id, fields);
    /* a price override on an own product sits on top of the row's price and
       would hide the new one — the panel drops it the same way (edOwnPump in
       public/shop2/app.js) */
    if ((await getOverrideRow(t.id))?.price != null) await upsertOverride(t.id, { price: null });
    await journal(t, fields, before);
  } else {
    /* the panel's own shapes (sizesBody in public/shop2/app.js): one price, or
       the whole ladder with its first rung as the price */
    const full: Partial<Override> = single
      ? { price: next[0].price }
      : { sizes: next.map((r) => ({ size: r.label ?? "", price: r.price })), price: next[0].price };
    const old = await getOverrideRow(t.id);
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(full) as Array<keyof Override>) before[k] = old?.[k] ?? null;
    await upsertOverride(t.id, full);
    await journal(t, full, before);
  }
  resetProductCache();
  submitIndexNow(pingUrls(t.id));
  return ok({
    saved: moved.map((c) => ({ size: c.label, from: eur(c.from), to: eur(c.to) })),
    product: `${t.brand} ${t.name}`,
    next: "Live now in the shop, the checkout and the Google feed (the static pages follow at the nightly rebuild). «Вернуть» " +
      "on its line in Админка → Журнал puts the old prices back.",
  });
}

/* ---------- a count on the shelf ---------- */

async function saveProductStock(args: Record<string, unknown>): Promise<ToolResult> {
  const t = await target(args.id);
  if (!t) return notFound(args.id);
  const count = Number(args.count);
  if (typeof args.count !== "number" || !Number.isInteger(count) || count < 0 || count > 100000) {
    return no("count: a whole number of units, 0 or more. Nothing was saved.");
  }
  const was = args.was;
  if (!(was === null || (typeof was === "number" && Number.isInteger(was) && was >= 0))) {
    return no("was: the count get_product showed for this size in stock_count — null when it said never counted. Nothing was saved.");
  }
  const labels = (await liveRungs(t)).map((r) => r.label).filter((l): l is string => !!l);
  const size = oneLine(args.size);
  let label = "";
  if (labels.length) {
    const hit = size ? labels.find((l) => l.toLowerCase() === size.toLowerCase()) : labels.length === 1 ? labels[0] : undefined;
    if (!hit) return no(`Which size? ${labels.join(", ")}. Nothing was saved.`);
    label = hit;
  } else if (size) {
    return no("This product has no sizes — leave size out. Nothing was saved.");
  }
  const variant = await shelfKey(t.id, label);
  let from: number;
  try {
    from = (await setQty(t.id, variant, count, { reason: "adjust", ref: "Claude", actor: "claude", expect: was })).qtyBefore;
  } catch (e) {
    if (e instanceof InventoryError && e.code === "stale") {
      const now = e.detail === "untracked" ? null : Number(e.detail);
      return no(`The shelf changed since you read it: ${label || "this product"} is now ${now == null ? "not counted" : now + " pcs"}, ` +
        `not ${was == null ? "not counted" : was + " pcs"}. Tell the owner and ask again; send was: ${now == null ? "null" : now}. Nothing was saved.`);
    }
    throw e;
  }
  await writeAuditSafe("admin", "stock.set", { id: t.id, variant, from: was == null ? null : from, to: count, via: "claude" });
  resetProductCache();
  const level = await getLevel(t.id, variant);
  return ok({
    product: `${t.brand} ${t.name}`,
    size: label || null,
    was,
    count,
    shop_says: stockWord(level?.state ?? (count > 0 ? "in" : "out")),
    next: "Saved. The shop shows the new state within a couple of minutes; Админка → Склад → История has the line with «Claude».",
  });
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
  const t = await target(args.id);
  if (!t) return notFound(args.id);

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
    if (seoOffLanguage(`${title}\n${desc}`, l, { name: t.name, brand: t.brand })) {
      return no(`The ${l} texts still have Russian words in them — write every word in ${l === "ET" ? "Estonian" : "English"} except the brand and the maker's product name. Nothing was saved.`);
    }
    given[l] = { title, desc };
  }
  if (!Object.keys(given).length) return no("Send at least one of ru, et, en with a title and a description. Nothing was saved.");

  /* the owner's own product keeps its pairs on its row, where the panel
     writes them; a catalogue product's are in product_overrides */
  const was = t.own ? t.own.seo : await getSeoOverride(t.id);
  const next: SeoOverride = { ...(was ?? {}) };
  for (const l of LANGS3) if (given[l]) next[l] = given[l];
  const saved = t.own
    ? (await updateCustomProduct(t.id, { seo: next }))?.seo ?? null
    : await setSeoOverride(t.id, next);
  /* An ordinary product change in the journal, with the pair it replaced:
     «Вернуть» there sends {seo: <old>} back through the route that keeps it
     (src/lib/audit-undo.ts) — on any device, like the panel's own edits. */
  await journal(t, { seo: saved }, { seo: was ?? null });
  submitIndexNow(pingUrls(t.id));
  return ok({
    saved: LANGS3.filter((l) => given[l]).map((l) => l.toLowerCase()),
    product: `${t.brand} ${t.name}`,
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
