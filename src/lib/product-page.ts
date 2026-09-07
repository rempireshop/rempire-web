/**
 * A custom product's page, built at request time.
 *
 * The catalogue's product pages are static files written at build by
 * tools/prerender-shop2.mjs — title, description, canonical, the hreflang
 * cluster, OpenGraph, Product JSON-LD, and the screen's real content inside
 * #app, so Googlebot and a link scraper read a page before app.js runs. A
 * product the owner created in the panel (custom_products, ids `c-…`,
 * src/lib/custom-products.ts) does not exist when the build runs, so for
 * those the same page is written here, from the row, when the request
 * arrives: the shell (public/shop2/index.html) patched between the same two
 * marker pairs the prerender patches, through the same head builders
 * (src/lib/seo-head.mjs) — one Product block with `id="ldjson"` for setHead()
 * to rewrite in place, the breadcrumb marked `ldjson-page`, and the body
 * under #prerender that app.js drops once its own first render has painted.
 *
 * Routes: src/app/shop2/{,et/,en/}p/[id]/route.ts. They only ever see a
 * /p/<id>/ that is not a prerendered file — next.config.ts routes the
 * prerendered ids at their files first and everything else under /shop2/
 * at the shell last — so a catalogue id that reaches here (a fresh clone
 * that has not prerendered yet) gets the shell exactly as before.
 *
 * Hidden (active=false) and unknown `c-…` ids answer 404 with the shell
 * carrying `noindex, nofollow`: the address is dropped from the index and
 * the SPA still boots and shows the shopper the home page, as it always has.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  getCustomProduct,
  isCustomId,
  toCatalogueProduct,
  type CustomProduct,
} from "@/lib/custom-products";
import { ogStamp } from "@/lib/og-card";
import { getOverrides } from "@/lib/orders";
import { pickDescription } from "@/lib/product-descriptions";
import { pickSeo } from "@/lib/product-seo";
import {
  baseFrom,
  catName,
  crumbs,
  esc,
  eur,
  headBlock,
  href,
  langBySeg,
  langNav,
  noindexShell,
  OG_DEFAULT,
  patchShell,
  productSpec,
  robotsFor,
  slugify,
  T,
} from "@/lib/seo-head.mjs";

type Lang = { code: "RU" | "ET" | "EN"; seg: string; tag: string; htmlLang: string; ogLocale: string };

/* ---------- the shell ---------------------------------------------------- */

/* `public/…` from wherever the process happens to be rooted — the same two
   roots src/lib/giftcard-pdf.ts reads its fonts from. On Vercel the file
   reaches the function through outputFileTracingIncludes in next.config.ts. */
const SHELL_REL = path.join("public", "shop2", "index.html");
const ROOTS = [process.cwd(), path.join(process.cwd(), "..")];

let shellCache: { file: string; mtimeMs: number; html: string } | null = null;

