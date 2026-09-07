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

/** The absolute-URL base: $PUBLIC_BASE_URL, default the live domain, no trailing slash. */
export const baseFrom = baseEnv => String(baseEnv || "https://rempireshop.com").replace(/\/+$/, "");

/* ---------- small helpers ------------------------------------------------ */

export const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const eur = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
/* Same rule as stripTags() in public/shop2/app.js: an inline tag vanishes, a
   block tag becomes a space. Turning every tag into a space split words that
   carry markup inside them — «s<b>trong</b>» came out as «s trong». */
const INLINE_TAGS = /^(?:span|b|i|strong|em|a|u|sup|sub)$/i;
export const stripTags = h => String(h || "")
  .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, tag) => (INLINE_TAGS.test(tag) ? "" : " "))
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
export const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
   version that fits — app.js's fitTitle() runs the same ladder. */
export function fitTitle(core, full) {
  if (full && full.length <= 60) return full;
  if (core.length + 10 <= 60) return core + " — REMPIRE";
  if (core.length <= 60) return core;
  return clip(core, 60);
}

export const langPath = (seg, rest) => "/shop2" + (seg ? "/" + seg : "") + rest;

/* ---------- copy, one table per language -------------------------------- */

/* Mirrors the strings setHead() in app.js uses, so the tab title does not
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
    /* the four screens added 03.09 — sets, one set, the gift card, the policy pages */
    save: "выгода", pieces: "товара в наборе",
    setsDesc: "Готовые наборы Rempire — уход, стайлинг и бритьё комплектом. Те же товары, что и поштучно, только дешевле. Таллинн, доставка по Балтии.",
    setDesc: (price, save, n) => `${price} вместо розницы, ${save} — ${n} в наборе. Магазин Rempire, Таллинн: доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    giftDesc: "Подарочная карта Rempire на 25, 50 или 100 € — придёт письмом вам или сразу получателю. Действует год, остаток сохраняется.",
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
    inStock: "Laos", low: "vähe", out: "pole saadaval",
    from: "alates ",
    tax: "Hinnad sisaldavad makse. Tarne arvutatakse vormistamisel.",
    lang: "Keel", loading: "Laeme poodi…",
    catDesc: c => `${c} Rempire'i poes Tallinnas. Tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    brandDesc: b => `${b} laos Rempire'is, Tallinn — kogu brändi valik kõigist poe osakondadest.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Rempire'i pood, Tallinn — tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    save: "sääst", pieces: "toodet komplektis",
    setsDesc: "Rempire'i valmiskomplektid — hooldus, viimistlus ja habemeajamine ühes pakis. Samad tooted mis eraldi, ainult soodsamalt. Tallinn, tarne üle Baltikumi.",
    setDesc: (price, save, n) => `${price} jaehinna asemel, ${save} — ${n}. Rempire'i pood, Tallinn: tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    giftDesc: "Rempire'i kinkekaart 25, 50 või 100 € — tuleb kirjaga sulle või kohe saajale. Kehtib aasta, jääk säilib.",
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
    base: "REMPIRE — grooming shop in Tallinn",
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
    tax: "Taxes included. Shipping is calculated at checkout.",
    lang: "Language", loading: "Loading the shop…",
    catDesc: c => `${c} at Rempire, Tallinn. Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    brandDesc: b => `${b} in stock at Rempire, Tallinn — the brand's full range across every section of the shop.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Rempire shop, Tallinn — Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    save: "you save", pieces: "products in the set",
    setsDesc: "Rempire ready-made sets — care, styling and shaving in one box. The same products the shop sells separately, only cheaper. Tallinn, Baltic delivery.",
    setDesc: (price, save, n) => `${price} instead of retail, ${save} — ${n}. Rempire shop, Tallinn: Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    giftDesc: "A Rempire gift card for €25, €50 or €100 — e-mailed to you or straight to the recipient. Valid for a year, the balance carries over.",
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
export function productSpec({ base, lang, id, cat, catName: section, brand, name, price, priceFrom, stock, seoTitle, seoDesc, body, image, imageUrls }) {
  const t = T[lang.code];
  const seg = lang.seg;
  const rest = "/p/" + encodeURIComponent(id) + "/";
  const core = brand + " " + name;
  const priceText = (priceFrom ? t.from : "") + eur(price);
  const full = core + " — " + t.buy + " · " + priceText;
  let title = fitTitle(core, full);
  if (seoTitle) title = fitTitle(seoTitle, "");

  const text = stripTags(body);
  const stockText = stock === "out" ? t.out : stock === "low" ? t.low : t.inStock;
  const desc = clip(seoDesc || text || t.prodDesc(priceText, section, stockText), 158);

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
