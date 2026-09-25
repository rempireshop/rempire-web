/* The SEO head of a shop page — one builder, two callers.

   tools/prerender-shop2.mjs writes the catalogue's pages at build time;
   src/lib/product-page.ts writes a custom product's page (`c-…`,
   db/migrations/131_custom_products.sql) at request time, because those rows
   do not exist when the build runs. Both take their <title>, description,
   canonical, hreflang cluster, OpenGraph/Twitter tags and JSON-LD from the
   functions below, so a product the owner created in the panel carries
   exactly the head a catalogue product does — same strings, same shape,
   same `data-seo` markers app.js rewrites on navigation.

   Plain ESM (.mjs), not TypeScript, on purpose: the prerender runs as a bare
   `node` script with no loader, and tsconfig's allowJs lets the Next routes
   and the tests import this file unchanged (same reasoning as e2e/env.mjs).
   Nothing in here reads the environment or the disk — every function takes
   the base URL and the robots value it needs, so the two callers decide
   those once each (docs/seo.md, "The three noindex layers"). */

export const LANGS = [
  { code: "RU", seg: "", tag: "ru", htmlLang: "ru", ogLocale: "ru_RU" },
  { code: "ET", seg: "et", tag: "et", htmlLang: "et", ogLocale: "et_EE" },
  { code: "EN", seg: "en", tag: "en", htmlLang: "en", ogLocale: "en_US" }
];

/** The language a path prefix stands for: "" → Russian, "et", "en". Null for anything else. */
export function langBySeg(seg) {
  const s = String(seg == null ? "" : seg).replace(/^\/+|\/+$/g, "");
  return LANGS.find(l => l.seg === s) || null;
}

/* ---------- robots: one switch ------------------------------------------

   Opening the site takes an **explicit** PUBLIC_BASE_URL on the live domain,
   not merely the absence of the variable — the fail-safe direction is
   closed. The prerender warns when the variable is unset; the request-time
   page simply follows the same rule. */
export const ROBOTS_OPEN = "index, follow, max-image-preview:large";
export const ROBOTS_CLOSED = "noindex, nofollow";

export function isLiveBase(baseEnv) {
  if (!baseEnv) return false;
  try { return /(^|\.)rempireshop\.com$/i.test(new URL(String(baseEnv)).hostname); }
  catch { return false; }
}
export const robotsFor = baseEnv => (isLiveBase(baseEnv) ? ROBOTS_OPEN : ROBOTS_CLOSED);

/** The shop's production origin — what every absolute URL means when nobody has said otherwise. */
export const LIVE_ORIGIN = "https://rempireshop.com";

/** The absolute-URL base: $PUBLIC_BASE_URL, default the live domain, no trailing slash. */
export const baseFrom = baseEnv => String(baseEnv || LIVE_ORIGIN).replace(/\/+$/, "");

/**
 * The base for a document that is only ever read on the live domain — the
 * Merchant Center feed (src/lib/merchant-feed.ts). $PUBLIC_BASE_URL when it
 * names rempireshop.com (or www.), the live origin otherwise.
 *
 * baseFrom() is right for a page: a staging page links to staging. A feed is
 * not a page. Google holds every link in it for as long as the item lives, so
 * a copy fetched from staging, from a preview or from localhost must still
 * point at the shop the product is sold in — and before the switch that is
 * the same file the switch itself will serve.
 */
export const liveBaseFrom = baseEnv => (isLiveBase(baseEnv) ? baseFrom(baseEnv) : LIVE_ORIGIN);

/* ---------- small helpers ------------------------------------------------ */

export const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const eur = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
/* The entities the product texts actually carry — the same five app.js's
   unentity() knows, plus the typographic ones the Shopify export left behind.
   stripTags() produces *plain text*, and a meta description is escaped once on
   the way out: leaving «&amp;» in it published «Mat &amp;amp; Hard Lift-Up
   Wax» to Google. The first Merchant Center feed script decoded these from the
   day it was written; the SEO head did not (audit 07.09.2026). Its successor,
   src/lib/merchant-feed.ts, decodes them through merchantText() below. */
const ENTITY = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…"
};
export const unentity = s => String(s == null ? "" : s)
  .replace(/&(amp|lt|gt|quot|apos|#39|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo|hellip);/g, (_, e) => ENTITY[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/* Same rule as stripTags() in public/shop2/app.js: an inline tag vanishes, a
   block tag becomes a space. Turning every tag into a space split words that
   carry markup inside them — «s<b>trong</b>» came out as «s trong». */
const INLINE_TAGS = /^(?:span|b|i|strong|em|a|u|sup|sub)$/i;
export const stripTags = h => unentity(String(h || "")
  .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, tag) => (INLINE_TAGS.test(tag) ? "" : " "))
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();
export const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* The same plain text as stripTags(), but with the block boundaries kept as
   sentence breaks.

   A product description usually opens with a heading line above the copy —
   «Шампунь для редеющих волос», «Бальзам после бритья Proraso Single Blade» —
   and stripTags() turns a block tag into a space, so the snippet came out as
   «Шампунь для редеющих волос Шампунь поддерживает…»: two sentences run
   together, which reads as a typo in a result listing (Dim, 21.09.2026).

   The heading is a GOOD first line — it is the thing the searcher asked for —
   so it stays and merely gets its full stop. A block that already ends in
   punctuation is joined with a space, because a second stop after one would
   be the same fault the other way round.

   stripTags() itself is left exactly as it is: it is the twin of the copy in
   public/shop2/app.js, and the two must keep answering identically. */
export const textForSnippet = h => {
  /* A sentinel rather than a space, because a space is what the text is
     already full of. `\u0000` is written as an escape and never as the
     character: a raw NUL in a source file makes grep call it binary and
     report no matches at all, which is a trap this repository has already
     walked into once (src/lib/og-card.ts). */
  const MARK = "\u0000";
  return unentity(String(h || "")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, tag) => (INLINE_TAGS.test(tag) ? "" : MARK))
    .replace(/<[^>]+>/g, MARK))
    .split(MARK)
    .map(x => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .reduce((out, part) => (out ? out + (/[.!?…:;,)»—–-]$/.test(out) ? " " : ". ") + part : part), "")
    .trim();
};

