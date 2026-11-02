/* settings.hero — the home page's banner, and the three ways a slide can look
   (Dim, 02.11.2026: the design in Rempire/canvas-banner).

   Renat started uploading whole photographs as banners, and the banner was
   built for a product cut-out: a photo with its own background stood as a
   small framed picture on the beige band. So a slide now says how its picture
   is meant to be shown:

     kind   "wide"     a landscape photo across the whole banner, white text
                       over a dark scrim on the text's side
            "half"     a square or portrait photo filling the right part of
                       the band and fading into the beige; dark text on beige
            "product"  a cut-out standing on the beige — the banner as it was
     focus  {x, y}     the point of the photo that must stay in the frame when
                       it is cropped, 0..1 from the left and from the top
                       (0.5/0.5 when absent)
     side   "left" | "center" | "right" — where the words sit on a "wide"
                       slide (left when absent)
     w, h              the uploaded picture's own pixels, written by the panel
                       from the upload's answer: the storefront offers the
                       bucket's small copy beside it (srcset) only when it
                       knows how wide both are

   All of them are optional, and a slide without them is read the way it was
   always drawn, so nothing stored before this needs migrating: heroKindOf()
   decides from the picture itself. Only a photograph can fill the banner — a
   catalogue product, the gift card's mark or no picture at all is always a
   "product" slide, whatever it says.

   public/shop2/app.js carries the same rules for the storefront and the panel
   (heroKind, heroKindOfImage, heroKindForUpload, heroLook); tests/hero-kinds
   .test.ts runs both against one table, so the two cannot drift apart.

   Written by the panel's «Баннер» editor through PUT /api/admin/settings
   (cleanHeroSetting, below) and by «Помощник» (set_hero, sanitizeHero in
   src/app/api/assistant/actions.ts, which keeps the same fields through
   heroLayout). Renat's Claude has no banner tool (src/lib/mcp/tools.ts). */

