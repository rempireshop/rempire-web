/* The blog as a magazine — the parts every renderer of it shares.

   Dim approved the design on 02.11.2026 (canvas-banner/project/BlogHome,
   BlogPhone and Article, modelled on kevinmurphy.com.au's blog): a big
   featured story on a darkened photo, «Блог» with the article count and five
   topic chips, a three-column grid of covers in their OWN shape (one column
   on a phone), a beige typographic tile for an article with no cover, and an
   article page with a byline, a lead, a strip of the article's products, the
   materials it was written from and «Читать дальше».

   Three things draw those pages, and this file is what keeps them one page:

     · tools/prerender-shop2.mjs writes the static page at build time;
     · src/lib/blog-page.ts writes the same page at request time for an
       article published after the build;
     · public/shop2/app.js paints it in the browser (bmag… functions there),
       over the static copy, in the same task, before the first paint.

   The first two import the builders below. The third cannot import anything
   (no build step) and carries a twin of the markup; tests/blog-magazine.test.ts
   holds the twin's topic names and strings to this file.

   Plain ESM for the reason src/lib/blog-html.mjs and src/lib/seo-head.mjs
   are: the prerender runs as a bare `node` script, and the Next routes and
   the tests import this file unchanged.

   What is NOT here: the body renderer (blog-html.mjs), the cover's crop
   vocabulary (blog-cover.mjs), the products' prices (each renderer prices
   from its own source and hands the strings in). */

import { readCoverFocus, coverImgStyle } from "./blog-cover.mjs";
import { esc, pickTags } from "./seo-head.mjs";

/* ---------- the public shapes -------------------------------------------
   One article as /api/blog/ lists it, and as /api/blog/<slug>/ answers it —
   the SAME objects the prerender embeds in #blogdata / #blogpost and the
   request-time page embeds in its own. app.js compares what a page carried
   with what the API answers (blogSig) and repaints when they differ, so two
   writers of one shape would repaint every article once for nothing. */
const LANGS3 = ["RU", "ET", "EN"];
function pick(t, lang) {
  const v = t || {};
  const L = LANGS3.includes(lang) ? lang : "RU";
  return v[L] || v.RU || v.ET || v.EN || "";
}
function pickNum(t, lang) {
  const L = LANGS3.includes(lang) ? lang : "RU";
  return (t && Number(t[L])) || 0;
}
/** The Google pair (`seoTitle` / `seoDesc`) in this language — "" when an
    article translated into it has no pair of its own there, so its own title
    and excerpt stand in. Until 03.11.2026 that case fell back to the Russian
    pair: the Claude connector's save_draft took a Russian pair only, and four
    of Renat's articles went to Google with a Russian headline on their
    English and Estonian pages. An article never translated into this language
    shows Russian there anyway, and keeps the Russian pair. Every renderer of
    the head calls this: the prerender, src/lib/blog-page.ts, and publicPost
    below, whose answer setHead() in app.js reads. */