/* A product text that opens with a SHOUTED heading — «BIO BOTANICAL SERUM ОТ
   SYSTEM 4 Сыворотка, стимулирующая…», «НЕВЕСОМЫЙ ЛАК ДЛЯ ВОЛОС — ОБЪЁМ И
   БЛЕСК БЕЗ МАСЕЛ ОТ KEVIN MURPHY Бросьте вызов…». On the page it is a
   <strong> line above the copy; in a search result it is 60 characters of
   capitals repeating the title, which is the first thing a reader skips. Drop
   the run and start on the sentence after it. Nothing is dropped when the text
   never gets to a normal sentence (an all-caps description stays as it is) or
   when the run is too short to be a heading.

   The classes are written out rather than \p{Ll}/\p{Lu} so this rule and
   app.js's copy of it are the same regex: Latin, Latin-1 accents, the two
   Estonian carons and Cyrillic. */
const LOWER = "a-zà-öø-ÿšžа-яё";
const UPPER = "A-ZÀ-ÖØ-ÞŠŽА-ЯЁ";
const SHOUT = new RegExp("^[^" + LOWER + "]{10,160}?(?=[" + UPPER + "][" + LOWER + "])");
export const dropShout = s => String(s || "").replace(SHOUT, "").trim();

/* A product text as Google Merchant Center wants its `description`: plain
   text, the block boundaries kept as sentence breaks (textForSnippet), the
   shouted heading gone — Merchant Center reads «SPRAY WAX FINISHING HAIRSPRAY
   BY KEVIN MURPHY.» as excessive capitalisation, and the title already says
   it — and no longer than the 5 000 characters the attribute takes. One
   function for both halves of the feed: tools/lib/feed-data.mjs runs it over
   the static content*.js texts at build, src/lib/merchant-feed.ts over the
   owner's own description at request time. */
export const MERCHANT_TEXT_MAX = 5000;
export function merchantText(html) {
  const text = textForSnippet(html);
  return clip(dropShout(text) || text, MERCHANT_TEXT_MAX);
}

/* Cut at a word, not mid-word: a description that ends "…профессионал" reads
   as a broken page in a result listing. */
export function clip(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:·—–-]+$/, "") + "…";
}

/* A result listing shows about sixty characters of a title. Take the longest
   version that fits — app.js's fitTitle() runs the same ladder.

   `alt` is the middle rung, added 07.09.2026: brand + name + the price, for
   the 123 of 220 products whose full title («… — купить в Rempire · 15 €»)
   ran past sixty and fell straight to «… — REMPIRE». Google prints the site
   name beside the title itself, from og:site_name and the WebSite block, so
   those ten characters bought a word the reader already had; a price is the
   one thing a shopping result can say that its neighbours often do not. */
/* The site's name, once. A title written by the model or by hand can already
   end in it — «Suvine välimus: hooldus ja stiil — REMPIRE» came back from an
   article's Estonian translation — and every caller then appends its own
   « — REMPIRE»: the Estonian page's <title> read «… — REMPIRE — REMPIRE»
   (verification pass on staging, 25.09.2026). So a trailing brand, whatever
   the separator — «— REMPIRE», «| Rempire», «- rempireshop.com» — is taken
   off the core, and a rung that ends in it keeps exactly one, in the house
   form. A brand inside the sentence («купить в Rempire · 9 €») or in front of
   it («REMPIRE — магазин косметики») is not a tail and stays. app.js's
   fitTitle() carries the same two lines. */
const BRAND_TAIL = /(?:\s*[—–|:·-]\s*rempire(?:\s*shop)?(?:\.com)?)+\s*$/i;
export const dropBrand = s => String(s == null ? "" : s).replace(BRAND_TAIL, "").trim();
const brandOnce = s => (s && BRAND_TAIL.test(s) ? dropBrand(s) + " — REMPIRE" : s);

export function fitTitle(core, full, alt) {
  core = dropBrand(core);
  full = brandOnce(full);
  alt = brandOnce(alt);
  if (full && full.length <= 60) return full;
  if (alt && alt.length <= 60) return alt;
  if (core.length + 10 <= 60) return core + " — REMPIRE";
  if (core.length <= 60) return core;
  return clip(core, 60);
}

export const langPath = (seg, rest) => "/shop2" + (seg ? "/" + seg : "") + rest;

/* ---------- what a catalogue product costs TODAY --------------------------
 *
 * The generated file (public/shop/catalogue2.js, src/data/catalogue.min.json)
 * is a snapshot of the day of the deploy; `product_overrides` is what the
 * owner has done to the price since. Every page that prints a price outside
 * the shop's own render has to put the two together, and the two that print
 * a blog article's prices are the request-time page (src/lib/blog-page.ts,
 * through getOverrides) and the build (tools/prerender-shop2.mjs, through
 * tools/lib/overrides-export.mjs). They read the same table from two
 * different sides of the deployment, so the RULE lives here, in the one
 * module both of them already import — a second copy of these six lines is
 * exactly the kind of drift the header of src/lib/blog-html.mjs is about.
 */

/** The lowest real price in a ladder, and whether the shop says «от». */
export function cheapestPrice(prices, fallback) {
  const list = (prices || []).map(p => Number(p)).filter(p => Number.isFinite(p) && p > 0);
  if (!list.length) return { price: fallback, from: false };
  return { price: Math.min(...list), from: new Set(list).size > 1 };
}

/**
 * `{ price, from }` for one catalogue product, given the file's own price,
 * the file's own ladder and the owner's `product_overrides` row (or nothing).
 *
 * The owner's saved ladder decides outright: every rung of it carries the
 * price he typed (migration 147). The FILE's ladder only speaks where it
 * actually spreads — since 18.09.2026 the file also carries the 29 products
 * sold in ONE named size, whose single price is the file's own `price`, and
 * reading that as a ladder would quietly out-vote the owner's «Цена» in
 * «Товары» and put the pre-override number under an article.
 */
export function overriddenPrice(filePrice, fileLadder, row) {
  const own = row && row.sizes && row.sizes.length ? row.sizes.map(r => r.price) : null;
  const file = Array.isArray(fileLadder) && fileLadder.length > 1 ? fileLadder : [];
  const ladder = own || file;
  const base = row && row.price != null ? row.price : filePrice;
  return ladder.length ? cheapestPrice(ladder, base) : { price: base, from: false };
}

