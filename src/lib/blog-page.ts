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
import { customMinByIds, type MinWithVariants } from "@/lib/custom-products";
import { ogStamp } from "@/lib/og-card";
import { getOverrides } from "@/lib/orders";
import { readShell } from "@/lib/product-page";
import {
  baseFrom,
  blogCardIds,
  breadcrumbLD,
  clip,
  crumbs,
  esc,
  eur,
  fillBlogCardPrices,
  fitTitle,
  headBlock,
  href,
  langBySeg,
  langNav,
  langPath,
  noindexShell,
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
const stampOf = (p: { updatedAt?: string | null; publishedAt?: string | null }) =>
  Date.parse(p.updatedAt || p.publishedAt || "") || 0;

/** "</" is escaped so a body containing "</script>" cannot end the block early. */
function jsonScript(id: string, obj: unknown): string {
  return '<script type="application/json" id="' + id + '">' + JSON.stringify(obj).replace(/<\//g, "<\\/") + "</script>";
}

function listItem(p: PostSummary, code: string) {
  return {
    slug: p.slug, title: pickLang(p.title, code), excerpt: pickLang(p.excerpt, code),
    coverUrl: p.coverUrl, coverAlt: pickLang(p.coverAlt, code), tags: p.tags, publishedAt: p.publishedAt,
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
      ? '<img class="pre__img" src="' + esc(post.coverUrl) + '" alt="' + esc(pickLang(post.coverAlt, code) || title) + '" loading="lazy" width="400" height="400">'
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

function shelf(products: ShelfProduct[], seg: string, t: { from: string }): string {
  return '<ul class="grid" style="list-style:none;padding:0">' + products.map((p) =>
    '<li><a class="pre__card" href="' + href(seg, "/p/" + encodeURIComponent(p.id) + "/") + '">' +
      '<span class="pre__brand">' + esc(p.brand) + "</span>" +
      '<span class="pre__nm">' + esc(p.name) + "</span>" +
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
  opts: { base: string; robots: string; products: ShelfProduct[]; inline?: ShelfProduct[] },
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
     price either. A body of the old shape comes back byte for byte. */
  const bodyShown = fillBlogCardPrices(bodyHtml, (id: string) => {
    const p = (opts.inline ?? []).find((x) => x.id === id);
    return p ? priceLabel(p, t) : "";
  });
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
        ? '<img class="pre__img blog__cover" src="' + esc(post.coverUrl) + '" alt="' + esc(pickLang(post.coverAlt, code) || title) + '" width="1200" height="630">'
        : "") +
      '<h1 class="display h1">' + esc(title) + "</h1>" +
      (post.publishedAt ? '<p class="muted blog__date">' + dmy(post.publishedAt) + "</p>" : "") +
      (post.tags.length ? '<ul class="blog__tags">' + post.tags.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
      '<div class="acc__rich blog__body">' + bodyShown + "</div>" +
    "</article>" +
    (opts.products.length
      ? '<section class="sec blog__shelf"><h2 class="display h1 blog__h2">' + esc(t.postProducts) + "</h2>" + shelf(opts.products, seg, t) + "</section>"
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
/** Edge-cached for a minute, like the API and the product page: an edit is visible within it. */
const PAGE_CACHE = "public, s-maxage=60, stale-while-revalidate=300";
const NO_STORE = "no-store";

function html(body: string, status: number, cacheControl: string): Response {
  return new Response(body, { status, headers: { "content-type": HTML, "cache-control": cacheControl } });
}

/** The lowest price of a ladder, and whether the ladder holds more than one. */
function cheapest(prices: Array<number | null | undefined>, fallback: number): { price: number; from: boolean } {
  const list = prices.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
  if (!list.length) return { price: fallback, from: false };
  return { price: Math.min(...list), from: new Set(list).size > 1 };
}

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
 */
async function shelfProducts(ids: string[], max = 8): Promise<ShelfProduct[]> {
  const want = ids.slice(0, max);
  const catIds = want.filter((id) => CATALOGUE.has(id));
  const customIds = want.filter((id) => !CATALOGUE.has(id) && id.startsWith("c-"));

  let overrides: Awaited<ReturnType<typeof getOverrides>> = {};
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
      console.error("[blog-page] custom products unavailable:", err);
    }
  }

  const out: ShelfProduct[] = [];
  for (const id of want) {
    const c = custom.get(id);
    if (c) {
      if (c.min.s === "out") continue;
      const { price, from } = cheapest(c.variants?.prices ?? [c.min.p], c.min.p);
      out.push({ id, brand: c.min.b, name: c.min.n, price, priceFrom: from });
      continue;
    }
    const m = CATALOGUE.get(id);
    if (!m) continue;
    const o = overrides[id];
    if (o?.hidden) continue;
    /* The file's ladder only speaks for the price where it actually spreads.
       Since 18.09.2026 catalogue.variants.json also carries the 29 products
       sold in ONE named size, whose single price is catalogue.min.json's own
       `p` — taking it here would quietly out-vote the owner's «Цена» in
       «Товары» and put the pre-override number under an article. The owner's
       own saved ladder still decides outright: every rung of it carries the
       price he typed (migration 147). */
    const fileLadder = VARIANTS[id]?.prices ?? [];
    const ladder = o?.sizes?.length ? o.sizes.map((r) => r.price) : fileLadder.length > 1 ? fileLadder : [];
    const base = o?.price ?? m.p;
    const { price, from } = ladder.length ? cheapest(ladder, base) : { price: base, from: false };
    out.push({ id, brand: m.b, name: m.n, price, priceFrom: from });
  }
  return out;
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
  const resolved = await shelfProducts([...new Set([...shelfIds, ...inlineIds])], SHELF_MAX + INLINE_MAX);
  const byId = new Map(resolved.map((p) => [p.id, p]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is ShelfProduct => !!p);

  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  const robots = robotsFor(process.env.PUBLIC_BASE_URL);
  return html(
    renderBlogPostPage(post, list, lang, shell, {
      base, robots, products: pick(shelfIds), inline: pick(inlineIds.slice(0, INLINE_MAX)),
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