export function pickSeo(seo, title, lang) {
  const L = LANGS3.includes(lang) ? lang : "RU";
  const own = seo && typeof seo[L] === "string" ? seo[L].trim() : "";
  if (own) return own;
  const translated = L !== "RU" && title && typeof title[L] === "string" && title[L].trim();
  return translated ? "" : pick(seo, L);
}
export function publicListItem(p, lang) {
  return {
    slug: p.slug, title: pick(p.title, lang), excerpt: pick(p.excerpt, lang),
    coverUrl: p.coverUrl, coverAlt: pick(p.coverAlt, lang), coverFocus: p.coverFocus,
    coverW: p.coverW ?? null, coverH: p.coverH ?? null,
    tags: pickTags(p.tags, p.tagsI18n, lang), publishedAt: p.publishedAt,
    topic: p.topic, minutes: pickNum(p.minutes, lang), productCount: Array.isArray(p.products) ? p.products.length : 0,
  };
}
/** …and the article. `bodyHtml` is the caller's (renderPostBody of this language). */
export function publicPost(p, lang, bodyHtml) {
  return {
    slug: p.slug, title: pick(p.title, lang), excerpt: pick(p.excerpt, lang), bodyHtml,
    coverUrl: p.coverUrl, coverAlt: pick(p.coverAlt, lang), coverFocus: p.coverFocus,
    coverW: p.coverW ?? null, coverH: p.coverH ?? null,
    tags: pickTags(p.tags, p.tagsI18n, lang), products: p.products,
    seoTitle: pickSeo(p.seoTitle, p.title, lang), seoDesc: pickSeo(p.seoDesc, p.title, lang),
    author: p.author, publishedAt: p.publishedAt,
    topic: p.topic, minutes: pickNum(p.minutes, lang),
    // the materials' names go out only when the owner shows them (Dim, 02.11.2026)
    sources: p.showSources && Array.isArray(p.sources) ? p.sources : [],
  };
}

/* ---------- topics ------------------------------------------------------- */

/** The five chips, in the order the shop shows them. */
export const BLOG_TOPICS = ["hair", "beard", "styling", "skin", "studio"];

/** A chip's name in each language — «Стайлинг» is «Viimistlus» in Estonian,
    the word the shop's own Styling section already uses (CAT_NAMES_I18N). */
export const TOPIC_NAMES = {
  hair: { RU: "Волосы", ET: "Juuksed", EN: "Hair" },
  beard: { RU: "Борода", ET: "Habe", EN: "Beard" },
  styling: { RU: "Стайлинг", ET: "Viimistlus", EN: "Styling" },
  skin: { RU: "Кожа", ET: "Nahk", EN: "Skin" },
  studio: { RU: "Студия", ET: "Stuudio", EN: "The studio" },
};

export function isTopic(v) {
  return typeof v === "string" && BLOG_TOPICS.includes(v);
}

export function topicName(topic, code) {
  const t = TOPIC_NAMES[topic];
  return t ? t[code] || t.RU : "";
}

/* What each topic's articles say about themselves. Read off the title, the
   tags and the excerpt, in any of the three languages. «Кожа головы» is the
   scalp — a hair article — so it is taken out before «кожа» is looked for. */
const SCALP = /кож[а-яё]*\s+голов[а-яё]*|peanahk[a-zõäöü]*|scalp/gi;
const WORDS = {
  hair: /волос|шампун|кондиционер|ополаскивател|маск[аиу] для волос|перхот|juuks|šampoon|palsam|hair|shampoo|conditioner|dandruff|scalp/gi,
  beard: /бород|усы|усов|бритьё|бритв|после бритья|habe|vunts|raseeri|beard|moustache|mustache|shav/gi,
  /* No \b next to a Cyrillic letter: JavaScript's word boundary knows only
     ASCII word characters, so «паста\b» never matches «паста ». */
  styling: /стайлинг|укладк|паст[аыу]|воск|глин[аыу]|помад|гел[ья] для|лак для|viimistl|soeng|vaha|savi|styling|pomade|\bwax|\bclay|\bpaste|\bgel\b/gi,
  skin: /кож[аиуе]|лиц[оау]|тонер|сыворотк|крем для лица|spf|корейск|nahk|näo|toonik|seerum|\bskin|\bface|toner|serum|k-beauty/gi,
  studio: /студи|салон|барбершоп|команд[аы] |поставк|оригинал|подделк|stuudio|salong|barbershop|\bstudio|\bsalon|\bteam|authentic|counterfeit|original/gi,
};
/* The shop's own sections, as a topic: the products an article names are the
   strongest hint there is when its words are not clear. Perfume says nothing. */
const CAT_TOPIC = { hair: "hair", styling: "styling", beard: "beard", face: "skin", body: "skin", merch: "studio" };