/* ---------- the product card INSIDE an article ---------------------------
 *
 * The «Товар» button puts a marker into the body: an <a> carrying the
 * product's id, which the storefront swaps for a real card and which a
 * crawler (and a reader with no JS) follows as the ordinary product link it
 * is. There are THREE shapes of it in the database, and all three must keep
 * working for good — the owner's decision of 17.09.2026 was explicitly that
 * already published articles are left exactly as they are, not migrated:
 *
 *   old   <a data-product="ID" href="…">Имя — от 12,90 €</a>
 *         The price is literal text, written on the day the article was
 *         written, and it stays whatever the owner does to the price
 *         afterwards. Nothing below touches it: a marker with no
 *         `data-price` AND an href of its own is copied through untouched,
 *         exactly as it has been since the marker existed. DO NOT "tidy"
 *         this branch away — every article published before 17.09.2026 is
 *         in it.
 *
 *   new   <a data-product="ID" data-price="live" href="…">Имя</a>
 *         What the «Товар» button writes. No price is stored at all. Each
 *         renderer fills in today's price as it writes the page: the
 *         request-time article (src/lib/blog-page.ts), the prerendered one
 *         (tools/prerender-shop2.mjs) and the shop itself (blogProductHTML()
 *         in public/shop2/app.js, which has rebuilt the whole card from the
 *         live catalogue all along and therefore needed no change). Google,
 *         the first paint and a reader without JS finally see the same
 *         figure the shop charges.
 *
 *   bare  <a data-product="ID"></a>
 *         What the ASSISTANT writes — the shape src/lib/ai-prompts.ts asks
 *         the model for («no href, no other attribute, no text of your
 *         own») and the shape src/lib/blog-cards.ts inserts the cards the
 *         model left out. It carries an id and nothing else, so until
 *         18.09.2026 it was skipped here and reached the page as an EMPTY
 *         ANCHOR: invisible to a crawler and to a reader with no JS, and a
 *         link only once app.js had swapped it. It is now read as a live
 *         card exactly like the shape above — the id is the whole marker,
 *         and the href, the name and the price are all the renderer's to
 *         write. Nothing about it is stored differently: an article already
 *         published comes right at the next render, with no migration.
 *
 * `live` is therefore «carries data-price="live", or carries nothing at all
 * beside its id» — an href with no `data-price` is the old shape and is the
 * one thing that must not be touched.
 *
 * The pattern is keyed to the sanitiser's own output — openTag() in
 * src/lib/blog.ts writes `data-product` first, then `data-price`, then the
 * href — the same way src/app/api/admin/ai/text/route.ts already keys to it.
 * A body that has been through sanitizeHtml() cannot carry these attributes
 * in any other order or spelling.
 */
const BLOG_CARD_SRC = '<a data-product="([^"]+)"( data-price="live")?([^>]*)>([^<]*)</a>';
const BLOG_CARD_HINT = "data-product";
/** A marker whose price, link and words belong to the moment it is read. */
const isLiveCard = (live, rest) => !!live || !rest;

