/**
 * A blog page built at request time — for the posts the build did not write.
 *
 * tools/prerender-shop2.mjs writes /shop2/{,et/,en/}blog/<slug>/index.html
 * for every post published when `npm run build` ran (blogPostPage /
 * blogListPage there): the per-language Google pair, canonical, the
 * hreflang cluster, OpenGraph, BlogPosting JSON-LD, the article inside
 * #prerender and the list in #blogdata for hydrateBlog(). A post Renat
 * publishes after that deploy had none of it — the /shop2/:path+ fallback
 * handed a crawler (and a link scraper) the Russian home page, and the
 * article only ever existed once app.js had fetched it. This file writes
 * the same page, from the row, when the request arrives — the shell
 * patched between the same marker pairs through the same builders
 * (src/lib/seo-head.mjs), exactly as src/lib/product-page.ts does for a
 * product created in the panel.
 *
 * Served only when there is no static file, by construction rather than by
 * choice: Vercel's static layer answers a prerendered index.html before any
 * rewrite or route runs, and next.config.ts's afterFiles rewrites do the
 * same locally, so the routes below (src/app/shop2/{,et/,en/}blog/[slug])
 * only ever see a slug — or a listing — the build did not write. The
 * prerendered copy of an older post therefore keeps its build-time head
 * until the next deploy (app.js re-syncs the body from the API either way);
 * making these pages win always would mean the prerender stops writing
 * /blog/ pages, a one-line change there once that trade-off is wanted.
 *
 * A draft, an unpublished post and a slug nobody has answer 404 with the
 * shell carrying `noindex, nofollow`, like a hidden product does.
 */
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { getPublishedBySlug, listPublished, pickLang, renderPostBody, type Post, type PostSummary } from "@/lib/blog";
import { BLOG_CACHE_HEADERS } from "@/lib/blog-cache";
import { coverImgStyle } from "@/lib/blog-cover.mjs";
import { customMinByIds, type MinWithVariants } from "@/lib/custom-products";
import { ogStamp } from "@/lib/og-card";
import { getOverrides } from "@/lib/orders";
import { translateProductName } from "@/lib/product-name";
import { readShell } from "@/lib/product-page";
import {
  baseFrom,
  blogCardIds,
  breadcrumbLD,
  cheapestPrice,
  clip,
  crumbs,
  esc,
  eur,
  fillBlogCardPrices,
  fitTitle,
  forSale,
  headBlock,
  href,
  langBySeg,
  langNav,
  langPath,
  noindexShell,
  overriddenPrice,
  patchShell,
  robotsFor,
  stripTags,
  T,
} from "@/lib/seo-head.mjs";

type Lang = { code: "RU" | "ET" | "EN"; seg: string; tag: string; htmlLang: string; ogLocale: string };
type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = new Map((catalogueMin as Min[]).map((p) => [p.id, p]));
type Variants = Record<string, { sizes: string[]; prices: number[] } | undefined>;
const VARIANTS = variantData as Variants;

/** A product under the article: brand, name and price — the links are what a crawler is here for. */
export type ShelfProduct = { id: string; brand: string; name: string; price: number; priceFrom: boolean };

/** How many «Товары из статьи» the shelf shows — the same eight app.js draws. */
const SHELF_MAX = 8;
/** …and how many cards inside the text get a live price. Far past what an
 *  article ever carries (the assistant places at most POST_CARDS_MAX); it is
 *  here so a body somebody pastes cannot turn one render into a long query. */
const INLINE_MAX = 24;

/** Every published post the build did not write — what sitemap-custom.xml lists. Pure. */
export function postsNotPrerendered<P extends { slug: string }>(posts: P[], prerenderedSlugs: string[]): P[] {
  const done = new Set(prerenderedSlugs);
  return posts.filter((p) => !done.has(p.slug));
}

/* ---------- pieces shared by the two pages ------------------------------ */

const dmy = (iso: string | null) => String(iso || "").slice(0, 10).split("-").reverse().join(".");
/** ` style="object-fit:cover;object-position:…"`, or nothing at all when the
    owner never chose — src/lib/blog-cover.mjs owns the words. Written on the
    element rather than into a class because it is one photo's setting, not a
    rule: there is no stylesheet for «this article's cover sits a third of the
    way down». It beats `#prerender .pre__img { object-fit: contain }`, which
    is an id selector and outranks every class this page could reach for. */
