/**
 * A link-preview card drawn at request time.
 *
 * The catalogue's cards are files, drawn once at build by
 * tools/prerender-shop2.mjs (public/shop/og/<id>.jpg — the cutout on the
 * brand ground, no text). Two kinds of page have no file to point at:
 *
 *   · a product the owner created in the panel (custom_products, `c-…`) —
 *     its photos are WebP uploads (src/lib/images.ts), which Facebook,
 *     WhatsApp and LinkedIn refuse to read, so until now the page borrowed
 *     the tower card and the preview said nothing about the product;
 *   · a blog post published after the last build — no static page, no card.
 *
 * So the card is drawn here when the scraper asks for it, at
 * /shop2/og/c-<id>.png and /shop2/og/blog-<slug>[.et|.en].png
 * (src/app/shop2/og/[file]/route.ts): a white 1 200×630 PNG with the photo
 * decoded from WebP and fitted on the left, and on the right the brand, the
 * name and the price (a post: the title and the date) as text.
 *
 * The text is NOT an SVG <text> element. sharp rasterises SVG through
 * librsvg, which shapes text with the fonts fontconfig can see — on a
 * Vercel function there are none, and @font-face is not something librsvg
 * honours either, so <text> would come out as nothing at all. The build
 * tool sidesteps the question by drawing no text. Here the glyphs are
 * taken out of the committed OFL fonts (public/fonts, the same TTFs
 * src/lib/giftcard-pdf.ts embeds) with fontkit and written into the SVG as
 * <path>s — outlines need no font at raster time, so the card renders the
 * same on this machine, on Linux with no fonts, and on the function.
 *
 * Cost and caching: one card is a WebP decode, a few hundred glyph paths
 * and a PNG encode — well under a second. The route answers with an ETag
 * that moves with the row's updated_at and a long shared-cache lifetime,
 * and the page's og:image carries the same stamp as `?v=`, so a rename or
 * a new price is a new URL to every scraper while an unchanged product is
 * served from the edge. A small in-memory map keeps the last few PNGs for
 * the lifetime of the instance.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import { getPublishedBySlug, pickLang } from "@/lib/blog";
import { getCustomProduct, isCustomId } from "@/lib/custom-products";
import { loadSharp, MAX_PIXELS, MAX_UPLOAD_BYTES } from "@/lib/images";
import { eur, OG_H, OG_W } from "@/lib/seo-head.mjs";

/* ---------- assets ------------------------------------------------------- */

/* `public/…` from wherever the process is rooted — the same two roots
   src/lib/giftcard-pdf.ts and src/lib/product-page.ts read from. On Vercel
   the files reach the function through outputFileTracingIncludes in
   next.config.ts. */
const ROOTS = [process.cwd(), path.join(process.cwd(), "..")];

function readAsset(rel: string): Buffer {
  let lastErr: unknown = null;
  for (const root of ROOTS) {
    try {
      return readFileSync(path.join(root, rel));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`${rel} is not readable (${lastErr instanceof Error ? lastErr.message : "not found"})`);
}

type Fonts = { display: Font; body: Font };
let fontsCache: Fonts | null = null;

/** Oswald Medium for the brand line and the price, Golos Text for the name — both cover Cyrillic and the Estonian letters. */
export function ogFonts(): Fonts {
  if (!fontsCache) {
    fontsCache = {
      display: fontkit.create(readAsset("public/fonts/Oswald-Medium.ttf")),
      body: fontkit.create(readAsset("public/fonts/GolosText-Regular.ttf")),
    };
  }
  return fontsCache;
}

const INK = "#1c1a00";
const MUTED = "#6f6c60";

/* ---------- text as outlines --------------------------------------------- */

const r2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** How wide `text` is at `size` px, tracking added between glyphs. */
export function textWidth(font: Font, text: string, size: number, tracking = 0): number {
  const run = font.layout(text);
  return run.advanceWidth * (size / font.unitsPerEm) + tracking * Math.max(0, run.glyphs.length - 1);
}

/**
 * `text` as SVG <path> elements with the baseline at (x, y) — the glyph
 * outlines in font units, scaled to `size` and flipped (fonts are y-up, SVG
 * is y-down). Kerning comes out of fontkit's own layout.
 */
export function textPaths(font: Font, text: string, size: number, x: number, y: number, tracking = 0): string {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  const out: string[] = [];
  let cx = x;
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const d = g.path.toSVG();
    if (d) {
      out.push(
        `<path d="${d}" transform="translate(${r2(cx + pos.xOffset * s)} ${r2(y - pos.yOffset * s)}) scale(${s.toFixed(6)} ${(-s).toFixed(6)})"/>`,
      );
    }
    cx += pos.xAdvance * s + tracking;
  });
  return out.join("");
}