/** Every product a live-price marker in this body names, in order, once each. */
export function blogCardIds(html) {
  const src = String(html || "");
  const out = [];
  if (!src.includes(BLOG_CARD_HINT)) return out;
  const rx = new RegExp(BLOG_CARD_SRC, "g");
  let m;
  while ((m = rx.exec(src))) if (isLiveCard(m[2], m[3]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Today's card written into every live-price marker. `priceOf(id)` gives the
 * whole price label — «от 12,90 €», «alates 12,90 €», «from 12,90 €» —
 * because the word in front of it is this language's and the caller is the
 * one that knows both the language and where the shop's current prices come
 * from.
 *
 * `opts.nameOf(id)` and `opts.seg` are what the assistant's bare marker needs
 * and the «Товар» button's does not, since that one already carries both:
 *
 *   · the words inside the marker are kept when it has any, so a card the
 *     owner wrote or edited reads exactly as he left it. Only an empty one
 *     is given the product's name — from the caller, unescaped, because the
 *     catalogue is not HTML while the stored words already are;
 *   · the href is kept when it has one, so a card inserted from the Estonian
 *     text goes on pointing at /shop2/et/p/…/. Only a marker with none is
 *     given this page's own language segment, which is the language the
 *     reader is reading it in.
 *
 * A marker whose product the caller simply cannot price — the database that
 * holds the owner's own products did not answer, the build read no overrides
 * — is returned untouched, keeping its words and getting no price rather than
 * a made-up one. An article is not worth losing over a query that timed out.
 *
 * `opts.offSale(id)` is the caller saying something stronger than «I could
 * not price it»: «it is not for sale, and its /p/ address answers 404». Only
 * the caller can tell those two apart, being the side that knows whether the
 * owner has hidden the product, whether the id is the catalogue's at all, and
 * whether the query it asked actually came back — so it says so, and nothing
 * here guesses. Such a marker loses its LINK as well: it is written back as
 * its id, its `data-price="live"` and its words, with no href and no other
 * attribute — the shape the assistant's bare marker already has, and the same
 * answer the storefront reaches by dropping the card altogether
 * (blogProductHTML() in public/shop2/app.js, for a product rebuildCatalogue()
 * has taken out of the shop). The words stay because a card may stand inside
 * a sentence and taking it out of one would leave a hole.
 *
 * That last part is the whole of the «Товар» button's case: its href is
 * STORED in the body, so until now a hidden product's card lost its price and
 * went on linking to a page that answers 404 noindex. A card is a
 * recommendation to buy, and a dead link in a published article a crawler
 * keeps coming back to is worse than no link at all.
 */
export function fillBlogCardPrices(html, priceOf, opts) {
  const src = String(html || "");
  if (!src.includes(BLOG_CARD_HINT)) return src;
  const seg = (opts && opts.seg) || "";
  const nameOf = (opts && opts.nameOf) || null;
  const offSale = (opts && opts.offSale) || null;
  return src.replace(new RegExp(BLOG_CARD_SRC, "g"), (whole, id, live, rest, text) => {
    if (!isLiveCard(live, rest)) return whole;
    const stored = String(text || "").trim();
    const price = String(priceOf(id) || "").trim();
    if (!price) {
      /* Nothing to take away from a marker that carries no href of its own —
         the assistant's bare one is already the answer a hidden product gets,
         and `live` is always set on the one that does carry an href, since a
         marker with an href and no `data-price` is the old shape and was
         returned whole above. */
      if (!rest || !offSale || !offSale(id)) return whole;
      return '<a data-product="' + id + '" data-price="live">' + stored + "</a>";
    }
    const words = stored || (nameOf ? esc(String(nameOf(id) || "").trim()) : "");
    return '<a data-product="' + id + '" data-price="live"' +
      (rest || ' href="' + href(seg, "/p/" + encodeURIComponent(id) + "/") + '"') + ">" +
      (words ? words + " — " : "") + esc(price) + "</a>";
  });
}

/* ---------- «Показывать в магазине» ---------------------------------------
 *
 * One `product_overrides` row, one question: may this catalogue product be
 * shown to anybody? The column is `hidden` (db/migrations/147) and the owner
 * flips it between deploys, which is why the answer is worth having in one
 * place rather than four: src/middleware.ts, src/lib/product-page.ts,
 * src/app/sitemap-products.xml/route.ts and src/lib/blog-page.ts each wrote
 * their own until 18.09.2026, and tools/prerender-shop2.mjs — the one that
 * writes every page with a grid on it — wrote none at all.
 *
 * That is the point of putting it here instead of in a tool or a route. Two
 * decisions have to agree or the shop publishes a dead link: whether an
 * address answers (the middleware 404s a hidden product and the sitemap
 * stops naming it) and whether anything still LINKS to that address. Linking
 * to a 404 of our own making is worse than never mentioning the product.
 *
 * `row` is what mapOverride() in src/lib/orders.ts hands a live page and what
 * overrideRow() in tools/lib/overrides-export.mjs hands the build — the same
 * `hidden: r.hidden === true` on both sides. No row means the owner has never
 * touched the product, which is the shop's normal state and is for sale; so
 * is a shop with no database to ask, which is the direction that shows too
 * much rather than too little and matches what every reader here did before.
 */
export const forSale = row => !(row && row.hidden === true);

/** The members of `list` still for sale, given the `{ id: row }` map. */
export const onlyForSale = (list, overrides) =>
  list.filter(p => forSale(overrides && overrides[p.id]));

/**
 * «Наличие» as the owner last saved it, over the file's own word.
 *
 * The third override, and the one the build ignored until 19.09.2026: it read
 * the price and «Показывать в магазине» and left the stock word to
 * `catalogue2.js`, so a product marked «нет в наличии» in the panel was
 * written into static HTML as «В наличии», with schema.org/InStock beside it,
 * and only corrected once app.js had booted and rewritten the head. Google
 * runs JavaScript; a reader with none, the first paint, and anything reading
 * the markup rather than the page do not (audit F31).
 *
 * The live fold is getOverrides() in src/lib/orders.ts, where a counted
 * quantity outranks this word. The build has no counts, so the manual word is
 * the whole of what it can honour — which is exactly the half the owner sets
 * by hand and therefore the half he expects to see.
 */
export const overriddenStock = (fileStock, row) =>
  (row && (row.stock === "in" || row.stock === "low" || row.stock === "out") ? row.stock : fileStock);

/** `list` with the owner's word folded in wherever he has set one. The build
    applies this once, at load, so that every reader downstream — the chip on
    the page, the Product JSON-LD, the meta description, the featured row, the
    sets — is looking at the same answer. */
export const withOwnerStock = (list, overrides) =>
  list.map(p => {
    const stock = overriddenStock(p.stock, overrides && overrides[p.id]);
    return stock === p.stock ? p : { ...p, stock };
  });

/* ---------- copy, one table per language -------------------------------- */

/* Four cells of this table had drifted from app.js by 04.09.2026 and were
   corrected on 19.09.2026 (audit § 9.3): ET «vähe»/«pole saadaval» against the
   shop's «viimased»/«otsas», and both tax lines. The static Estonian page said
   a product was «pole saadaval» and the rendered DOM said «otsas» a moment
   later, in the same place, about the same bottle. Nothing compares the two
   tables; when you touch either, touch both.
   Mirrors the strings setHead() in app.js uses, so the tab title does not
   change under the shopper when the script takes over. */
export const T = {
  RU: {
    base: "REMPIRE — магазин косметики в Таллинне",
    buy: "купить в Rempire",
    home: "Главная", catalogue: "Каталог", brands: "Бренды", all: "Все товары",
    homeIntro: "Профессиональный уход, стайлинг, парфюмерия и мерч из салона Rempire в Таллинне. " +
      "Доставка Omniva, SmartPosti и DPD по Эстонии, Латвии, Литве и Финляндии, самовывоз на Mardi 1.",
    homeDesc: "Магазин Rempire: уход за волосами и бородой, стайлинг, парфюмерия и мерч. " +
      "Доставка по Эстонии и Балтии, самовывоз в Таллинне на Mardi 1.",
    catsTitle: "Разделы", brandsTitle: "Бренды",
    sizes: "Размеры", description: "Описание",
    inStock: "В наличии", low: "мало", out: "нет в наличии",
    from: "от ",
    tax: "Налоги включены. Доставка рассчитается при оформлении.",
    lang: "Язык", loading: "Загружаем магазин…",
    catDesc: c => `${c} в магазине Rempire, Таллинн. Доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    brandDesc: b => `${b} в наличии в Rempire, Таллинн — весь ассортимент бренда во всех разделах магазина.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Магазин Rempire, Таллинн — доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    /* What a product's own copy gets after it, when the description is cut
       from the product text rather than written by the owner. See descFrom(). */
    descTail: () => "доставка по Эстонии и Балтии · самовывоз в Таллинне",
    /* the four screens added 03.09 — sets, one set, the gift card, the policy pages */
    save: "выгода", pieces: "товара в наборе",
    setsDesc: "Готовые наборы Rempire — уход, стайлинг и бритьё комплектом. Те же товары, что и поштучно, только дешевле. Таллинн, доставка по Балтии.",
    setDesc: (price, save, n) => `${price} вместо розницы, ${save} — ${n} в наборе. Магазин Rempire, Таллинн: доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    /* The denominations are the owner's setting (settings.gift_amounts), not
       a fixed three, so this is a function of the amounts the prerender read
       — «25 €, 50 €, 100 €», already formatted for the language. app.js builds
       the live head from the same two halves (giftDescText). */
    giftDesc: amounts => `Подарочная карта Rempire на ${amounts} — придёт письмом вам или сразу получателю. Действует год, остаток сохраняется.`,
    infoDesc: title => `${title} — магазин Rempire, Таллинн. Доставка Omniva, SmartPosti и DPD по Эстонии и Балтии, самовывоз на Mardi 1.`,
    blogDesc: "Статьи Rempire об уходе за волосами, бородой и лицом: разбираем средства, техники и уход шаг за шагом. Магазин Rempire, Таллинн.",
    blogEmpty: "Статей пока нет — загляните позже.",
    otherPosts: "Другие статьи",
    /* the request-time blog page (src/lib/blog-page.ts) — the prerender
       lifts these three out of app.js's dictionary; they are copied here
       for the same reason CAT_NAMES_I18N is. Keep them in step. */
    blog: "Блог", postProducts: "Товары из статьи", postMissing: "Статья не найдена.",
    /* the request-time 404 (src/lib/notfound-page.ts) — word for word the
       strings screenNotFound() draws in public/shop2/app.js, so the page a
       crawler is served and the page the script paints over it say the same
       thing. Keep them in step. */
    notFound: "Страница не найдена",
    notFoundText: "Такой страницы нет — возможно, ссылка устарела или в адресе опечатка."
  },
  ET: {
    base: "REMPIRE — kosmeetikapood Tallinnas",
    buy: "osta Rempire'ist",
    home: "Avaleht", catalogue: "Kataloog", brands: "Brändid", all: "Kõik tooted",
    homeIntro: "Professionaalne juukse- ja habemehooldus, viimistlus, parfüümid ja merch Rempire'i salongist Tallinnas. " +
      "Tarne Omniva, SmartPosti ja DPD-ga Eestis, Lätis, Leedus ja Soomes, järeletulek Mardi 1.",
    homeDesc: "Rempire'i pood: juukse- ja habemehooldus, viimistlus, parfüümid ja merch. " +
      "Tarne üle Eesti ja Baltikumi, järeletulek Tallinnas Mardi 1.",
    catsTitle: "Osakonnad", brandsTitle: "Brändid",
    sizes: "Suurused", description: "Kirjeldus",
    inStock: "Laos", low: "viimased", out: "otsas",
    from: "alates ",
    tax: "Hinnad sisaldavad käibemaksu. Tarnehind arvutatakse tellimuse vormistamisel.",
    lang: "Keel", loading: "Laeme poodi…",
    catDesc: c => `${c} Rempire'i poes Tallinnas. Tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    brandDesc: b => `${b} laos Rempire'is, Tallinn — kogu brändi valik kõigist poe osakondadest.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Rempire'i pood, Tallinn — tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    descTail: () => "tarne Eestis ja Baltikumis · järeletulek Tallinnas",
    save: "sääst", pieces: "toodet komplektis",
    setsDesc: "Rempire'i valmiskomplektid — hooldus, viimistlus ja habemeajamine ühes pakis. Samad tooted mis eraldi, ainult soodsamalt. Tallinn, tarne üle Baltikumi.",
    setDesc: (price, save, n) => `${price} jaehinna asemel, ${save} — ${n}. Rempire'i pood, Tallinn: tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    giftDesc: amounts => `Rempire'i kinkekaart ${amounts} — tuleb kirjaga sulle või kohe saajale. Kehtib aasta, jääk säilib.`,
    infoDesc: title => `${title} — Rempire'i pood, Tallinn. Tarne Omniva, SmartPosti ja DPD-ga üle Eesti ja Baltikumi, järeletulek Mardi 1.`,
    blogDesc: "Rempire'i artiklid juuste, habeme ja näo hooldusest: tooted, tehnikad ja hooldus samm-sammult. Rempire'i pood, Tallinn.",
    blogEmpty: "Artikleid veel pole — vaata varsti uuesti.",
    otherPosts: "Teised artiklid",
    // «Blogi», not «Ajaveeb» and not «Blog» — the owner's own word, settled
    // 07.09.2026; the same line as the app.js dictionary's "Блог" entry
    blog: "Blogi", postProducts: "Tooted artiklist", postMissing: "Artiklit ei leitud.",
    notFound: "Lehte ei leitud",
    notFoundText: "Sellist lehte ei ole — link võib olla vananenud või aadressis on trükiviga."
  },
  EN: {
    base: "REMPIRE — professional hair care & cosmetics in Tallinn",
    buy: "buy at Rempire",
    home: "Home", catalogue: "Catalogue", brands: "Brands", all: "All products",
    homeIntro: "Professional hair and beard care, styling, fragrance and merch from the Rempire salon in Tallinn. " +
      "Omniva, SmartPosti and DPD delivery across Estonia, Latvia, Lithuania and Finland, pickup at Mardi 1.",
    homeDesc: "Rempire shop: hair and beard care, styling, fragrance and merch. " +
      "Delivery across Estonia and the Baltics, pickup in Tallinn at Mardi 1.",
    catsTitle: "Sections", brandsTitle: "Brands",
    sizes: "Sizes", description: "Description",
    inStock: "In stock", low: "low stock", out: "out of stock",
    from: "from ",
    tax: "Taxes included. Delivery is calculated at checkout.",
    lang: "Language", loading: "Loading the shop…",
    catDesc: c => `${c} at Rempire, Tallinn. Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    brandDesc: b => `${b} in stock at Rempire, Tallinn — the brand's full range across every section of the shop.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Rempire shop, Tallinn — Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    descTail: () => "delivery across Estonia and the Baltics · pickup in Tallinn",
    save: "you save", pieces: "products in the set",
    setsDesc: "Rempire ready-made sets — care, styling and shaving in one box. The same products the shop sells separately, only cheaper. Tallinn, Baltic delivery.",
    setDesc: (price, save, n) => `${price} instead of retail, ${save} — ${n}. Rempire shop, Tallinn: Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    giftDesc: amounts => `A Rempire gift card for ${amounts} — e-mailed to you or straight to the recipient. Valid for a year, the balance carries over.`,
    infoDesc: title => `${title} — Rempire shop, Tallinn. Omniva, SmartPosti and DPD delivery across Estonia and the Baltics, pickup at Mardi 1.`,
    blogDesc: "Rempire articles on hair, beard and face care: products, techniques and routines, step by step. Rempire shop, Tallinn.",
    blogEmpty: "No articles yet — check back soon.",
    otherPosts: "More articles",
    blog: "Blog", postProducts: "Products from this article", postMissing: "Article not found.",
    notFound: "Page not found",
    notFoundText: "There is no such page — the link may be out of date, or the address has a typo."
  }
};

/* The seven sections in the three languages — CAT_NAMES in
   public/shop/catalogue2.js and the UI dictionary's entries for them in
   public/shop2/app.js, copied here for the request-time page, which cannot
   lift the dictionary out of app.js the way the prerender does. Keep them
   in step with the dictionary. */
export const CAT_NAMES_I18N = {
  hair: { RU: "Уход за волосами", ET: "Juuksehooldus", EN: "Hair care" },
  styling: { RU: "Стайлинг", ET: "Viimistlus", EN: "Styling" },
  beard: { RU: "Уход за бородой", ET: "Habemehooldus", EN: "Beard care" },
  face: { RU: "Уход за лицом", ET: "Näohooldus", EN: "Face care" },
  body: { RU: "Уход за телом", ET: "Kehahooldus", EN: "Body care" },
  perfume: { RU: "Парфюмерия", ET: "Parfüümid", EN: "Fragrance" },
  merch: { RU: "Мерч", ET: "Merch", EN: "Merch" }
};
export const catName = (cat, code) => (CAT_NAMES_I18N[cat] && (CAT_NAMES_I18N[cat][code] || CAT_NAMES_I18N[cat].RU)) || "";

/* ---------- OG cards ----------------------------------------------------- */

/* A link preview is a 1 200×630 JPEG or PNG or it is nothing — see the long
   note in tools/prerender-shop2.mjs. The two shared cards are committed. */
export const OG_W = 1200, OG_H = 630;
export const OG_DEFAULT = "/brand/og-default.png";   // tower on the ground, for pages with no card of their own
export const OG_FALLBACK = "/og-shop.png";           // shipped, 1200×630 — used when sharp is missing

/* ---------- the head ----------------------------------------------------- */

/* One page's whole hreflang cluster: the three languages plus x-default, which
   is the unprefixed Russian path — the one every old link already points at.
   data-seo marks them so app.js rewrites these tags on client navigation
   instead of appending a second set. */
export function headLinks(base, seg, rest) {
  const abs = u => base + u;
  const out = LANGS.map(l =>
    `<link rel="alternate" hreflang="${l.tag}" href="${esc(abs(langPath(l.seg, rest)))}" data-seo="alt-${l.tag}">`);
  out.push(`<link rel="alternate" hreflang="x-default" href="${esc(abs(langPath("", rest)))}" data-seo="alt-x">`);
  out.unshift(`<link rel="canonical" href="${esc(abs(langPath(seg, rest)))}" data-seo="canonical">`);
  return out.join("\n");
}

/* Prerender-only styling. The block is thrown away the moment app.js has
   painted, so these rules deliberately lean on styles.css (.wrap, .grid,
   .card, .pdp, .display, .chip, .acc__rich) and only fill the few gaps a
   script-less page has: a real <img> where the SPA paints a background, and
   anchors where it draws buttons. */
export const PRE_CSS = `
#prerender .pre__img { width: 100%; height: auto; aspect-ratio: 1; object-fit: contain; background: var(--page); }
/* A blog cover is not square. It carries .blog__cover as well as .pre__img,
   and .blog__cover says 1200/630 — but it says it from styles.css at one
   class of specificity, and the id above outranks it, so the prerendered
   article opened with a square cover and app.js then reshaped it to a wide
   one on hydration. Two different crops of the same picture on the same
   page, and the second of them arrived as a jump. The rule the shop means
   wins here too now, which is also the rule the panel previews. */
#prerender .blog__cover { aspect-ratio: 1200 / 630; }
/* …and neither is a cover in the LIST. That half was missed: the tile's
   <img> carries only .pre__img, so every cover on /shop2/{,et/,en/}blog/
   was framed 1:1 and the inline object-position cropped the picture into a
   square — a different crop from the one the owner dragged, and from the one
   the panel previews under «В списке статей». Then app.js removed #prerender
   and repainted the tile wide: the same jump as above, on the page that has
   twelve of them. Dim, 19.09.2026: «The image in the list … is not updated».
   The anchor already carries .blog__tile in both static renderers. */
#prerender .blog__tile .pre__img { aspect-ratio: 1200 / 630; }
#prerender .pre__crumbs { font-size: 12.5px; color: var(--muted); padding-top: 16px; }
#prerender .pre__crumbs a:hover { text-decoration: underline; }
#prerender .pre__brand { font-family: Oswald, sans-serif; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 6px; }
#prerender .pre__sizes { display: flex; gap: 8px; flex-wrap: wrap; list-style: none; padding: 0; margin: 0 0 18px; }
#prerender .pre__sizes li { border: 1px solid var(--rule); padding: 6px 12px; font-size: 13.5px; }
#prerender .pre__langs { margin: 32px 0 8px; font-size: 12.5px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
#prerender .pre__langs a { border-bottom: 1px solid var(--rule); }
#prerender .pre__list { list-style: none; padding: 0; margin: 0 0 24px; display: flex; gap: 8px 18px; flex-wrap: wrap; font-size: 13.5px; }
#prerender .pre__card { display: block; }
#prerender .pre__card .pre__img { margin-bottom: 6px; }
#prerender .blog__tile:hover .pre__nm { text-decoration: underline; text-underline-offset: 3px; }
#prerender .pre__nm { display: block; font-size: 13.5px; }
#prerender .pre__pr { display: block; font-size: 13.5px; font-weight: 600; }
`.trim();

/* JSON inside a <script> is "script data" to the HTML parser, which reads it
   before any JSON parser does: the block ends at the first "</script" whatever
   the JSON says, and "<!--" opens an escaped state that swallows the real
   closing tag. JSON.stringify escapes neither, and a custom product's name
   is typed by the owner (src/lib/product-page.ts). So the three characters
   that mean something to that parser leave as \u-escapes — the same JSON to
   every reader — and the two line separators go with them, for the day one
   of these blocks is read by a JavaScript parser instead (security re-audit
   04.09.2026). */
export const ldJson = o => JSON.stringify(o)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/* ---------- Google's ownership checks, through the domain move ------------
   The Shopify home page at https://rempireshop.com/ carries these three
   google-site-verification tags (read off the live page, 23.09.2026). Search
   Console and Merchant Center re-check them from time to time, and the day
   rempireshop.com points at this shop instead, a page without them is a
   verification lost — and with Merchant Center, the free listings behind it.
   The first token is also
   a DNS TXT record, which survives on its own; the other two exist only as
   tags. «/» redirects to /shop2/ (next.config.ts), so they ride in the one
   block every page's head is built from: the Russian home page the shell
   serves for /shop2/, the ET and EN homes, and every other page, which costs
   nothing and means no page can be the one that lacks them.
   Tokens only — never a secret: they are public on the live page today. */
export const GOOGLE_SITE_VERIFICATION = [
  "KUVTHWQUdqKHip0q8VUKTRnAj9L6isKgUsWE4163wNM",
  "vnp_AFwYKflLNLDsABZXCMqo_75IxmAD8RLMIgh4ahs",
  "k3GujBXDQzx0nVeZE5Raig1rp6QDNY8SsR0ONwTb2lw",
];
export const verificationMeta = () =>
  GOOGLE_SITE_VERIFICATION.map(t => `<meta name="google-site-verification" content="${esc(t)}">`).join("\n");

/* Everything a crawler reads, in one block. The prerender writes it between
   the markers in index.html and inlines it verbatim into every generated
   page; the request-time product page writes the same block. `base` is the
   absolute-URL base, `robots` the value the meta carries (robotsFor()). */
export function headBlock({ base, robots, lang, seg, rest, title, desc, image, imageAlt, ogType, jsonld, ldMain }) {
  const canonical = base + langPath(seg, rest);
  const ld = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(Boolean);
  const isMain = o => !!ldMain && o["@type"] === "Product";
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${robots}">
${verificationMeta()}
${headLinks(base, seg, rest)}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="REMPIRE">
<meta property="og:locale" content="${lang.ogLocale}" data-seo="og:locale">
<meta property="og:url" content="${esc(canonical)}" data-seo="og:url">
<meta property="og:title" content="${esc(title)}" data-seo="og:title">
<meta property="og:description" content="${esc(desc)}" data-seo="og:description">
<meta property="og:image" content="${esc(image)}" data-seo="og:image">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta property="og:image:type" content="${/\.png(\?|$)/i.test(image) ? "image/png" : "image/jpeg"}">
<meta property="og:image:width" content="${OG_W}">
<meta property="og:image:height" content="${OG_H}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}" data-seo="twitter:title">
<meta name="twitter:description" content="${esc(desc)}" data-seo="twitter:description">
<meta name="twitter:image" content="${esc(image)}" data-seo="twitter:image">
<style id="prestyle">${PRE_CSS}</style>
${ld.map(o => '<script type="application/ld+json"' +
    /* On a catalogue product page app.js writes its own Product block into
       #ldjson, so handing it this one means it rewrites it in place rather
       than adding a second Product. Everywhere else the id would be a trap:
       setHead() *removes* #ldjson on any screen that is not `product`, so a
       set's Product block carrying that id would be deleted the moment the
       script booted — and Googlebot reads the rendered DOM. The rest are
       marked data-seo="ldjson-page": app.js drops those only once the shopper
       navigates away from the path the page was loaded on. */
    (isMain(o) ? ' id="ldjson"' : ' data-seo="ldjson-page"') +
    ">" + ldJson(o) + "</script>").join("\n")}`;
}

/* ---------- shared blocks ------------------------------------------------ */

export const href = (seg, rest) => esc(langPath(seg, rest));

export function langNav(seg, rest, t) {
  return '<nav class="pre__langs" aria-label="' + esc(t.lang) + '">' +
    LANGS.map(l => '<a href="' + href(l.seg, rest) + '" hreflang="' + l.tag + '"' +
      (l.seg === seg ? ' aria-current="true"' : "") + ">" + l.code + "</a>").join("") +
    "</nav>";
}

export function crumbs(parts) {
  return '<div class="pre__crumbs">' + parts.map(([label, url]) =>
    url ? '<a href="' + url + '">' + esc(label) + "</a>" : esc(label)).join(" / ") + "</div>";
}

export function breadcrumbLD(base, items) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem", position: i + 1, name: it[0],
      ...(it[1] ? { item: base + it[1] } : {})
    }))
  };
}