function hits(text, topic) {
  const m = String(text || "").replace(SCALP, " scalp ").match(WORDS[topic]);
  return m ? m.length : 0;
}

/**
 * Which chip an article sits under when nobody chose one: the topic its
 * title (×3), tags (×2), excerpt (×1) and products' sections (×1 each, at
 * most 4) point at most. A tie goes to the earlier chip; an article that
 * points nowhere is about the salon itself — «Студия».
 *
 * `catOf(id)` → the product's shop section ("hair", "face", …) or "".
 */
export function guessTopic(post, catOf) {
  const p = post || {};
  const pickAll = (v) => (v && typeof v === "object" ? Object.values(v).join(" ") : String(v || ""));
  const title = pickAll(p.title);
  const tags = [].concat(p.tags || [], (p.tagsI18n && p.tagsI18n.ET) || [], (p.tagsI18n && p.tagsI18n.EN) || []).join(" ");
  const excerpt = pickAll(p.excerpt);
  const score = Object.fromEntries(BLOG_TOPICS.map((t) => [t, 0]));
  for (const t of BLOG_TOPICS) score[t] += hits(title, t) * 3 + hits(tags, t) * 2 + hits(excerpt, t);
  const byCat = Object.fromEntries(BLOG_TOPICS.map((t) => [t, 0]));
  for (const id of Array.isArray(p.products) ? p.products : []) {
    const t = CAT_TOPIC[typeof catOf === "function" ? catOf(id) || "" : ""];
    if (t) byCat[t] += 1;
  }
  for (const t of BLOG_TOPICS) score[t] += Math.min(4, byCat[t]);
  let best = "studio", top = 0;
  for (const t of BLOG_TOPICS) if (score[t] > top) { best = t; top = score[t]; }
  return best;
}

/* ---------- read time ---------------------------------------------------- */

/** Words a minute — an unhurried reader of Russian or Estonian prose. */
export const WORDS_PER_MINUTE = 200;

/** The words of an article body (HTML or markdown): tags out, entities as a space. */
export function wordCount(body) {
  const text = String(body || "")
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length;
}

/** «9 мин чтения»: the minutes, rounded up; 0 for an article with no words. */
export function readMinutes(body) {
  const n = wordCount(body);
  return n ? Math.max(1, Math.ceil(n / WORDS_PER_MINUTE)) : 0;
}

/* ---------- sources ------------------------------------------------------ */

export const SOURCES_MAX = 12;
export const SOURCE_MAX_LEN = 140;

/** The «Написано по материалам» lines: one line each, short, no repeats. */
export function cleanSources(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, SOURCE_MAX_LEN).trim();
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length >= SOURCES_MAX) break;
  }
  return out;
}

/** The box shows only when the owner switched it on AND there is something to name. */
export function sourcesShown(post) {
  return !!(post && post.showSources && Array.isArray(post.sources) && post.sources.length);
}

/* ---------- which articles go where -------------------------------------- */

/** At most three articles are «На главной блога» at a time. */
export const FEATURED_MAX = 3;

/** The carousel: the articles marked for it (newest first, three at most) —
    or, while none is, the newest one alone. `posts` is newest first. */
export function pickFeatured(posts, featured) {
  const marked = (Array.isArray(featured) && featured.length ? featured : (posts || []).filter((p) => p && p.featured))
    .slice(0, FEATURED_MAX);
  if (marked.length) return marked;
  return posts && posts.length ? [posts[0]] : [];
}

/** «Читать дальше»: two more of the same topic, newest first; the newest
    others fill in when the topic has fewer. */
export function readNext(post, posts, n = 2) {
  const others = (posts || []).filter((p) => p && p.slug !== post.slug);
  const same = others.filter((p) => p.topic && p.topic === post.topic);
  const rest = others.filter((p) => !same.includes(p));
  return same.concat(rest).slice(0, n);
}