function withEllipsis(font: Font, line: string, size: number, maxWidth: number): string {
  let s = line.replace(/…$/, "");
  while (s.length > 1 && textWidth(font, s + "…", size) > maxWidth) {
    s = s.slice(0, -1).replace(/[\s.,;:·—–-]+$/, "");
  }
  return s + "…";
}

/**
 * Word-wrapped to at most `maxLines` lines of `maxWidth` px; what does not
 * fit ends in an ellipsis rather than running off the card. A single word
 * wider than the box is cut the same way.
 */
export function wrapText(font: Font, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  let idx = 0;
  let overflow = false;
  while (idx < words.length) {
    if (lines.length === maxLines) {
      overflow = true;
      break;
    }
    const w = words[idx];
    const probe = cur ? cur + " " + w : w;
    if (!cur || textWidth(font, probe, size) <= maxWidth) {
      cur = probe;
      idx++;
      if (idx === words.length) {
        lines.push(cur);
        cur = "";
      }
      continue;
    }
    lines.push(cur);
    cur = "";
  }
  const out = lines.map((l) => (textWidth(font, l, size) <= maxWidth ? l : withEllipsis(font, l, size, maxWidth)));
  if (overflow && out.length) out[out.length - 1] = withEllipsis(font, out[out.length - 1], size, maxWidth);
  return out;
}

/* ---------- the picture -------------------------------------------------- */

/**
 * The photo's bytes: an upload (https://…, the R2 host) is fetched with a
 * short timeout and the upload size cap; a root-relative path (a catalogue
 * photo under /shop/img/, the e2e suite's stub) is read off disk first and
 * fetched from the shop's own base when it is not there. Null on any
 * trouble — the card is drawn without the picture rather than not at all.
 */