const coverStyle = (focus: string | null) => {
  const css = coverImgStyle(focus);
  return css ? ' style="' + css + '"' : "";
};
const stampOf = (p: { updatedAt?: string | null; publishedAt?: string | null }) =>
  Date.parse(p.updatedAt || p.publishedAt || "") || 0;

/** "</" is escaped so a body containing "</script>" cannot end the block early. */
function jsonScript(id: string, obj: unknown): string {
  return '<script type="application/json" id="' + id + '">' + JSON.stringify(obj).replace(/<\//g, "<\\/") + "</script>";
}

function listItem(p: PostSummary, code: string) {
  return {
    slug: p.slug, title: pickLang(p.title, code), excerpt: pickLang(p.excerpt, code),
    coverUrl: p.coverUrl, coverAlt: pickLang(p.coverAlt, code), coverFocus: p.coverFocus,
    tags: p.tags, publishedAt: p.publishedAt,
  };
}

/** #blogdata — the list for this language, adopted by hydrateBlog() before the first paint. */
function dataScript(code: string, posts: PostSummary[], total: number): string {
  if (!posts.length) return "";
  return jsonScript("blogdata", {
    lang: code, stamp: posts.reduce((m, p) => Math.max(m, stampOf(p)), 0),
    posts: posts.slice(0, 10).map((p) => listItem(p, code)), total, perPage: 10,
  });
}

function tile(post: PostSummary, seg: string, code: string): string {
  const title = pickLang(post.title, code) || post.slug;
  const excerpt = pickLang(post.excerpt, code);
  const rest = "/blog/" + encodeURIComponent(post.slug) + "/";
  return '<li><a class="pre__card blog__tile" href="' + href(seg, rest) + '">' +
    (post.coverUrl
      /* 1200×630 — the shape the tile is actually drawn in, here and in the
         prerendered twin (tools/prerender-shop2.mjs blogTile). */
      ? '<img class="pre__img" src="' + esc(post.coverUrl) + '" alt="' + esc(pickLang(post.coverAlt, code) || title) + '" loading="lazy" width="1200" height="630"' + coverStyle(post.coverFocus) + ">"
      : "") +
    '<span class="pre__nm">' + esc(title) + "</span>" +
    (post.publishedAt ? '<span class="muted blog__date">' + dmy(post.publishedAt) + "</span>" : "") +
    (excerpt ? "<p>" + esc(clip(excerpt, 140)) + "</p>" : "") +
    "</a></li>";
}

/** «от 12,90 €» in this language — the shelf's own price line, reused by the
 *  cards inside the text so both read the same figure the same way. */
function priceLabel(p: ShelfProduct, t: { from: string }): string {
  return (p.priceFrom ? t.from : "") + eur(p.price);
}

/* A product's name in this page's language. Catalogue names carry a Russian
   type tail («Bio Botanical Shampoo — шампунь»), and this page printed it as
   it stands on the Estonian and English pages of every article published
   since the last build — the prerender puts the same names through app.js's
   trName() (tools/prerender-shop2.mjs, `tr(…, code, true)`), and
   translateProductName() is that function on the server, held to it name by
   name over the whole catalogue (tests/product-name.test.ts,
   tests/blog-page.test.ts). Russian comes back as it is. */
const nameIn = (name: string, code: string) => translateProductName(name, code);

function shelf(products: ShelfProduct[], seg: string, t: { from: string }, code: string): string {
  return '<ul class="grid" style="list-style:none;padding:0">' + products.map((p) =>
    '<li><a class="pre__card" href="' + href(seg, "/p/" + encodeURIComponent(p.id) + "/") + '">' +
      '<span class="pre__brand">' + esc(p.brand) + "</span>" +
      '<span class="pre__nm">' + esc(nameIn(p.name, code)) + "</span>" +
      '<span class="pre__pr num">' + esc(priceLabel(p, t)) + "</span>" +
    "</a></li>").join("") + "</ul>";
}

/** The card /shop2/og/blog-<slug>[.et|.en].png draws at request time (src/lib/og-card.ts). */
function ogImage(base: string, post: Post, lang: Lang): string {
  return `${base}/shop2/og/blog-${encodeURIComponent(post.slug)}${lang.seg ? "." + lang.seg : ""}.png?v=${ogStamp(post.updatedAt)}`;
}

/* ---------- the two pages ------------------------------------------------ */

export function renderBlogPostPage(
  post: Post,
  list: { posts: PostSummary[]; total: number },
  lang: Lang,
  shell: string,
  opts: {
    base: string; robots: string; products: ShelfProduct[]; inline?: ShelfProduct[];
    /** Ids whose /p/ address answers 404 — see shelfProducts(). */
    offSale?: ReadonlySet<string>;
  },
): string {
  const { base, robots } = opts;
  const code = lang.code;
  const seg = lang.seg;
  const t = T[code];
  const rest = "/blog/" + encodeURIComponent(post.slug) + "/";
  const title = pickLang(post.title, code) || post.slug;
  const excerpt = pickLang(post.excerpt, code);
  const bodyHtml = renderPostBody(pickLang(post.body, code));
  const bodyText = stripTags(bodyHtml);
  /* The article as it is READ, which is the stored body plus the prices that
     are deliberately not stored in it (fillBlogCardPrices in seo-head.mjs).
     `bodyHtml` itself is left alone: it is what #blogpost below carries, and
     that block is the very answer /api/blog/<slug>/ gives — app.js adopts it
     and builds its own cards from the live catalogue, so a price written in
     here would be a figure nobody reads and one more thing to keep in step.
     `bodyText` feeds the meta description, which has no business carrying a
     price either. A body of the old shape comes back byte for byte.

     `seg` and the name go with the price because the marker the ASSISTANT
     writes carries neither an href nor any words — see the three shapes
     beside fillBlogCardPrices() in seo-head.mjs. The name is this shelf's
     own «brand + name», so a card inside the text reads exactly like the
     card under the article.

     `offSale` is the other half of the same question, and it is why the
     shelf answers in two parts: a product the owner has HIDDEN cannot be
     priced either, but its card must also stop linking — the «Товар» button
     stores its href in the body, so leaving that card alone left a live link
     to an address the middleware answers 404 for. */
  const inlineOf = (id: string) => (opts.inline ?? []).find((x) => x.id === id);
  const bodyShown = fillBlogCardPrices(
    bodyHtml,
    (id: string) => {
      const p = inlineOf(id);
      return p ? priceLabel(p, t) : "";
    },
    {
      seg,
      nameOf: (id: string) => {
        const p = inlineOf(id);
        return p ? nameIn(p.brand + " " + p.name, code) : "";
      },
      offSale: (id: string) => !!opts.offSale?.has(id),
    },
  );
  // the Google pair is per language (pickLang: this language, else Russian);
  // the excerpt, then the text, stand in only when neither was written — the
  // same ladder setHead() in app.js runs once the SPA takes the page over
  const desc = clip(pickLang(post.seoDesc, code) || excerpt || bodyText, 158);
  const seoTitleRaw = pickLang(post.seoTitle, code);
  const pageTitle = fitTitle(title, (seoTitleRaw || title) + " — REMPIRE");
  const crumbItems: Array<[string, string | null]> = [[t.home, langPath(seg, "/")], [t.blog, langPath(seg, "/blog/")], [title, null]];
  const others = list.posts.filter((p) => p.slug !== post.slug).slice(0, 3);
  const image = ogImage(base, post, lang);
  const url = base + langPath(seg, rest);

  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<article class="sec blog__post blog__read">' +
      (post.coverUrl
        ? '<img class="pre__img blog__cover" src="' + esc(post.coverUrl) + '" alt="' + esc(pickLang(post.coverAlt, code) || title) + '" width="1200" height="630"' + coverStyle(post.coverFocus) + ">"
        : "") +
      '<h1 class="display h1">' + esc(title) + "</h1>" +
      (post.publishedAt ? '<p class="muted blog__date">' + dmy(post.publishedAt) + "</p>" : "") +
      (post.tags.length ? '<ul class="blog__tags">' + post.tags.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
      '<div class="acc__rich blog__body">' + bodyShown + "</div>" +
    "</article>" +
    (opts.products.length
      ? '<section class="sec blog__shelf"><h2 class="display h1 blog__h2">' + esc(t.postProducts) + "</h2>" + shelf(opts.products, seg, t, code) + "</section>"
      : "") +
    (others.length
      ? '<section class="sec blog__shelf"><h2 class="display h1 blog__h2">' + esc(t.otherPosts) + "</h2>" +
        '<ul class="grid blog__grid" style="list-style:none;padding:0">' + others.map((p) => tile(p, seg, code)).join("") + "</ul></section>"
      : "") +
    langNav(seg, rest, t) +
    // #blogpost and #blogdata: the same shapes /api/blog/<slug>/ and
    // /api/blog/ answer, so hydrateBlog() paints the article at once
    jsonScript("blogpost", { lang: code, stamp: stampOf(post), post: {
      slug: post.slug, title, excerpt, bodyHtml, coverUrl: post.coverUrl, coverAlt: pickLang(post.coverAlt, code),
      coverFocus: post.coverFocus,
      tags: post.tags, products: post.products, seoTitle: seoTitleRaw, seoDesc: pickLang(post.seoDesc, code),
      author: post.author, publishedAt: post.publishedAt,
    } }) +
    dataScript(code, list.posts, list.total) +
    "</div>";

  const head = headBlock({
    base, robots, lang, seg, rest,
    title: pageTitle, desc, image, imageAlt: title, ogType: "article", ldMain: false,
    jsonld: [
      {
        "@context": "https://schema.org", "@type": "BlogPosting",
        headline: title,
        image: [image],
        datePublished: post.publishedAt || post.updatedAt,
        dateModified: post.updatedAt || post.publishedAt,
        author: { "@type": "Organization", name: post.author || "Rempire" },
        publisher: { "@type": "Organization", name: "REMPIRE", logo: { "@type": "ImageObject", url: base + "/brand/rempire-tower.svg" } },
        description: desc,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        url,
      },
      breadcrumbLD(base, crumbItems),
    ],
  });
  return patchShell(shell, head, content, lang.htmlLang);
}

export function renderBlogListPage(
  list: { posts: PostSummary[]; total: number },
  lang: Lang,
  shell: string,
  opts: { base: string; robots: string },
): string {
  const { base, robots } = opts;
  const code = lang.code;
  const seg = lang.seg;
  const t = T[code];
  const rest = "/blog/";
  const heading = t.blog;
  const content = '<div class="wrap">' +
    crumbs([[t.home, esc(langPath(seg, "/"))], [heading, null]]) +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      (list.posts.length
        ? '<ul class="grid blog__grid" style="list-style:none;padding:0">' + list.posts.map((p) => tile(p, seg, code)).join("") + "</ul>"
        : '<p class="muted">' + esc(t.blogEmpty) + "</p>") +
    "</section>" +
    langNav(seg, rest, t) +
    dataScript(code, list.posts, list.total) +
    "</div>";
  const first = list.posts[0];
  const head = headBlock({
    base, robots, lang, seg, rest,
    title: fitTitle(heading, heading + " — REMPIRE"),
    desc: clip(t.blogDesc, 158),
    image: first ? `${base}/shop2/og/blog-${encodeURIComponent(first.slug)}${seg ? "." + seg : ""}.png?v=${ogStamp(first.updatedAt)}` : base + "/brand/og-default.png",
    imageAlt: heading, ogType: "website", ldMain: false,
    jsonld: [
      breadcrumbLD(base, [[t.home, langPath(seg, "/")], [heading, null]]),
      {
        "@context": "https://schema.org", "@type": "ItemList",
        name: heading, numberOfItems: list.total,
        itemListElement: list.posts.slice(0, 50).map((p, i) => ({
          "@type": "ListItem", position: i + 1,
          url: base + langPath(seg, "/blog/" + encodeURIComponent(p.slug) + "/"),
          name: pickLang(p.title, code) || p.slug,
        })),
      },
    ],
  });
  return patchShell(shell, head, content, lang.htmlLang);
}

/* ---------- the responses ------------------------------------------------ */

const HTML = "text/html; charset=utf-8";
/** Edge-cached for a minute, like the API and the product page — and filed
    under the blog's tag, so a save in the panel drops every language's copy
    at once instead of waiting it out (src/lib/blog-cache.ts). */
const PAGE_CACHE = "public, s-maxage=60, stale-while-revalidate=300";
const NO_STORE = "no-store";

function html(body: string, status: number, cacheControl: string): Response {
  return new Response(body, { status, headers: { "content-type": HTML, "cache-control": cacheControl, ...BLOG_CACHE_HEADERS } });
}

/** The lowest price of a ladder, and whether the ladder holds more than one.
    In seo-head.mjs, because the build prices the same articles from the same
    table and must reach the same number — see the note above it there. */
const cheapest = cheapestPrice as (prices: Array<number | null | undefined>, fallback: number) => { price: number; from: boolean };

/**
 * The products under an article: catalogue rows by id, the owner's own rows
 * through their table, and — for both — the owner's own price.
 *
 * Until 17.09.2026 a catalogue product here was read out of catalogue.min and
 * nothing else, which got three things wrong on a page nobody with JS ever
 * sees (a crawler, a link scraper, a reader with scripts off):
 *
 *   · «9 €» for the 57 of 220 products sold from several sizes, where the
 *     shop itself says «от 9 €» — the file carries the cheapest rung only;
 *   · the price the last deploy was built with, for a product repriced in
 *     the panel since (product_overrides.price, and the `sizes` ladder);
 *   · a product switched off with «Показывать в магазине»
 *     (product_overrides.hidden) still listed, and still linked to a /p/
 *     address that answers 404 noindex.
 *
 * Best effort on the database, exactly as the letter's cards are
 * (newsletterCards in src/lib/newsletters.ts, the same shape of work): a
 * hiccup costs the owner's price, never the article.
 *
 * Since 17.09.2026 it answers for the cards INSIDE the text as well, which is
 * the same question about the same products — the shelf under the article
 * takes the first `max` of `ids` and the body takes its own. One call for
 * both: a page that named eight products under the article and three in the
 * text would otherwise ask the overrides table twice for one render.
 *
 * It answers in two parts, because a card inside the text needs to know WHY a
 * product is not on the shelf. `offSale` holds the ids this call is CERTAIN
 * have no page to link to — `/shop2/{,et/,en/}p/<id>/` answers 404 noindex
 * for each of them (src/middleware.ts for a hidden catalogue product,
 * src/lib/product-page.ts for an unknown id and for one of the owner's own
 * that is gone or switched off). A product the query could not speak for is
 * deliberately NOT in it: a database that did not answer costs the price, and
 * a price is all it costs.
 */
async function shelfProducts(
  ids: string[],
  max = 8,
): Promise<{ products: ShelfProduct[]; offSale: Set<string> }> {
  const want = ids.slice(0, max);
  const catIds = want.filter((id) => CATALOGUE.has(id));
  const customIds = want.filter((id) => !CATALOGUE.has(id) && id.startsWith("c-"));

  let overrides: Awaited<ReturnType<typeof getOverrides>> = {};
  let customAnswered = true;
  if (catIds.length) {
    try {
      overrides = await getOverrides(catIds);
    } catch (err) {
      console.error("[blog-page] overrides unavailable, catalogue prices used:", err);
    }
  }
  let custom = new Map<string, MinWithVariants>();
  if (customIds.length) {
    try {
      custom = await customMinByIds(customIds);
    } catch (err) {
      customAnswered = false;
      console.error("[blog-page] custom products unavailable:", err);
    }
  }

  const out: ShelfProduct[] = [];
  const offSale = new Set<string>();
  for (const id of want) {
    const c = custom.get(id);
    if (c) {
      /* `s` on one of the owner's own rows is `active`, not a stock count
         (toMin() in src/lib/custom-products.ts) — «out» means he has switched
         it off, and src/lib/product-page.ts answers its address 404 for
         exactly that. Off sale, then, in the same sense `hidden` is below. */
      if (c.min.s === "out") {
        offSale.add(id);
        continue;
      }
      const { price, from } = cheapest(c.variants?.prices ?? [c.min.p], c.min.p);
      out.push({ id, brand: c.min.b, name: c.min.n, price, priceFrom: from });
      continue;
    }
    const m = CATALOGUE.get(id);
    if (!m) {
      /* Not in the file. One of the owner's own that the table did not hand
         back is gone or switched off — but only when the table answered at
         all, or a hiccup would take the link off a product that is on sale.
         Anything else is not a product id the shop has ever had. */
      if (!id.startsWith("c-")) offSale.add(id);
      else if (customAnswered) offSale.add(id);
      continue;
    }
    const o = overrides[id];
    /* «Показывать в магазине» off — forSale() in seo-head.mjs, the same call
       the build makes before it draws a grid tile, so an article and a
       category page cannot disagree about which products still have a page.
       `overrides` is empty when the query threw, so this cannot fire on a
       hiccup — it fires only on a row that said so. */
    if (!forSale(o)) {
      offSale.add(id);
      continue;
    }
    /* The owner's ladder over the file's, and the file's only where it really
       spreads — overriddenPrice() in seo-head.mjs owns that rule, so the
       build reaches the same number for the same article. */
    const { price, from } = overriddenPrice(m.p, VARIANTS[id]?.prices ?? [], o);
    out.push({ id, brand: m.b, name: m.n, price, priceFrom: from });
  }
  return { products: out, offSale };
}

/** GET /shop2/{,et/,en/}blog/<slug>/ for a slug the prerender did not write. */
export async function blogPostPageResponse(slug: string, seg: string): Promise<Response> {
  const shell = readShell();
  const lang = langBySeg(seg) as Lang | null;
  if (!lang) return html(shell, 200, "public, max-age=0, must-revalidate");
  const clean = String(slug || "").trim();
  if (!clean || clean.length > 80) return html(noindexShell(shell), 404, NO_STORE);

  let post: Post | null;
  let list: { posts: PostSummary[]; total: number };
  try {
    post = await getPublishedBySlug(clean);
    list = post ? await listPublished(1, 10) : { posts: [], total: 0 };
  } catch (err) {
    /* No database: the shell it is — app.js asks the API itself, and shows
       «временно недоступен» if that fails too; a 5xx would show nothing. */
    console.error("[blog-page] post unavailable:", err);
    return html(shell, 200, NO_STORE);
  }
  if (!post) return html(noindexShell(shell), 404, NO_STORE);

  /* The shelf under the article and the cards inside it, priced together.
     The body is this language's — a card may stand in the Estonian text and
     not in the Russian one — so the ids are read from the body that is about
     to be rendered, and only a body of the new shape names any at all. */
  const inlineIds = blogCardIds(renderPostBody(pickLang(post.body, lang.code)));
  const shelfIds = post.products.slice(0, SHELF_MAX);
  const { products: resolved, offSale } = await shelfProducts(
    [...new Set([...shelfIds, ...inlineIds])],
    SHELF_MAX + INLINE_MAX,
  );
  const byId = new Map(resolved.map((p) => [p.id, p]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is ShelfProduct => !!p);

  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  const robots = robotsFor(process.env.PUBLIC_BASE_URL);
  return html(
    renderBlogPostPage(post, list, lang, shell, {
      base, robots, products: pick(shelfIds), inline: pick(inlineIds.slice(0, INLINE_MAX)), offSale,
    }),
    200,
    PAGE_CACHE,
  );
}

/** GET /shop2/{,et/,en/}blog/ when the build wrote no listing (no database at build time). */
export async function blogListPageResponse(seg: string): Promise<Response> {
  const shell = readShell();
  const lang = langBySeg(seg) as Lang | null;
  if (!lang) return html(shell, 200, "public, max-age=0, must-revalidate");

  let list: { posts: PostSummary[]; total: number };
  try {
    list = await listPublished(1, 50);
  } catch (err) {
    console.error("[blog-page] list unavailable:", err);
    return html(shell, 200, NO_STORE);
  }
  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  const robots = robotsFor(process.env.PUBLIC_BASE_URL);
  return html(renderBlogListPage(list, lang, shell, { base, robots }), 200, PAGE_CACHE);
}