/** The cover's own shape, when it is known; null for an older cover nobody measured. */
export function coverDims(p) {
  const w = Math.round(Number(p && p.coverW)), h = Math.round(Number(p && p.coverH));
  return w > 0 && h > 0 ? { w, h } : null;
}

/* The grid's three columns, filled the way a magazine is: each card goes
   under the column that is shortest so far, by the height its cover will
   really take (its own shape — the reason the shapes are stored) plus the
   text under it. A tile without a cover is 4:5, as drawn. Deterministic, so
   the static page and app.js lay the same articles out the same way; on a
   phone the three collapse into one in the articles' own order (styles.css
   .bmag__col, display: contents, and each card's `order`). */
const TEXT_SHARE = 0.42;   // the eyebrow, two lines of title and two of excerpt, in widths of the column
export function masonry(items, cols = 3) {
  const out = Array.from({ length: cols }, () => []);
  const height = Array.from({ length: cols }, () => 0);
  items.forEach((p, i) => {
    const d = p && p.coverUrl ? coverDims(p) : null;
    const ratio = p && p.coverUrl ? (d ? d.h / d.w : 630 / 1200) : 5 / 4;
    let c = 0;
    for (let k = 1; k < cols; k++) if (height[k] < height[c] - 1e-9) c = k;
    out[c].push(i);
    height[c] += Math.min(ratio, 1.6) + TEXT_SHARE;
  });
  return out;
}

/* ---------- words -------------------------------------------------------- */

/* The interface sentences, in the shop's three languages. app.js carries the
   same sentences in its UI table (and UI_RX for the counted ones) — the test
   beside this file holds the two together. */
export const STR = {
  RU: {
    featured: "Избранные статьи", read: "Читать статью", prevSlide: "Предыдущая статья", nextSlide: "Следующая статья", of: "из", topics: "Темы", all: "Все",
    askEye: "Не знаете, что подойдёт?", askText: "Спросите помощника — он отвечает по этим статьям и подборкам нашего салона.",
    askBtn: "Задать вопрос", team: "Команда салона Rempire", inThis: "В этой статье", inThisLabel: "Товары в этой статье",
    sources: "Написано по материалам", askPost: "Спросить об этой статье", next: "Читать дальше", none: "В этой теме пока нет статей.",
  },
  ET: {
    featured: "Esiletõstetud artiklid", read: "Loe artiklit", prevSlide: "Eelmine artikkel", nextSlide: "Järgmine artikkel", of: "/", topics: "Teemad", all: "Kõik",
    askEye: "Ei tea, mis sobib?", askText: "Küsi abilise käest — ta vastab nende artiklite ja meie salongi valikute põhjal.",
    askBtn: "Esita küsimus", team: "Rempire salongi meeskond", inThis: "Selles artiklis", inThisLabel: "Tooted selles artiklis",
    sources: "Kirjutatud materjalide põhjal", askPost: "Küsi selle artikli kohta", next: "Loe veel", none: "Selles teemas pole veel artikleid.",
  },
  EN: {
    featured: "Featured articles", read: "Read the article", prevSlide: "Previous article", nextSlide: "Next article", of: "of", topics: "Topics", all: "All",
    askEye: "Not sure what fits you?", askText: "Ask the assistant — it answers from these articles and our salon's picks.",
    askBtn: "Ask a question", team: "Rempire salon team", inThis: "In this article", inThisLabel: "Products in this article",
    sources: "Written from", askPost: "Ask about this article", next: "Read next", none: "No articles in this topic yet.",
  },
};
const S = (code) => STR[code] || STR.RU;