export const HERO_KINDS = ["wide", "half", "product"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
export const HERO_SIDES = ["left", "center", "right"] as const;
export type HeroSide = (typeof HERO_SIDES)[number];
export type HeroFocus = { x: number; y: number };

/** A picture this much wider than tall is a landscape photo: «Фото на всю ширину». */
export const HERO_WIDE_RATIO = 1.3;
/** The panel keeps five slides; the stored document never carries more. */
export const HERO_MAX_SLIDES = 5;
/** The slide interval the storefront clamps to, in milliseconds. */
export const HERO_TICK = 6000;
const TICK_MIN = 2000;
const TICK_MAX = 30_000;
/** A picture larger than this on either side is not one of ours. */
const MAX_PIXELS_SIDE = 20_000;

export function cleanHeroKind(v: unknown): HeroKind | undefined {
  return typeof v === "string" && (HERO_KINDS as readonly string[]).includes(v) ? (v as HeroKind) : undefined;
}

export function cleanHeroSide(v: unknown): HeroSide | undefined {
  return typeof v === "string" && (HERO_SIDES as readonly string[]).includes(v) ? (v as HeroSide) : undefined;
}

/** Both coordinates, each a finite number from 0 to 1, kept to three places — or nothing. */
export function cleanHeroFocus(v: unknown): HeroFocus | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const { x, y } = v as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

/** A picture's side in pixels: a whole number from 1 to 20 000 — or nothing. */
export function cleanHeroPixels(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_PIXELS_SIDE ? v : undefined;
}

/**
 * The address the storefront would draw — heroUrl() in app.js, rule for rule:
 * a site path or an http(s) URL, and only the characters a URL is made of
 * (it lands in an attribute). Anything else is a product id, "gift" or nothing.
 */
export function heroPictureUrl(image: unknown): string {
  const v = typeof image === "string" ? image : "";
  if (!/^(https?:\/\/|\/)/.test(v)) return "";
  return /^[A-Za-z0-9._~:/?#[\]@!$&*+,=%-]+$/.test(v) ? v : "";
}

/**
 * How a slide that says nothing about its look was always drawn, read off its
 * picture. A catalogue product (by id), the gift card's mark, no picture, a
 * catalogue photo by address (/shop/img/…), a product photo from the bucket
 * (…/products/…) and a cut-out (…-cutout.png / .webp) stand on the beige:
 * "product". Any other photograph — the banner photos Renat uploads, which
 * have their own background — is "half": it fills a part of the band instead
 * of standing in it as a small framed picture.
 */
export function heroKindOfImage(image: unknown): HeroKind {
  const url = heroPictureUrl(image);
  if (!url) return "product";
  const path = url.replace(/[?#].*$/, "");
  if (/-cutout\.(png|webp)$/i.test(path) || /\/shop\/img\//.test(path) || /\/products\//.test(path)) return "product";
  return "half";
}

/** The look a slide is drawn with: its own `kind` when it has a photograph to show, else what its picture says. */
export function heroKindOf(slide: unknown): HeroKind {
  const row = slide && typeof slide === "object" ? (slide as Record<string, unknown>) : {};
  if (!heroPictureUrl(row.image)) return "product";
  return cleanHeroKind(row.kind) ?? heroKindOfImage(row.image);
}

/** What the panel picks by itself for a photo just uploaded: landscape → "wide", anything else → "half". */
export function heroKindForUpload(width: unknown, height: unknown): HeroKind {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return "half";
  return w / h >= HERO_WIDE_RATIO ? "wide" : "half";
}

/**
 * The look fields of one slide, cleaned — each one only when it is present and
 * valid, so a slide that never had them comes out without them (and is read
 * the old way). `w` and `h` travel as a pair or not at all.
 */
export function heroLayout(row: Record<string, unknown>): {
  kind?: HeroKind;
  side?: HeroSide;
  focus?: HeroFocus;
  w?: number;
  h?: number;
} {
  const out: { kind?: HeroKind; side?: HeroSide; focus?: HeroFocus; w?: number; h?: number } = {};
  const kind = cleanHeroKind(row.kind);
  if (kind) out.kind = kind;
  const side = cleanHeroSide(row.side);
  if (side) out.side = side;
  const focus = cleanHeroFocus(row.focus);
  if (focus) out.focus = focus;
  const w = cleanHeroPixels(row.w);
  const h = cleanHeroPixels(row.h);
  if (w && h) {
    out.w = w;
    out.h = h;
  }
  return out;
}

const LANGS = ["RU", "ET", "EN"] as const;
const TEXT_MAX = 200;

/* The texts are shaped exactly as the panel shapes them (heroClean in
   app.js: trimmed, empty languages left out, 200 characters) — a stored
   document that differed from the panel's own copy by a single character
   would read as «not saved yet» there forever. The storefront escapes every
   one of them when it draws it. */
function tri(v: unknown): Partial<Record<(typeof LANGS)[number], string>> {
  const out: Partial<Record<(typeof LANGS)[number], string>> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const l of LANGS) {
    const t = (v as Record<string, unknown>)[l];
    if (typeof t !== "string") continue;
    const s = t.trim().slice(0, TEXT_MAX);
    if (s) out[l] = s;
  }
  return out;
}

function line(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * settings.hero as it may be stored — the first door for whoever writes it.
 *
 *   null                 «стандартный баннер»: the storefront draws its own
 *   { slides, interval } the owner's banner; `slides: []` is «no banner at all»
 *
 * Anything that is not one of those two is stored as null, which is what the
 * storefront already made of it. Each slide keeps exactly the fields the
 * panel writes (heroClean in app.js), the texts trimmed and capped as the
 * panel caps them, plus the look fields above when they are valid; anything
 * else on a slide is dropped. The link and the picture are kept as strings:
 * which of them the shop can follow is the storefront's to decide
 * (heroGoAttr, heroArt), and the owner's own products are ids this route has
 * no list of.
 */
export function cleanHeroSetting(raw: unknown): { slides: Array<Record<string, unknown>>; interval: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (!Array.isArray(src.slides)) return null;
  const slides: Array<Record<string, unknown>> = [];
  for (const s of src.slides.slice(0, HERO_MAX_SLIDES)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const row = s as Record<string, unknown>;
    const id = line(row.id, 24);
    slides.push({
      id: id || `s${slides.length + 1}`,
      eyebrow: tri(row.eyebrow),
      title: tri(row.title),
      sub: tri(row.sub),
      cta: tri(row.cta),
      go: line(row.go, 80) || "cat:all",
      image: line(row.image, 300),
      on: row.on !== false,
      ...heroLayout(row),
    });
  }
  const tick = typeof src.interval === "number" && Number.isFinite(src.interval) ? Math.round(src.interval) : HERO_TICK;
  return { slides, interval: Math.min(TICK_MAX, Math.max(TICK_MIN, tick)) };
}