/** The shell as it is on disk — re-read when the file changes (a prerender run patches it). */
export function readShell(): string {
  let lastErr: unknown = null;
  for (const root of ROOTS) {
    const file = path.join(root, SHELL_REL);
    try {
      const { mtimeMs } = statSync(file);
      if (shellCache && shellCache.file === file && shellCache.mtimeMs === mtimeMs) return shellCache.html;
      const html = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
      shellCache = { file, mtimeMs, html };
      return html;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`public/shop2/index.html is not readable (${lastErr instanceof Error ? lastErr.message : "not found"})`);
}

/* ---------- the page ----------------------------------------------------- */

/** The owner's paragraphs → <p> with <br> — descOvHtml() in app.js, for the body under #prerender. */
export function descriptionHtml(text: string): string {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>")
    .join("");
}

/** Absolute for the JSON-LD and the card: an upload is already absolute, a catalogue path is not. */
function absUrl(base: string, u: string): string {
  return /^https?:\/\//i.test(u) ? u : base + (u.startsWith("/") ? u : "/" + u);
}

/**
 * A link preview is a 1 200×630 JPEG or PNG or it is nothing (docs/seo.md,
 * "Link previews"). Uploads are WebP (POST /api/admin/upload), which
 * Facebook, WhatsApp and LinkedIn will not read, so the card is the shop's
 * own, drawn at request time from the first photo with the brand, the name
 * and the price on it — src/lib/og-card.ts behind /shop2/og/c-<id>.png.
 * `?v=` moves with every edit, so a scraper's cache never outlives a rename
 * or a new price. The JSON-LD still carries the real photos, which Google
 * does read.
 */
function ogImage(base: string, row: CustomProduct): string {
  return `${base}/shop2/og/${encodeURIComponent(row.id)}.png?v=${ogStamp(row.updatedAt)}`;
}

type Stock = "in" | "low" | "out";

/**
 * The page for one row in one language. `override` is the owner's
 * product_overrides row for the id when there is one — a stock switch («нет
 * в наличии», which is what puts «Сообщить о наличии» on the page) or a
 * price the assistant wrote — so the head says what the rendered page will.
 */
export function renderCustomProductPage(
  row: CustomProduct,
  lang: Lang,
  shell: string,
  opts: { base: string; robots: string; override?: { price?: number | null; stock?: string | null } | null },
): string {
  const { base, robots } = opts;
  const code = lang.code;
  const t = T[code];
  const cp = toCatalogueProduct(row);
  const section = catName(row.cat, code);
  const seo = pickSeo(row.seo, code);
  const body = pickDescription(row.description, code) ?? pickDescription(row.description, "RU") ?? "";
  const photos = cp.gallery ?? [];
  const o = opts.override;
  const stock: Stock = o?.stock === "out" || o?.stock === "low" ? o.stock : "in";
  const price = o?.price != null && Number.isFinite(o.price) ? o.price : cp.price;

  const spec = productSpec({
    base, lang,
    id: row.id, cat: row.cat, catName: section, brand: row.brand, name: row.name,
    price, priceFrom: !!cp.priceFrom, stock,
    seoTitle: seo?.title ?? "", seoDesc: seo?.desc ?? "",
    body,
    image: ogImage(base, row),
    imageUrls: photos.length ? photos.map((u) => absUrl(base, u)) : [absUrl(base, OG_DEFAULT)],
  });
  const { seg, rest, core, priceText, stockText, crumbItems } = spec as unknown as {
    seg: string; rest: string; core: string; priceText: string; stockText: string; crumbItems: Array<[string, string | null]>;
  };

  const sizes = (cp.sizes ?? []).length
    ? '<h2 class="display h1" style="font-size:13px;letter-spacing:.18em">' + esc(t.sizes) + "</h2>" +
      '<ul class="pre__sizes">' + (cp.sizes ?? []).map((s, i) => {
        const ladder = cp.prices ?? [];
        const unit = ladder.length ? ladder[Math.min(i, ladder.length - 1)] : price;
        return "<li>" + esc(s) + ' · <span class="num">' + esc(eur(unit)) + "</span></li>";
      }).join("") + "</ul>"
    : "";
  const chip = stock === "out" ? "chip--out" : stock === "low" ? "chip--low" : "chip--ok";

  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<div class="pdp">' +
      "<div>" +
        '<img class="pre__img" src="' + esc(cp.img) + '" alt="' + esc(core) + '" width="800" height="800">' +
      "</div>" +
      "<div>" +
        '<a class="pre__brand" href="' + href(seg, "/b/" + slugify(row.brand) + "/") + '">' + esc(row.brand) + "</a>" +
        '<h1 class="pdp__title">' + esc(row.name) + "</h1>" +
        '<div class="num pdp__price">' + esc(priceText) + ' <span class="chip ' + chip + '">' + esc(stockText) + "</span></div>" +
        '<div class="pdp__tax">' + esc(t.tax) + "</div>" +
        sizes +
        (body
          ? '<h2 class="display h1" style="font-size:13px;letter-spacing:.18em">' + esc(t.description) + "</h2>" +
            '<div class="acc__rich">' + descriptionHtml(body) + "</div>"
          : "") +
      "</div>" +
    "</div>" +
    langNav(seg, rest, t) +
    "</div>";

  return patchShell(shell, headBlock({ base, robots, ...spec }), content, lang.htmlLang);
}

/* ---------- the response ------------------------------------------------- */

const HTML = "text/html; charset=utf-8";
/** Edge-cached for a minute, like the overrides feed: a price change is visible within it. */
const PAGE_CACHE = "public, s-maxage=60, stale-while-revalidate=300";
const NO_STORE = "no-store";

function html(body: string, status: number, cacheControl: string): Response {
  return new Response(body, { status, headers: { "content-type": HTML, "cache-control": cacheControl } });
}

/** Has the owner taken this product out of the shop? Best effort: no database
    means no hidden products, which is the safe direction for a shop page. */
async function isHiddenProduct(id: string): Promise<boolean> {
  try {
    return (await getOverrides([id]))[id]?.hidden === true;
  } catch {
    return false;
  }
}

/**
 * GET /shop2/{,et/,en/}p/<id>/ for anything the prerender did not write.
 * A `c-…` id is answered from its row; every other id gets the shell the
 * /shop2/:path+ fallback would have served.
 */
export async function productPageResponse(id: string, seg: string): Promise<Response> {
  const shell = readShell();
  const lang = langBySeg(seg) as Lang | null;
  if (!lang || !isCustomId(id)) {
    /* «Показывать в магазине» switched off (product_overrides.hidden,
       db/migrations/147). The address must stop being an indexable page the
       moment the owner takes the product out of the shop — the same 404 with
       `noindex, nofollow` a hidden custom product gets below.
       Caveat worth knowing: a CATALOGUE product also has a static page
       written at build (tools/prerender-shop2.mjs), and next.config.ts routes
       that file before this route is reached — so for a product that was
       prerendered the file keeps answering until the next deploy. app.js
       drops the product from its own list either way, so the shopper who
       lands there is sent nowhere he can buy it. */
    if (await isHiddenProduct(id)) return html(noindexShell(shell), 404, NO_STORE);
    return html(shell, 200, "public, max-age=0, must-revalidate");
  }

  let row: CustomProduct | null;
  try {
    row = await getCustomProduct(id);
  } catch (err) {
    /* No database: the shell it is — app.js still has its offline copy of
       the feed, which is more than a 5xx would give anyone. */
    console.error("[product-page] custom product unavailable:", err);
    return html(shell, 200, NO_STORE);
  }
  if (!row || !row.active) return html(noindexShell(shell), 404, NO_STORE);

  let override: { price?: number | null; stock?: string | null } | null = null;
  try {
    override = (await getOverrides([id]))[id] ?? null;
  } catch {
    /* the row alone is an honest page */
  }
  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  const robots = robotsFor(process.env.PUBLIC_BASE_URL);
  return html(renderCustomProductPage(row, lang, shell, { base, robots, override }), 200, PAGE_CACHE);
}