function ruPl(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}
/** «6 статей» · «6 artiklit» · «6 articles». */
export function articlesWord(n, code) {
  if (code === "ET") return n === 1 ? "1 artikkel" : n + " artiklit";
  if (code === "EN") return n === 1 ? "1 article" : n + " articles";
  return n + " " + ruPl(n, "статья", "статьи", "статей");
}
/** «9 мин чтения» · «9 min lugemist» · «9 min read». */
export function minutesWord(n, code) {
  if (code === "ET") return n + " min lugemist";
  if (code === "EN") return n + " min read";
  return n + " мин чтения";
}
/** «34 товара» · «34 toodet» · «34 products». */
export function productsWord(n, code) {
  if (code === "ET") return n === 1 ? "1 toode" : n + " toodet";
  if (code === "EN") return n === 1 ? "1 product" : n + " products";
  return n + " " + ruPl(n, "товар", "товара", "товаров");
}
/** «Все 34 товара» · «Kõik 34 toodet» · «All 34 products». */
export function allProductsWord(n, code) {
  if (code === "ET") return "Kõik " + n + " toodet";
  if (code === "EN") return "All " + n + " products";
  return "Все " + n + " " + ruPl(n, "товар", "товара", "товаров");
}
/** The byline's first part: the salon's team, unless the article names someone. */
export function authorLine(author, code) {
  const a = String(author || "").trim();
  return !a || a === "Rempire" ? S(code).team : a;
}

const dmy = (iso) => String(iso || "").slice(0, 10).split("-").reverse().join(".");

/* ---------- the static builders ------------------------------------------
   Used by the prerender and by the request-time page. Every item they take is
   an article already in ONE language: { slug, title, excerpt, coverUrl,
   coverAlt, coverFocus, coverW, coverH, topic, minutes, productCount,
   publishedAt }. `hrefOf(slug)` is the article's address in this language.
   No script here, and no button but the featured band's two arrows, drawn
   as app.js draws them so the band is the same box before and after the
   script — the chips and «Спросить» are app.js's alone; the static page is
   for a crawler and a reader with scripts off, and links every article. */

/** An <img> for a cover: its own shape when known, the old 1200×630 frame (and
    the owner's crop for it) when not. `eager` for the first screen. */
export function coverImg(p, where, cls, eager, altText) {
  const d = coverDims(p);
  const alt = esc(altText !== undefined ? altText : p.coverAlt || p.title || "");
  const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  if (d) {
    return '<img class="' + cls + '" src="' + esc(p.coverUrl) + '" alt="' + alt + '" width="' + d.w + '" height="' + d.h + '"' +
      load + ' decoding="async">';
  }
  const crop = coverImgStyle(p.coverFocus, where);
  return '<img class="' + cls + " " + cls + '--frame" src="' + esc(p.coverUrl) + '" alt="' + alt + '" width="1200" height="630"' +
    load + ' decoding="async"' + (crop ? ' style="' + crop + '"' : "") + ">";
}

/** The carousel's photo keeps the owner's point for the top of the article; the middle when there is none. */
function heroPos(focus) {
  const f = readCoverFocus(focus);
  return f ? f.post.x + "% " + f.post.y + "%" : "50% 50%";
}

function eyebrow(p, code, withProducts) {
  const parts = [];
  if (p.topic) parts.push(topicName(p.topic, code));
  if (p.minutes) parts.push(minutesWord(p.minutes, code));
  if (withProducts && p.productCount) parts.push(productsWord(p.productCount, code));
  return parts.map((x) => "<span>" + esc(x) + "</span>").join(" · ");
}

/* A picture narrower than the page, or standing upright — a page out of a
   brand's PDF is ~830 px wide and portrait — is never stretched across a
   1240-px article top: the article keeps it in the reading column, cut 4:5.
   app.js bmagHalf() is the twin. (The featured band has its own rule,
   coverKind() below.) */
export function isNarrow(p) {
  const d = coverDims(p);
  return !!(d && (d.w < 1200 || d.h > d.w * 0.9));
}

/* ---------- the featured articles: the home banner ----------------------
   Dim, 02.11.2026: the blog's featured story «must look and behave EXACTLY
   like the home banner». So it IS the home banner: the band app.js draws on
   the home page (heroFrameHTML / heroBandHTML there), the same classes, the
   same arrows, styles.css .hero for all of it. These are the twins the
   static page is drawn with — app.js paints its own copy over this one in
   the same task, and tests/blog-magazine.test.ts draws the same articles
   through both and holds them to one markup, so the band neither moves nor
   changes when the script arrives. */