/* ---------- one product's head ------------------------------------------

   The title ladder, the description, the breadcrumb and the Product JSON-LD
   with its offer — for a catalogue product (the prerender, which also adds
   the translated name and the static English pair) and for a custom one
   (src/lib/product-page.ts, which adds the owner's per-language pair). The
   caller has already chosen the language's name, section name and
   description body; `seoTitle`/`seoDesc` are an owner's pair when there is
   one, `image` the 1 200×630 card, `imageUrls` the absolute photo URLs for
   the JSON-LD. Extra keys on the result (core, priceText, crumbItems) are
   for the caller's body; headBlock() ignores them. */
/* The meta description of a product page, when nobody has written one.
   Until 07.09.2026 this was `clip(text, 158)` — the first 158 characters of
   the description body, cut mid-sentence, for all 220 products. Search Console
   caught what that costs: «gatsby moving rubber hair wax» sat at position 1.16
   with 134 impressions and no clicks at all (docs/audit/2026-09-07-seo.md).
   A snippet has to answer two questions — what is this, and why buy it here —
   and half a sentence of an ingredient list answers neither.

   So: the shouted heading goes, the product's own first words stay, and the
   three facts a shopper is actually deciding on come after them, always
   whole. The tail is budgeted first and the copy takes what is left, so the
   price is never the half that gets cut off. */