export async function fetchPhoto(url: string | null | undefined, base: string): Promise<Buffer | null> {
  const u = String(url || "").trim();
  if (!u) return null;
  let abs: string | null = null;
  if (/^https?:\/\//i.test(u)) {
    abs = u;
  } else if (u.startsWith("/") && !u.startsWith("//")) {
    const rel = u.split("?")[0];
    if (!rel.includes("..")) {
      try {
        return readAsset(path.join("public", rel));
      } catch {
        /* not on this disk — the shop itself serves it */
      }
    }
    abs = base.replace(/\/+$/, "") + u;
  }
  if (!abs) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(abs, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

/* currentColor rasterises as black; the brand ink is #1c1a00 — the same
   recipe the prerender uses for the corner mark on the catalogue's cards. */
async function towerPng(height: number, colour = INK): Promise<Buffer> {
  const sharp = await loadSharp();
  const svg = readAsset("public/brand/rempire-tower.svg").toString("utf8").replace(/currentColor/g, colour);
  return sharp(Buffer.from(svg), { density: 600 }).resize({ height }).png().toBuffer();
}

/* ---------- the card ----------------------------------------------------- */

export type CardSpec = {
  /** The small line above the name: the brand, or «BLOG · date». */
  eyebrow: string;
  /** The name, wrapped to three lines. */
  title: string;
  /** The price line; "" for none. */
  foot: string;
  photo: Buffer | null;
  /** `inside`: a cutout, whole, on white. `cover`: a cover shot, cropped to fill the box. */
  fit: "inside" | "cover";
};

const PHOTO = { left: 56, top: 56, size: 518 };
const TEXT_X = 640;
const TEXT_W = OG_W - TEXT_X - 56;
const TITLE_SIZE = 44;
const TITLE_LINE = 56;
const TITLE_LINES = 3;

/** The 1 200×630 PNG. Never throws for a bad photo — it draws the mark instead. */
export async function drawCard(spec: CardSpec): Promise<Buffer> {
  const sharp = await loadSharp();
  const { display, body } = ogFonts();
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];

  let photoPlaced = false;
  if (spec.photo) {
    try {
      const img = await sharp(spec.photo, { limitInputPixels: MAX_PIXELS, failOn: "none" })
        .rotate()
        .resize(PHOTO.size, PHOTO.size, spec.fit === "cover" ? { fit: "cover", position: "attention" } : { fit: "inside", withoutEnlargement: false })
        .png()
        .toBuffer({ resolveWithObject: true });
      layers.push({
        input: img.data,
        left: PHOTO.left + Math.round((PHOTO.size - img.info.width) / 2),
        top: PHOTO.top + Math.round((PHOTO.size - img.info.height) / 2),
      });
      photoPlaced = true;
    } catch (err) {
      console.error("[og-card] photo not drawn:", err);
    }
  }
  if (!photoPlaced) {
    // no photograph: the mark stands in, centred in the photo box
    const mark = await towerPng(260, MUTED);
    const m = await sharp(mark).metadata();
    layers.push({
      input: mark,
      left: PHOTO.left + Math.round((PHOTO.size - (m.width || 0)) / 2),
      top: PHOTO.top + Math.round((PHOTO.size - (m.height || 0)) / 2),
    });
  }

  // the header: the mark and the wordmark, top of the text column
  const headMark = await towerPng(40);
  const headMeta = await sharp(headMark).metadata();
  layers.push({ input: headMark, left: TEXT_X, top: 60 });
  const wordmarkX = TEXT_X + (headMeta.width || 26) + 16;

  const titleLines = wrapText(body, spec.title, TITLE_SIZE, TEXT_W, TITLE_LINES);
  const eyebrow = wrapText(display, spec.eyebrow.toUpperCase(), 28, TEXT_W, 1)[0] || "";
  const titleTop = 252;
  const footY = titleTop + TITLE_LINE * Math.max(0, titleLines.length - 1) + 104;
  const foot = spec.foot ? wrapText(display, spec.foot, 56, TEXT_W, 1)[0] : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">` +
    `<g fill="${INK}">${textPaths(display, "REMPIRE", 26, wordmarkX, 92, 4)}</g>` +
    (eyebrow ? `<g fill="${MUTED}">${textPaths(display, eyebrow, 28, TEXT_X, 190, 3)}</g>` : "") +
    `<g fill="${INK}">` +
    titleLines.map((l, i) => textPaths(body, l, TITLE_SIZE, TEXT_X, titleTop + i * TITLE_LINE)).join("") +
    "</g>" +
    (foot ? `<g fill="${INK}">${textPaths(display, foot, 56, TEXT_X, footY)}</g>` : "") +
    "</svg>";
  layers.push({ input: Buffer.from(svg), left: 0, top: 0 });

  return sharp({ create: { width: OG_W, height: OG_H, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .png({ compressionLevel: 8 })
    .toBuffer();
}

/* ---------- keys and the small cache ------------------------------------- */

/** The stamp the page puts in `?v=`: the row's updated_at, base 36. */
export function ogStamp(updatedAt: string): string {
  const t = Date.parse(updatedAt);
  return (Number.isFinite(t) ? t : 0).toString(36);
}

function cardKey(...parts: Array<string | null | undefined>): string {
  return "og-" + createHash("sha1").update(parts.map((p) => String(p ?? "")).join(" ")).digest("hex").slice(0, 20);
}

const CACHE_MAX = 24;
const cache = new Map<string, Buffer>();

async function cached(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) return hit;
  const png = await make();
  cache.set(key, png);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return png;
}

/** Tests: forget every drawn card. */
export function resetCardCache(): void {
  cache.clear();
}

export type Card = { key: string; png: () => Promise<Buffer> };

/** «14,90 €», or «9 – 25 €» when the sizes are priced differently. */
export function priceLine(prices: number[]): string {
  const list = prices.filter((p) => Number.isFinite(p));
  if (!list.length) return "";
  const lo = Math.min(...list);
  const hi = Math.max(...list);
  return lo === hi ? eur(lo) : eur(lo).replace(/ €$/, "") + " – " + eur(hi);
}

/** A custom product's card — null when there is no such active product. */
export async function customProductCard(id: string, base: string): Promise<Card | null> {
  if (!isCustomId(id)) return null;
  const row = await getCustomProduct(id);
  if (!row || !row.active) return null;
  const photo = row.gallery?.[0]?.url ?? "";
  const key = cardKey("p", row.id, row.updatedAt, photo);
  return {
    key,
    png: () =>
      cached(key, async () =>
        drawCard({
          eyebrow: row.brand,
          title: row.name,
          foot: priceLine(row.prices),
          photo: await fetchPhoto(photo, base),
          fit: "inside",
        }),
      ),
  };
}

const dmy = (iso: string) => String(iso || "").slice(0, 10).split("-").reverse().join(".");

/** A published post's card in one language — null for a draft or a slug nobody has. */
export async function blogPostCard(slug: string, lang: string, base: string): Promise<Card | null> {
  const post = await getPublishedBySlug(slug);
  if (!post) return null;
  const code = lang === "ET" || lang === "EN" ? lang : "RU";
  const title = pickLang(post.title, code) || post.slug;
  const key = cardKey("b", post.slug, code, post.updatedAt, post.coverUrl);
  return {
    key,
    png: () =>
      cached(key, async () =>
        drawCard({
          eyebrow: "Blog" + (post.publishedAt ? " · " + dmy(post.publishedAt) : ""),
          title,
          foot: "",
          photo: await fetchPhoto(post.coverUrl, base),
          fit: "cover",
        }),
      ),
  };
}