/** A picture this much wider than tall is a landscape photo — src/lib/hero.ts HERO_WIDE_RATIO. */
export const HERO_WIDE_RATIO = 1.3;
/** …and only one at least this wide is drawn across the whole band: a smaller one would be blown up past its pixels. */
export const HERO_WIDE_MIN_W = 1200;

/**
 * The look an article's slide gets, by its cover's shape — the rule a photo
 * uploaded for the home banner picks its own by (heroKindForUpload in
 * src/lib/hero.ts): a landscape cover is "wide" (white words on the darkened
 * photo), anything else "half" (the photo on the right of the column, fading
 * into the beige). A landscape cover under 1200 px and one nobody measured
 * are "half" too. No cover: "product" — the words alone on the beige.
 * app.js bmagKind() is the twin.
 */
export function coverKind(p) {
  if (!p || !p.coverUrl) return "product";
  const d = coverDims(p);
  return d && d.w >= HERO_WIDE_MIN_W && d.w / d.h >= HERO_WIDE_RATIO ? "wide" : "half";
}

/* app.js chevron(), the band's arrows. */
const CHEVRON = {
  left: '<svg viewBox="0 0 12 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3L3 14l6 11"/></svg>',
  right: '<svg viewBox="0 0 12 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l6 11-6 11"/></svg>',
};

/** «Следующая статья — 2 из 3»: which slide an arrow goes to, of how many (app.js heroArrowLabel). */
function arrowLabel(name, to, n, code) {
  return name + " — " + (((to % n) + n) % n + 1) + " " + S(code).of + " " + n;
}