export const DESC_MAX = 158;
export function descFrom(text, t) {
  const tail = t.descTail();
  const lead = dropShout(text) || text;
  if (!lead) return clip(tail, DESC_MAX);
  const room = DESC_MAX - tail.length - 3;   // " · "
  /* A tail so long there is no room for the copy would be a snippet that says
     only the price — then the copy wins and the tail goes. */
  if (room < 40) return clip(lead, DESC_MAX);
  /* A full stop directly before « · » reads as a typo; clip() already drops
     one when it has to cut, so this is the case where the copy fitted whole. */
  return clip(lead, room).replace(/\.$/, "") + " · " + tail;
}

export function productSpec({ base, lang, id, cat, catName: section, brand, name, price, priceFrom, stock, seoTitle, seoDesc, body, image, imageUrls }) {
  const t = T[lang.code];
  const seg = lang.seg;
  const rest = "/p/" + encodeURIComponent(id) + "/";
  const core = brand + " " + name;
  const priceText = (priceFrom ? t.from : "") + eur(price);
  const full = core + " — " + t.buy + " · " + priceText;
  let title = fitTitle(core, full, core + " · " + priceText);
  if (seoTitle) title = fitTitle(seoTitle, "");

  const text = textForSnippet(body);
  const stockText = stock === "out" ? t.out : stock === "low" ? t.low : t.inStock;
  /* An owner's or the assistant's own pair is deliberate and is left alone —
     no price is appended to a sentence somebody wrote on purpose. */
  const desc = seoDesc
    ? clip(seoDesc, DESC_MAX)
    : text
      ? descFrom(text, t)
      : clip(t.prodDesc(priceText, section, stockText), DESC_MAX);

  const crumbItems = [
    [t.home, langPath(seg, "/")],
    [section, langPath(seg, "/c/" + cat + "/")],
    [core, null]
  ];
  const url = base + langPath(seg, rest);
  const productLD = {
    "@context": "https://schema.org", "@type": "Product",
    name: core,
    brand: { "@type": "Brand", name: brand },
    image: imageUrls,
    description: clip(text, 500),
    category: section,
    sku: id,
    url,
    offers: {
      "@type": "Offer",
      priceCurrency: "EUR",
      price: String(price),
      availability: "https://schema.org/" + (stock === "out" ? "OutOfStock" : "InStock"),
      itemCondition: "https://schema.org/NewCondition",
      url,
      seller: { "@type": "Organization", name: "REMPIRE" }
    }
  };

  return {
    lang, seg, rest, title, desc, image, imageAlt: core,
    ogType: "product", ldMain: true,
    jsonld: [productLD, breadcrumbLD(base, crumbItems)],
    core, priceText, stockText, crumbItems
  };
}

