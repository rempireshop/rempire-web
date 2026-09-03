/**
 * The door every model-proposed action passes through.
 *
 * The assistant writes JSON; this decides what of it is allowed to reach the
 * shop. Anything outside the whitelist — unknown type, unknown id, an
 * out-of-range value, a stray key — is dropped, so a prompt-injected "action"
 * can at worst be one of these bounded, client-confirmed operations. Objects
 * are rebuilt field by field rather than filtered, so nothing unexpected can
 * ride along inside one.
 *
 * Lives beside the route rather than inside it because a Next.js route file
 * may only export handlers, and this is the piece the tests need.
 */

export const CATEGORIES = ["hair", "styling", "beard", "face", "body", "perfume", "merch", "all"];
export const INFO_PAGES = ["shipping", "returns", "terms", "contact", "privacy"];

/* ---- the home-page banner (set_hero) ----------------------------------- */

const HERO_MAX_SLIDES = 5;
const HERO_LANGS = ["RU", "ET", "EN"] as const;
/** Field → the longest string the storefront's layout can carry. */
const HERO_FIELDS: Array<[key: string, max: number]> = [
  ["eyebrow", 40],
  ["title", 40],
  ["sub", 90],
  ["cta", 24],
];

type Trilingual = Partial<Record<(typeof HERO_LANGS)[number], string>>;

function heroText(raw: unknown, max: number): Trilingual {
  const out: Trilingual = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const lang of HERO_LANGS) {
    const v = src[lang];
    if (typeof v !== "string") continue;
    // one line: the banner is a headline, not a paragraph
    const t = v.replace(/\s+/g, " ").trim().slice(0, max);
    if (t) out[lang] = t;
  }
  return out;
}

/** A link the storefront knows how to follow, or "" when it does not. */
function heroGo(raw: unknown, known: Set<string>): string {
  const g = typeof raw === "string" ? raw.trim() : "";
  if (g === "bundles" || g === "gift" || g === "brands") return g;
  if (g.startsWith("cat:") && CATEGORIES.includes(g.slice(4))) return g;
  if (g.startsWith("page:") && INFO_PAGES.includes(g.slice(5))) return g;
  if (g.startsWith("product:") && known.has(g.slice(8))) return g;
  return "";
}

/** A catalogue photo (by product id) or a picture URL — nothing else. */
function heroImage(raw: unknown, known: Set<string>): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || v.length > 300) return "";
  if (known.has(v)) return v;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/shop\/[^\s"'<>]+$/.test(v)) return v;
  return "";
}

export function sanitizeHero(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (!Array.isArray(src.slides)) return null;

  const slides: object[] = [];
  for (const s of src.slides.slice(0, HERO_MAX_SLIDES)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const row = s as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, max] of HERO_FIELDS) out[key] = heroText(row[key], max);
    // a slide with no headline in any language is not a slide
    if (!Object.keys(out.title as Trilingual).length) continue;
    const rawId = typeof row.id === "string" ? row.id.trim() : "";
    out.id = /^[A-Za-z0-9_-]{1,24}$/.test(rawId) ? rawId : `s${slides.length + 1}`;
    out.go = heroGo(row.go, known) || "cat:all";
    out.image = heroImage(row.image, known);
    out.on = row.on !== false;
    slides.push(out);
  }
  if (!slides.length) return null;

  const tick = typeof src.interval === "number" && Number.isFinite(src.interval) ? Math.round(src.interval) : 6000;
  return { slides, interval: Math.min(30_000, Math.max(2_000, tick)) };
}

/* ---- everything the assistant may propose ------------------------------- */

export function sanitizeAction(a: unknown, known: Set<string>, isAdmin: boolean): object | null {
  if (!a || typeof a !== "object") return null;
  const x = a as Record<string, unknown>;
  const t = x.type;
  if (!isAdmin) {
    if (t === "add_to_cart") {
      const ids2 = Array.isArray(x.ids) ? x.ids.filter((i): i is string => typeof i === "string" && known.has(i)).slice(0, 5) : [];
      if (!ids2.length) return null;
      const then = x.then === "checkout" || x.then === "open_cart" ? x.then : undefined;
      return then ? { type: t, ids: ids2, then } : { type: t, ids: ids2 };
    }
    if (t === "open_product" && typeof x.id === "string" && known.has(x.id)) return { type: t, id: x.id };
    if (t === "open_category" && typeof x.id === "string" && CATEGORIES.includes(x.id)) return { type: t, id: x.id };
    if (t === "open_cart" || t === "checkout") return { type: t };
    return null;
  }
  if (t === "set_price" && typeof x.id === "string" && known.has(x.id) && typeof x.value === "number" && x.value >= 1 && x.value <= 500) {
    return { type: t, id: x.id, value: Math.round(x.value * 100) / 100 };
  }
  if (t === "set_stock" && typeof x.id === "string" && known.has(x.id) && (x.value === "in" || x.value === "low" || x.value === "out")) {
    return { type: t, id: x.id, value: x.value };
  }
  if (t === "set_seo" && typeof x.id === "string" && known.has(x.id)) {
    const title = typeof x.title === "string" ? x.title.slice(0, 70) : "";
    const description = typeof x.description === "string" ? x.description.slice(0, 170) : "";
    if (!title && !description) return null;
    return { type: t, id: x.id, title, description };
  }
  if (t === "toggle_flow" && typeof x.id === "string" && ["abandoned", "birthday", "backstock"].includes(x.id) && typeof x.value === "boolean") {
    return { type: t, id: x.id, value: x.value };
  }
  if (t === "toggle_chatbot" && typeof x.value === "boolean") {
    return { type: t, value: x.value };
  }
  if (t === "toggle_bundles" && typeof x.value === "boolean") {
    return { type: t, value: x.value };
  }
  if (t === "set_hero") {
    // null is «вернуть стандартный баннер» — a real thing the owner asks for
    if (x.value === null) return { type: t, value: null };
    const hero = sanitizeHero(x.value, known);
    return hero ? { type: t, value: hero } : null;
  }
  return null;
}

/* ---- what the panel tells the model about the banner it already has ----- */

type HeroBrief = { id: string; title: string; go: string; image: string; on: boolean };

/**
 * The storefront posts its current banner along with the question, so «поменяй
 * второй слайд» has something to point at. It is the owner's own text coming
 * back through the browser, and it lands inside a prompt — so it is trimmed
 * hard and stripped of anything that could be read as structure.
 */
export function briefHero(raw: unknown): HeroBrief[] {
  if (!Array.isArray(raw)) return [];
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  return raw.slice(0, HERO_MAX_SLIDES).map((s, i) => {
    const row = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      id: clean(row.id, 24) || `s${i + 1}`,
      title: clean(row.title, 60),
      go: clean(row.go, 80),
      image: clean(row.image, 300),
      on: row.on !== false,
    };
  });
}