/** One article as a slide of the band (app.js bmagSlideHTML). `cur` is the slide on screen. */
export function heroSlideHTML(p, code, hrefOf, i, cur = 0) {
  const kind = coverKind(p), d = coverDims(p), on = i === cur;
  const words = '<div class="hero__inner"><div class="hero__eyebrow">' + eyebrow(p, code, true) + "</div>" +
    '<h2 class="hero__title">' + esc(p.title) + "</h2>" +
    (p.excerpt ? '<p class="hero__sub">' + esc(p.excerpt) + "</p>" : "") +
    '<a class="btn" href="' + esc(hrefOf(p.slug)) + '">' + esc(S(code).read) + "</a></div>";
  const img = kind === "product" ? ""
    : '<img src="' + esc(p.coverUrl) + '" alt=""' + (d ? ' width="' + d.w + '" height="' + d.h + '"' : "") +
      ' style="object-position:' + heroPos(p.coverFocus) + '"' +
      (on ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"') + ">";
  return '<div class="hero__slide hero__slide--' + kind + (kind === "wide" ? " hero__slide--left" : "") +
    '" data-kind="' + kind + '" data-on="' + (on ? 1 : 0) + '" aria-hidden="' + !on + '">' +
    (kind === "product" ? "" : '<span class="hero__photo">' + img + "</span>") +
    '<div class="hero__box">' + words + "</div></div>";
}

/** The band (app.js heroBandHTML): the slides, and two arrows when there is more than one. */
export function heroHTML(slides, code, hrefOf) {
  if (!slides.length) return "";
  const s = S(code), n = slides.length;
  return '<section class="hero" aria-label="' + esc(s.featured) + '" aria-roledescription="карусель" data-kind="' + coverKind(slides[0]) + '">' +
    slides.map((p, i) => heroSlideHTML(p, code, hrefOf, i, 0)).join("") +
    (n > 1
      ? '<button class="hero__arrow hero__arrow--prev" type="button" data-slide="-1" aria-label="' + esc(arrowLabel(s.prevSlide, -1, n, code)) + '">' + CHEVRON.left + "</button>" +
        '<button class="hero__arrow hero__arrow--next" type="button" data-slide="1" aria-label="' + esc(arrowLabel(s.nextSlide, 1, n, code)) + '">' + CHEVRON.right + "</button>"
      : "") +
    "</section>";
}

/** One card of the grid: the cover in its own shape, or the beige tile. */
export function cardHTML(p, code, hrefOf, order, eager) {
  const topic = p.topic ? topicName(p.topic, code) : "";
  return '<a class="blog__tile bmag__card" href="' + esc(hrefOf(p.slug)) + '" style="order:' + order + '">' +
    (p.coverUrl
      ? coverImg(p, "list", "bmag__img", eager, p.coverAlt || "")
      : '<span class="bmag__none" aria-hidden="true">' +
          (topic ? '<span class="bmag__noneeye">' + esc(topic) + "</span>" : "") +
          '<span class="bmag__nonet">' + esc(p.title) + "</span></span>") +
    (topic ? '<span class="bmag__eye">' + esc(topic) + "</span>" : "") +
    '<span class="bmag__title">' + esc(p.title) + "</span>" +
    (p.excerpt ? '<span class="bmag__ex">' + esc(p.excerpt) + "</span>" : "") +
    "</a>";
}

/** The grid: three columns that fold into one on a phone. */
export function gridHTML(items, code, hrefOf, firstEager = 0) {
  const cols = masonry(items, 3);
  return '<div class="bmag__grid">' + cols.map((col) =>
    '<div class="bmag__col">' + col.map((i) => cardHTML(items[i], code, hrefOf, i, i < firstEager)).join("") + "</div>").join("") +
    "</div>";
}

/**
 * The blog home, static. `posts` every published article (newest first),
 * `featured` the ones marked «На главной блога».
 */
export function homeStaticHTML({ posts, featured, code, hrefOf, total }) {
  const slides = pickFeatured(posts, featured);
  const shown = new Set(slides.map((p) => p.slug));
  const grid = posts.filter((p) => !shown.has(p.slug));
  const n = typeof total === "number" ? total : posts.length;
  return heroHTML(slides, code, hrefOf) +
    '<div class="wrap"><section class="sec bmag">' +
      '<div class="bmag__head"><div class="bmag__ttl"><h1 class="bmag__h">' + esc(blogWord(code)) + "</h1>" +
        '<span class="bmag__n">' + esc(articlesWord(n, code)) + "</span></div>" +
        // the chips' names, as a crawler reads them — app.js makes them buttons
        // (only the topics the blog has — app.js draws the same set, «Все» first)
        '<ul class="bmag__chips bmag__chips--static">' +
          [S(code).all].concat(BLOG_TOPICS.filter((t) => posts.some((p) => p.topic === t)).map((t) => topicName(t, code)))
            .map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
      "</div>" +
      (grid.length ? gridHTML(grid, code, hrefOf, slides.length ? 0 : 3) : "") +
    "</section></div>";
}

export function blogWord(code) {
  return code === "ET" ? "Blogi" : code === "EN" ? "Blog" : "Блог";
}

/**
 * The article, static: the cover full width, «Блог / Тема», the title, the
 * byline, the lead, the strip of products, the body, the sources box (only
 * when it is switched on and has lines), «Читать дальше» — then whatever the
 * caller puts under it (the products shelf).
 *
 * `strip`: [{ href, img, name, price }] already in this language.
 * `productCount`: every product the article names (the strip shows the first ones).
 */
export function articleStaticHTML({ post, code, blogHref, hrefOf, bodyShown, strip, productCount, next, tagsHTML, shelfId }) {
  const s = S(code);
  const by = [authorLine(post.author, code)];
  if (post.publishedAt) by.push(dmy(post.publishedAt));
  if (post.minutes) by.push(minutesWord(post.minutes, code));
  return '<article class="blog__post bmag-post">' +
    (post.coverUrl
      ? '<figure class="bmag-post__cover' + (isNarrow(post) ? " bmag-post__cover--narrow" : "") + '">' + coverImg(post, "post", "bmag-post__img", true) + "</figure>"
      : "") +
    '<div class="wrap"><div class="blog__read">' +
    '<header class="bmag-post__head">' +
      '<nav class="bmag-post__crumbs" aria-label="' + esc(blogWord(code)) + '"><a href="' + esc(blogHref) + '">' + esc(blogWord(code)) + "</a>" +
        (post.topic ? " / <span>" + esc(topicName(post.topic, code)) + "</span>" : "") + "</nav>" +
      '<h1 class="bmag-post__h1">' + esc(post.title) + "</h1>" +
      '<p class="bmag-post__by">' + by.map((x) => "<span>" + esc(x) + "</span>").join(" · ") + "</p>" +
      (post.excerpt ? '<p class="bmag-post__lead">' + esc(post.excerpt) + "</p>" : "") +
    "</header>" +
    (strip && strip.length ? stripHTML(strip, productCount, code, shelfId) : "") +
    '<div class="acc__rich blog__body">' + bodyShown + "</div>" +
    (tagsHTML || "") +
    (Array.isArray(post.sources) && post.sources.length
      ? '<aside class="bmag-src" aria-label="' + esc(s.sources) + '"><span class="bmag-src__h">' + esc(s.sources) + "</span>" +
        "<span>" + post.sources.map(esc).join(" · ") + "</span></aside>"
      : "") +
    (next && next.length
      ? '<section class="blog__shelf bmag-next" aria-label="' + esc(s.next) + '"><h2 class="bmag-next__h">' + esc(s.next) + "</h2>" +
        next.map((p) => nextHTML(p, code, hrefOf)).join("") + "</section>"
      : "") +
    "</div></div></article>";
}

export function stripHTML(strip, productCount, code, shelfId) {
  const s = S(code);
  const n = Math.max(productCount || 0, strip.length);
  return '<section class="bmag-strip" aria-label="' + esc(s.inThisLabel) + '">' +
    '<div class="bmag-strip__head"><span class="bmag-strip__h">' + esc(s.inThis) + "</span>" +
      (n > 1 && shelfId ? '<a class="bmag-strip__all" href="#' + esc(shelfId) + '">' + esc(allProductsWord(n, code)) + "</a>" : "") + "</div>" +
    '<div class="bmag-strip__row">' + strip.map((x) =>
      '<a class="bmag-strip__i" href="' + esc(x.href) + '">' +
        '<span class="bmag-strip__img">' + (x.img ? '<img src="' + esc(x.img) + '" alt="" width="400" height="400" loading="lazy" decoding="async">' : "") + "</span>" +
        '<span class="bmag-strip__nm">' + esc(x.name) + "</span>" +
        (x.price ? '<span class="bmag-strip__pr num">' + esc(x.price) + "</span>" : "") +
      "</a>").join("") + "</div></section>";
}

/** The small «Читать дальше» picture keeps the point the owner chose for the list. */
export function nextPos(focus) {
  const f = readCoverFocus(focus);
  return f ? "object-position:" + f.list.x + "% " + f.list.y + "%" : "";
}

export function nextHTML(p, code, hrefOf) {
  const pos = nextPos(p.coverFocus);
  return '<a class="blog__tile bmag-next__i" href="' + esc(hrefOf(p.slug)) + '">' +
    (p.coverUrl
      ? '<img class="bmag-next__img" src="' + esc(p.coverUrl) + '" alt="" width="120" height="80" loading="lazy" decoding="async"' +
        (pos ? ' style="' + pos + '"' : "") + ">"
      : '<span class="bmag-next__none" aria-hidden="true">' + esc(p.title) + "</span>") +
    '<span class="bmag-next__t">' + esc(p.title) + "</span></a>";
}