/* ---------- the shell ---------------------------------------------------- */

/* public/shop2/index.html is two things at once: the shell every /shop2/
   path falls back to, and the Russian home page. The SEO head and the #app
   content are replaced between these markers; everything else — the asset
   tags with their ?v= token, the script list — stays hand-maintained. */
export const HEAD_MARK = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
export const PRE_MARK = /<!-- prerender:start -->[\s\S]*?<!-- prerender:end -->/;

/* Replacement functions, not strings: a description containing $& or $1 would
   otherwise be spliced by String.replace's own substitution rules. `htmlLang`
   is optional — the prerender patches the Russian home page in place and
   leaves the attribute alone. */
export function patchShell(shell, headHtml, contentHtml, htmlLang) {
  let out = shell
    .replace(HEAD_MARK, () => "<!-- seo:start -->\n" + headHtml + "\n<!-- seo:end -->")
    .replace(PRE_MARK, () => '<!-- prerender:start --><div id="prerender">' + contentHtml + '</div><!-- prerender:end -->');
  if (htmlLang) out = out.replace(/<html lang="[^"]*"/, () => '<html lang="' + esc(htmlLang) + '"');
  return out;
}

/* The viewport every page asks for — written into every generated page by
   tools/prerender-shop2.mjs and patched into the shell's hand-maintained
   head by the same run (reviewport below), checked by tools/check-prerender;
   `npm run build`'s prebuild runs that tool, so a deployment carries it
   whatever the committed index.html says.
   `interactive-widget=resizes-content` (12.09.2026) is for Chrome on Android:
   since Chrome 108 the keyboard shrinks only the visual viewport there, and
   anything fixed to the bottom of the layout viewport — the admin
   assistant's compose row, in its sheet — stayed under the keys (Dim, S21
   FE). With it Chrome shrinks the layout viewport, as it did before and as
   every fixed-bottom bar on the site expects. Safari ignores the key; the
   sheet follows the visual viewport by script there (app.js admVvFollow). */
export const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">';
/** The shell with its viewport meta brought up to VIEWPORT_META; unchanged if it already is. */
export function reviewport(shell) {
  return String(shell).replace(/<meta name="viewport" content="[^"]*">/, () => VIEWPORT_META);
}

/* The shell as a 404: whatever the head says about the home page, the one
   thing a crawler must read is that this address is not to be indexed. */
export function noindexShell(shell) {
  return shell.replace(/<meta name="robots" content="[^"]*">/, () => '<meta name="robots" content="' + ROBOTS_CLOSED + '">');
}

/* ---------- sitemap ------------------------------------------------------ */

export const SITEMAP_OPEN = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
export const SITEMAP_CLOSE = "</urlset>\n";

/* Every language of a page is its own <url>, and each one lists the whole
   cluster — that is what the protocol asks for, and it is what lets Google
   swap in the Estonian result for an Estonian searcher. */
export function sitemapUrlEntry(base, rest, seg, priority, lastmod) {
  const abs = u => base + u;
  const alts = LANGS.map(l =>
    `    <xhtml:link rel="alternate" hreflang="${l.tag}" href="${esc(abs(langPath(l.seg, rest)))}"/>`);
  alts.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(abs(langPath("", rest)))}"/>`);
  return "  <url>\n" +
    `    <loc>${esc(abs(langPath(seg, rest)))}</loc>\n` +
    alts.join("\n") + "\n" +
    `    <lastmod>${lastmod}</lastmod>\n` +
    `    <priority>${priority}</priority>\n` +
    "  </url>";
}

/** The custom products' sitemap the app serves — named once, here, for the prerender's index and the route. */
export const SITEMAP_CUSTOM = "sitemap-custom.xml";

/* The catalogue's product pages are in a sitemap the app serves too, and for
   the same reason the custom products are: what belongs in it is a question
   only the database can answer. «Показывать в магазине» takes a product out of
   the shop while the deployment stands still (db/migrations/147), and a static
   file written at build cannot un-name it — so the products moved out of
   public/sitemap-N.xml and into src/app/sitemap-products.xml/route.ts, which
   drops the hidden ones every time it is asked. Everything the database cannot
   hide — the home pages, categories, brands, policy pages, sets, the gift card
   and the blog — is still a static file. */
export const SITEMAP_PRODUCTS = "sitemap-products.xml";
