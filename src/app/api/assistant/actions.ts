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

import { sanitizeContentPatch } from "@/lib/content";
import { shelfVariant } from "@/lib/inventory";
import { CARRIER_CHOICE_COUNTRIES, carrierCost } from "@/lib/shipping/country-prices";

export const CATEGORIES = ["hair", "styling", "beard", "face", "body", "perfume", "merch", "all"];
export const INFO_PAGES = ["shipping", "returns", "terms", "contact", "privacy"];

/* inventory: duplicated from src/lib/inventory.ts's MOVE_REASONS on purpose —
   this file must stay free of database imports (it is tested as a pure
   function; @/lib/inventory pulls in @/lib/db). A conversational adjustment
   only ever gets the three reasons a human plausibly means to say out loud;
   'sale_web'/'sale_pos' are written by a real sale, never by this action. */
export const STOCK_ADJUST_REASONS = ["goods_in", "adjust", "return"] as const;

/** One line the panel can print: no control or format characters, collapsed whitespace, capped. */
function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Which shelf row a stock action means, when the model named no volume.
 *
 * Twenty-nine products are sold in exactly one named volume — Touchable is
 * «250 мл» — and the CATALOGUE block this route puts in front of the model
 * lists sizes only for the owner's own goods, so for those twenty-nine there
 * is no rung it could name even when it wants to. Left empty the action said
 * ('touchable','') , which is the row db/migrations/194_one_size_stock_rows.sql
 * folded away: it comes back the moment a count lands in it, «Склад» draws one
 * bottle as two rows again, and web sales keyed to the label are skipped as
 * untracked (audit 18.09.2026, F9).
 *
 * The same rule the order line and the shelf both already read, so the card
 * the owner is asked to confirm names the row the move will really go to.
 * POST /api/admin/inventory/moves/ — where the panel applies this — resolves
 * it once more and has the last word, because it can also read a ladder the
 * owner saved himself; here it is the catalogue's, which is what these
 * twenty-nine need and all this can see without a query.
 */
function stockRow(productId: string, variant: unknown): string {
  return shelfVariant(productId, oneLine(variant, 120));
}

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

/** A catalogue photo (by product id), the gift card's own mark, or a picture URL — nothing else. */
function heroImage(raw: unknown, known: Set<string>): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || v.length > 300) return "";
  if (known.has(v)) return v;
  /* "gift" is the one picture in the banner that is not a photograph: the
     gift card has no product behind it, so the storefront draws its own tower
     mark instead (HERO_GIFT_IMG in public/shop2/app.js), exactly the way
     heroGo() above already knows the word as a destination. Without this line
     a gift-card slide the owner had set by hand survived only until he asked
     the ASSISTANT to change the banner: the whole hero object comes back
     through here then, "gift" was cleaned away as an unknown product id, and
     the slide fell back to a photograph of a shampoo. */
  if (v === "gift") return v;
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

/* ---- promo codes (create_promo, toggle_promo) --------------------------- */

/**
 * Bounds are duplicated from src/lib/promos.ts on purpose: this file must stay
 * free of database imports (the tests run it as a pure function), and the two
 * copies are checked against each other in tests/promos.test.ts. The server
 * validates again in POST /api/admin/promos — this is the first door, not the
 * only one.
 */
const PROMO_KINDS = ["percent", "fixed", "free_shipping"] as const;
const PROMO_CODE_RE = /^[A-Z0-9-]{1,24}$/;

/** An ISO date the model wrote, or null. Anything unparseable is dropped. */
function promoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  // a code that expired before it was made is a mistake, not an instruction
  if (d.getTime() < Date.now() - 365 * 24 * 3600_000) return null;
  return d.toISOString();
}

/* ---- «Наборы»: the assistant proposes one and builds it ------------------
   Dim, 07.09.2026: «he has sets. He will make the sets himself but assistant
   needs to be able to help there as well proposing items and adding them to
   sets.» Two actions, both confirm-first like every other one here:

     · `propose_bundle` — a suggestion and nothing else. It carries products
       and a name; applying it OPENS the set editor filled in, so the owner
       still presses «Сохранить» himself. That is deliberate: a set is a price
       the shop will charge, and the assistant may not set one on its own.
     · `set_bundle` — an existing set changed (a product added or removed, a
       price moved). It goes to POST /api/admin/bundles, the same door the
       editor's own «Сохранить» uses, so `validateBundle()` on the server has
       the last word about whether the set is cheaper than its parts.

   The bounds below mirror src/lib/bundles.ts (BUNDLE_MIN_ITEMS / MAX_ITEMS /
   MAX_QTY / CATS, the slug and the name cap) rather than importing it: this
   file must stay free of database imports, the same rule STOCK_ADJUST_REASONS
   and PROMO_MAX_* already follow. tests/assistant-actions.test.ts checks the
   two copies agree. */
export const BUNDLE_MIN_ITEMS = 2;
export const BUNDLE_MAX_ITEMS = 8;
export const BUNDLE_MAX_QTY = 20;
export const BUNDLE_CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"] as const;
const BUNDLE_SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const BUNDLE_MAX_NAME = 120;
const BUNDLE_MAX_DESC = 1000;

type Tri = Partial<Record<"RU" | "ET" | "EN", string>>;
function triText(raw: unknown, max: number): Tri {
  const out: Tri = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const lang of ["RU", "ET", "EN"] as const) {
    const v = oneLine(src[lang], max);
    if (v) out[lang] = v;
  }
  return out;
}

/** The products of a set: known ids, a volume index and a quantity. */
function bundleItems(raw: unknown, known: Set<string>): Array<{ productId: string; variant: number; qty: number }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ productId: string; variant: number; qty: number }> = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, BUNDLE_MAX_ITEMS)) {
    const it = (item && typeof item === "object" ? item : { id: item }) as Record<string, unknown>;
    const productId = String(it.productId ?? it.id ?? "").trim();
    if (!productId || !known.has(productId)) return null;
    const variantRaw = it.variant ?? it.size;
    const variant = Math.trunc(variantRaw == null || variantRaw === "" ? 0 : Number(variantRaw));
    if (!Number.isFinite(variant) || variant < 0 || variant > 40) return null;
    const qtyRaw = it.qty == null || it.qty === "" ? 1 : Number(it.qty);
    const qty = Math.trunc(qtyRaw);
    if (!Number.isFinite(qty) || qty < 1 || qty > BUNDLE_MAX_QTY) return null;
    const key = `${productId}:${variant}`;
    if (seen.has(key)) continue;      // the same volume twice is one line, not two
    seen.add(key);
    out.push({ productId, variant, qty });
  }
  return out.length >= BUNDLE_MIN_ITEMS ? out : null;
}

/**
 * «Предложи набор из …» — products and a name, nothing that could be charged.
 * No price and no id: applying this opens the editor with the products in it,
 * and the owner names the price and presses «Сохранить».
 */
export function sanitizeProposeBundle(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const items = bundleItems(x.items ?? x.products ?? x.ids, known);
  if (!items) return null;
  const title = triText(x.title ?? x.name, BUNDLE_MAX_NAME);
  if (!title.RU) return null;   // Russian is the source language of every set
  const desc = triText(x.desc ?? x.description, BUNDLE_MAX_DESC);
  const cat = (BUNDLE_CATS as readonly string[]).includes(String(x.cat)) ? String(x.cat) : "";
  return { items, title, ...(Object.keys(desc).length ? { desc } : {}), ...(cat ? { cat } : {}) };
}

/**
 * «Добавь X в набор Y» / «сделай набор Y за 39 €» — a set that already exists,
 * changed. The id must look like a set's id; everything else is the same
 * bounded shape the editor sends, and the server prices it and refuses a set
 * that is not cheaper than its parts.
 */
export function sanitizeSetBundle(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const id = String(x.id ?? "").trim().toLowerCase();
  if (!BUNDLE_SLUG.test(id)) return null;
  const items = bundleItems(x.items ?? x.products, known);
  if (!items) return null;
  const out: Record<string, unknown> = { id, items };
  const title = triText(x.title ?? x.name, BUNDLE_MAX_NAME);
  if (Object.keys(title).length) out.title = title;
  const desc = triText(x.desc ?? x.description, BUNDLE_MAX_DESC);
  if (Object.keys(desc).length) out.desc = desc;
  if ((BUNDLE_CATS as readonly string[]).includes(String(x.cat))) out.cat = String(x.cat);
  if (x.price != null && String(x.price).trim() !== "") {
    const n = Math.round(Number(x.price) * 100) / 100;
    if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
    out.price = n;
  } else if (x.discountPct != null && String(x.discountPct).trim() !== "") {
    const n = Math.round(Number(x.discountPct) * 100) / 100;
    if (!Number.isFinite(n) || n <= 0 || n > 90) return null;
    out.discountPct = n;
  }
  if (typeof x.active === "boolean") out.active = x.active;
  return out;
}

/**
 * «Удали набор для бороды» — a set taken off the shop for good.
 *
 * Dim, 08.09.2026, said yes to this: the assistant could already propose a
 * set and change one, and not being able to remove one was the hole. It is
 * the narrowest action in this file — an id and nothing else — because it is
 * also the only one with nothing behind it to undo. Everything the owner
 * reads on the confirm card (the set's name, what is inside it) the panel
 * looks up in its own list of sets, so a model that named the wrong set
 * cannot also write the sentence that describes it.
 */
export function sanitizeDeleteBundle(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const id = String(x.id ?? "").trim().toLowerCase();
  return BUNDLE_SLUG.test(id) ? { id } : null;
}

export function sanitizePromo(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;

  const code = String(x.code ?? "").toUpperCase().replace(/\s+/g, "");
  if (!PROMO_CODE_RE.test(code) || !/[A-Z0-9]/.test(code)) return null;

  const kind = (PROMO_KINDS as readonly string[]).includes(String(x.kind))
    ? (String(x.kind) as (typeof PROMO_KINDS)[number])
    : "percent";

  let value = 0;
  if (kind === "percent") {
    const n = Math.round(Number(x.value));
    if (!Number.isFinite(n) || n < 1 || n > 90) return null;
    value = n;
  } else if (kind === "fixed") {
    const n = Math.round(Number(x.value) * 100) / 100;
    if (!Number.isFinite(n) || !(n > 0) || n > 200) return null;
    value = n;
  }

  const minRaw = Math.round(Number(x.minSubtotal ?? 0) * 100) / 100;
  const minSubtotal = Number.isFinite(minRaw) && minRaw >= 0 && minRaw <= 10_000 ? minRaw : 0;

  const usesRaw = Math.trunc(Number(x.maxUses));
  const maxUses = Number.isFinite(usesRaw) && usesRaw >= 1 && usesRaw <= 1_000_000 ? usesRaw : null;

  const startsAt = promoDate(x.startsAt);
  const endsAt = promoDate(x.endsAt);
  // an end before the start is nonsense; keep the start and drop the end
  const ends = startsAt && endsAt && new Date(endsAt) <= new Date(startsAt) ? null : endsAt;

  const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";

  return {
    code,
    kind,
    value,
    minSubtotal,
    startsAt,
    endsAt: ends,
    maxUses,
    active: x.active !== false,
    note,
  };
}

/* ---- a promo code's date and cap are the owner's to name ----------------
   «сделай промокод CLAUDETEST10 на 10 %» came back as «скидка 10% · до
   30.09.2026 · 100 использований» (verification pass on staging,
   25.09.2026): the literal values of the create_promo example in the
   prompt, copied as if they were defaults. The example carries neither now
   and the prompt says when they belong; and since a prompt is only a
   request, the route holds the proposal to the owner's own recent words as
   well. An end or a start stays only when he spoke of time — a date, a
   period, a day, a month —, a cap only when he spoke of a number of uses or
   a limit. Generous on purpose, in all three of his languages: a word that
   merely MIGHT be about time keeps what the model wrote, and the confirm
   card shows every term before anything is made. */
const RU_EDGE = "(?:^|[^а-яё])";
const RU_END = "(?:[^а-яё]|$)";
const PROMO_TIME_RX = new RegExp([
  "\\d{1,2}[./]\\d{1,2}",                                            // 30.09, 1/10
  `${RU_EDGE}(?:до|по|с|со)\\s+\\d{1,2}(?![\\d\\s]*%)`,             // до 30-го, с 1 октября — not «до 30 %»
  `${RU_EDGE}(?:до|по)\\s+(?:конц|начал)`,
  "срок", "конц[аеу]", "недел", "месяц", `${RU_EDGE}год(?:а|у)?${RU_END}`,
  `${RU_EDGE}(?:день|дня|дней|сутки|суток)${RU_END}`,
  "сегодн", "завтр", "выходн", "праздн", "понедельн", "вторник", `${RU_EDGE}сред[аыу]${RU_END}`, "четверг", "пятниц", "суббот", "воскрес",
  "январ", "феврал", `${RU_EDGE}март`, "апрел", `${RU_EDGE}ма[йяе]${RU_END}`, "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр",
  "действ", "истека", `${RU_EDGE}врем`, "бессрочн",
  // Estonian
  "kuni", "kehti", "päev", "nädal", "(?:^|[^a-zäöüõšž])kuu(?:[^a-zäöüõšž]|$)", "aasta", "homme", "täna", "tähtaeg", "lõpuni", "aegu",
  "jaanuar", "veebruar", "märts", "aprill", "(?:^|[^a-z])mai(?:[^a-z]|$)", "juuni", "juuli", "septemb", "oktoob", "novemb", "detsemb",
  // English
  "until", "(?:^|[^a-z])till(?:[^a-z]|$)", "through", "expir", "valid", "deadline", "end of", "black ?friday",
  "(?:^|[^a-z])(?:days?|weeks?|months?|years?|weekend|today|tonight|tomorrow)(?:[^a-z]|$)",
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday",
  "january|february|march|april|june|july|august|september|october|november|december",
].join("|"), "i");
const PROMO_LIMIT_RX = new RegExp([
  `\\d+\\s*(?:раз(?:а)?${RU_END}|использ|человек|покупател|клиент|заказ|штук|шт${RU_END}|активац)`,
  "перв(?:ых|ым)", "лимит", "огранич", "одноразов", "единоразов", "однократн", "один раз", "не более", "не больше", "максимум",
  // Estonian
  "\\d+\\s*(?:korda|kasutus|inimes|klient|ostja|tellimus)", "esimes", "piira", "ühekordn", "ühe korra",
  // English
  "\\d+\\s*(?:uses|times|people|customers|buyers|orders|redemptions)", "first\\s+\\d", "(?:^|[^a-z])once(?:[^a-z]|$)", "limit",
  "single[- ]use", "one[- ]time", "(?:^|[^a-z])(?:max|maximum|cap)(?:[^a-z]|$)",
].join("|"), "i");

/**
 * A create_promo with the date and the cap the owner did not ask for taken
 * off (set to null — the promo route reads null as «none»). `ownerWords` is
 * his last few messages: a date named before he answered «SALE10» to «как
 * назвать код?» is still his. Anything else, and a promo with nothing to
 * drop, is handed back as it came — the same object.
 */
export function promoAsAsked<T>(action: T, ownerWords: string): T {
  if (!action || typeof action !== "object" || (action as { type?: unknown }).type !== "create_promo") return action;
  const a = action as unknown as { promo?: Record<string, unknown> };
  const p = a.promo;
  if (!p || typeof p !== "object") return action;
  const words = String(ownerWords || "");
  const dropDate = (p.endsAt != null || p.startsAt != null) && !PROMO_TIME_RX.test(words);
  const dropCap = p.maxUses != null && !PROMO_LIMIT_RX.test(words);
  if (!dropDate && !dropCap) return action;
  return {
    ...a,
    promo: { ...p, ...(dropDate ? { endsAt: null, startsAt: null } : {}), ...(dropCap ? { maxUses: null } : {}) },
  } as T;
}

/* ---- delivery prices (set_shipping_rules) ------------------------------- */

/** The countries the checkout offers, plus "default" for everything else. */
const SHIP_COUNTRIES = ["EE", "LV", "LT", "FI", "EU"];
const SHIP_METHODS = ["parcel", "courier", "pickup"] as const;
/* The same five the order validator accepts (SHIP_CARRIERS in
   src/lib/orders.ts). «unisend» was missing here, so a tariff the owner asked
   the assistant to set for Unisend was dropped without a word — the card said
   «Применено ✓» and the price stayed what it was. Venipak left and Nova Post
   joined on 14.09.2026; a tariff for a carrier the shop does not offer is
   dropped by parseShippingRules() anyway, so naming one here would be the same
   silent nothing. */
const SHIP_CARRIERS = ["omniva", "smartpost", "dpd", "unisend", "novapost"];

/** 0–99 €, two decimals. A price outside that is a typo, not a tariff. */
function shipPrice(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return Math.round(n * 100) / 100;
}

/**
 * A PARTIAL rules patch — «сделай доставку в Латвию 6,90» must not wipe the
 * other eleven prices. Only the keys the model actually named come back, and
 * every one of them is a known method, a known country and a number in range;
 * the storefront merges the patch over what it already has.
 */
export function sanitizeShippingRules(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (x.freeFrom === null) out.freeFrom = null;
  else if (x.freeFrom !== undefined) {
    const n = typeof x.freeFrom === "number" ? x.freeFrom : Number(String(x.freeFrom).replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 10_000) out.freeFrom = Math.round(n * 100) / 100;
  }

  if (x.freeFromByCountry && typeof x.freeFromByCountry === "object" && !Array.isArray(x.freeFromByCountry)) {
    const by: Record<string, number | null> = {};
    for (const [c, v] of Object.entries(x.freeFromByCountry as Record<string, unknown>)) {
      const country = c.toUpperCase();
      if (!SHIP_COUNTRIES.includes(country)) continue;
      if (v === null) { by[country] = null; continue; }
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 10_000) by[country] = Math.round(n * 100) / 100;
    }
    if (Object.keys(by).length) out.freeFromByCountry = by;
  }

  if (x.methods && typeof x.methods === "object" && !Array.isArray(x.methods)) {
    const methods: Record<string, Record<string, number>> = {};
    for (const m of SHIP_METHODS) {
      const table: unknown = (x.methods as Record<string, unknown>)[m];
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      const row: Record<string, number> = {};
      for (const [c, v] of Object.entries(table as Record<string, unknown>) as Array<[string, unknown]>) {
        const key: string = c === "default" ? "default" : c.toUpperCase();
        if (key !== "default" && !SHIP_COUNTRIES.includes(key)) continue;
        const p = shipPrice(v);
        if (p !== null) row[key] = p;
      }
      if (Object.keys(row).length) methods[m] = row;
    }
    if (Object.keys(methods).length) out.methods = methods;
  }

  if (x.carriers && typeof x.carriers === "object" && !Array.isArray(x.carriers)) {
    const carriers: Record<string, Record<string, number>> = {};
    for (const [name, table] of Object.entries(x.carriers as Record<string, unknown>)) {
      const carrier = name.toLowerCase();
      if (!SHIP_CARRIERS.includes(carrier)) continue;
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      const row: Record<string, number> = {};
      for (const [c, v] of Object.entries(table as Record<string, unknown>)) {
        const key = c === "default" ? "default" : c.toUpperCase();
        if (key !== "default" && !SHIP_COUNTRIES.includes(key)) continue;
        const p = shipPrice(v);
        if (p !== null) row[key] = p;
      }
      if (Object.keys(row).length) carriers[carrier] = row;
    }
    if (Object.keys(carriers).length) out.carriers = carriers;
  }

  fanParcelOutToCarriers(out);
  return Object.keys(out).length ? out : null;
}

/**
 * «Сделай пакомат в Эстонию 6,90» has to move a bill.
 *
 * It did not. `methods.parcel.EE` was accepted, saved, and read by nobody: in
 * the four countries with chips the shopper picks the carrier, and a carrier
 * cell — or, empty, Montonio's price for that carrier — is what bills. The
 * column is only reached by a delivery the checkout cannot produce. So the
 * card said «Применено ✓» over a price that never moved: the same defect this
 * file already carries a comment about for Unisend, one layer down.
 *
 * The owner is not wrong about what he wants, so the patch is translated
 * rather than refused: a parcel price for one of the four carrier-choice
 * countries is written into every carrier cell of that country — exactly what
 * he would get by typing that number into the boxes of that row on the rate
 * screen. «Every» means the boxes the row actually has, which is why this asks
 * carrierCost() rather than walking SHOP_CARRIERS: Finland takes SmartPosti
 * and DPD and not the three with no Finnish tariff and no box, and Nova Post
 * takes its Baltic three. Nova Post being chip-only (CHIP_ONLY_CARRIERS) is no
 * reason to skip it — that flag keeps it from pricing a *country*, and this is
 * its own chip's cell, which is the one thing it is allowed to price.
 *
 * A carrier the model named itself wins over the fan-out, so «пакомат в
 * Эстонию 6,90, но Omniva 5,90» means both halves and not one of them. The
 * country's column key is then dropped from the patch: leaving it would save a
 * shadow number that agrees with the cells today and drifts from them at the
 * next edit. Countries outside the four keep theirs — no chips there, so the
 * column is still the only thing that could price a parcel.
 *
 * The below-cost guard applies to the cells this writes, which is part of the
 * point: a price under the tariff is now refused where it used to be accepted
 * and quietly ignored.
 */
function fanParcelOutToCarriers(out: Record<string, unknown>): void {
  const methods = out.methods as Record<string, Record<string, number>> | undefined;
  const parcel = methods?.parcel;
  if (!parcel) return;

  const named = (out.carriers ?? {}) as Record<string, Record<string, number>>;
  const fanned: Record<string, Record<string, number>> = {};

  for (const country of CARRIER_CHOICE_COUNTRIES) {
    const price = parcel[country];
    if (price === undefined) continue;
    const boxes = SHIP_CARRIERS.filter((c) => carrierCost(c, country, "parcel") !== null);
    if (!boxes.length) continue;
    for (const carrier of boxes) {
      if (named[carrier]?.[country] !== undefined) continue;   // the model said this one itself
      (fanned[carrier] ??= {})[country] = price;
    }
    delete parcel[country];
  }

  if (!Object.keys(fanned).length) return;
  for (const [carrier, row] of Object.entries(fanned)) {
    named[carrier] = { ...row, ...(named[carrier] ?? {}) };
  }
  out.carriers = named;
  if (!Object.keys(parcel).length) delete methods!.parcel;
  if (methods && !Object.keys(methods).length) delete out.methods;
}

/* ---- blog posts (draft_post, publish_post) ------------------------------
 *
 * Mirrors the shape @/lib/blog's upsertPost() cleans again server-side in
 * POST /api/admin/blog — this is the first door, not the only one. The body
 * cap here (6000/language) is the assistant's own ceiling, tighter than what
 * a human typing in the editor is allowed (20 000, see db/migrations/070):
 * a model that free-writes an article should not be able to fill the page
 * with output nobody asked it to keep going on.
 */
const BLOG_LANGS = ["RU", "ET", "EN"] as const;
const BLOG_TITLE_MAX = 200;
const BLOG_EXCERPT_MAX = 500;
const BLOG_BODY_MAX = 6000;
const BLOG_TAG_MAX = 30;
const BLOG_TAGS_MAX = 12;
const BLOG_PRODUCTS_MAX = 12;
/* The Google snippet: what @/lib/blog stores per language (upsertPost caps
   seoTitle at 70 and seoDesc at 170); the prompt asks the model for 60/155,
   the same margin the editor's own boxes leave. */
const BLOG_SEO_TITLE_MAX = 70;
const BLOG_SEO_DESC_MAX = 170;

function blogTrilingual(raw: unknown, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const lang of BLOG_LANGS) {
    const v = src[lang];
    if (typeof v !== "string") continue;
    const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
    if (t) out[lang] = t;
  }
  return out;
}

function blogList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim().slice(0, maxLen);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/* The short form of draft_post — what the prompt asks for now. The model
   names the topic; the panel writes the article itself, with the article
   generator (POST /api/admin/ai/text, task post_full + post_translate), and
   opens it in the editor. A whole trilingual article inside one chat
   completion was the thing that got cut by max_tokens and reached the owner
   as raw JSON; a topic never is. */
const BLOG_TOPIC_MAX = 200;
export function sanitizeDraftTopic(raw: unknown): { topic: string; lang: string; hint: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const topic = oneLine(x.topic, BLOG_TOPIC_MAX);
  if (topic.length < 3) return null;
  const lang = x.lang === "ET" || x.lang === "EN" ? x.lang : "RU";
  return { topic, lang, hint: oneLine(x.hint, 400) };
}

/* The owner's own words ride on a draft_post, put there by the route and
   never taken from the model (sanitizeDraftTopic drops any `ask` it sent).
   The model writes the topic line itself, in Russian, and a model told to
   stay on grooming «tidied» «cool vibes» into a generic hair-care subject —
   the article that came back was about that, not about what was asked for
   (the owner, /test 23.09.2026). The article generator is handed the words
   as well and told they win (buildPostFullPrompt, src/lib/ai-prompts.ts). */
const DRAFT_ASK_MAX = 300;
export function draftPostWithAsk<T>(action: T, lastUser: string): T {
  if (!action || typeof action !== "object" || (action as { type?: unknown }).type !== "draft_post") return action;
  const ask = oneLine(lastUser, DRAFT_ASK_MAX);
  return ask ? ({ ...(action as object), ask } as T) : action;
}

/** A post the assistant cannot even name in Russian is not a draft. */
export function sanitizeDraftPost(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const title = blogTrilingual(x.title, BLOG_TITLE_MAX);
  if (!title.RU) {
    // no article in the action at all — but a topic is enough: the panel writes the rest
    const short = sanitizeDraftTopic(x);
    return short ? { ...short } : null;
  }
  /* The Google snippet the model writes with the article —
     {"title":{RU,ET,EN},"description":{RU,ET,EN}} — becomes the post's own
     seoTitle/seoDesc when the owner applies the draft (applyBlogAction() in
     public/shop2/app.js): the same per-language pair the blog editor's
     «Заполнить автоматически» fills. Nothing sent, or nothing left after
     cleaning → no `seo` key at all, and the post falls back to its title and
     excerpt the way an untouched editor draft does. */
  const seoRaw = (x.seo && typeof x.seo === "object" && !Array.isArray(x.seo) ? x.seo : {}) as Record<string, unknown>;
  const seoTitle = blogTrilingual(seoRaw.title ?? x.seoTitle, BLOG_SEO_TITLE_MAX);
  const seoDesc = blogTrilingual(seoRaw.description ?? x.seoDesc, BLOG_SEO_DESC_MAX);
  const seo = Object.keys(seoTitle).length || Object.keys(seoDesc).length
    ? { title: seoTitle, description: seoDesc }
    : null;
  return {
    title,
    excerpt: blogTrilingual(x.excerpt, BLOG_EXCERPT_MAX),
    body: blogTrilingual(x.body, BLOG_BODY_MAX),
    tags: blogList(x.tags, BLOG_TAGS_MAX, BLOG_TAG_MAX),
    products: blogList(x.products, BLOG_PRODUCTS_MAX, 80).filter((id) => known.has(id)),
    ...(seo ? { seo } : {}),
  };
}

const BLOG_SLUG_RE = /^[a-z0-9-]{1,80}$/;
export function sanitizePublishPost(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const slug = typeof x.slug === "string" ? x.slug.trim().toLowerCase() : "";
  if (!BLOG_SLUG_RE.test(slug) || typeof x.publish !== "boolean") return null;
  return { slug, publish: x.publish };
}

/* ---- photos the owner attached in the chat
 *      (add_product_photo, set_post_cover, add_post_photo)
 *
 * The panel uploads a photo through POST /api/admin/upload the moment it is
 * attached, and sends the resulting keys along with the question
 * (`attachments` in the request body, see briefAttachments below). The model
 * may then point one of those keys at a product or a post — and ONLY one of
 * those: a key it did not get from this very conversation is refused, so a
 * prompt-injected action can never file somebody else's object, and the
 * key's shape is checked again against what the storage layer writes
 * (src/lib/storage.ts mediaKey/isAllowedKey — duplicated here on purpose,
 * this file stays free of that import).
 */
export const ATTACHMENTS_MAX = 6;
const ATTACH_KEY_RE = /^(products|blog|hero)\/[a-z0-9][a-z0-9._/-]*\.(webp|png|jpe?g)$/;

function attachKey(raw: unknown): string {
  const k = typeof raw === "string" ? raw.trim() : "";
  if (!k || k.length > 200 || k.includes("//") || k.includes("..") || !ATTACH_KEY_RE.test(k)) return "";
  return k;
}

export type AttachmentBrief = { key: string; name: string };

/** The photos the panel says it uploaded for this conversation — keys checked, names one-lined. */
export function briefAttachments(raw: unknown): AttachmentBrief[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentBrief[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = attachKey(o.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: oneLine(o.name, 80).replace(/[`|]/g, " ").trim() || "фото" });
    if (out.length >= ATTACHMENTS_MAX) break;
  }
  return out;
}

export type OpenPostBrief = { slug: string; title: string; status: string };

/**
 * The article the owner has open in the blog editor, as the panel reports it
 * (blogOpenForAI() in public/shop2/app.js). This is the assistant's answer to
 * «which article are we talking about» — the one thing the chat could not know
 * before, and the reason every follow-up started a new draft.
 *
 * Slug-shaped or nothing: a title the panel invented is a label for the prompt,
 * but the slug is what an action is allowed to act on, so it goes through the
 * same gate a model-written one does.
 */
export function briefOpenPost(raw: unknown): OpenPostBrief | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const slug = typeof x.slug === "string" ? x.slug.trim().toLowerCase() : "";
  if (!BLOG_SLUG_RE.test(slug)) return null;
  return {
    slug,
    title: oneLine(x.title, 120).replace(/[`|]/g, " ").trim(),
    status: x.status === "published" ? "published" : "draft",
  };
}

export function sanitizeAddProductPhoto(raw: unknown, known: Set<string>, attached: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const id = typeof x.id === "string" ? x.id.trim() : "";
  if (!id || id.length > 80 || !known.has(id)) return null;
  const key = attachKey(x.key);
  if (!key || !attached.has(key)) return null;
  return { id, key, main: x.main === true };
}

/* ---- WHICH article a photo action is about -------------------------------
 *
 * «it also loses the context and each time creates a new blog post, instead of
 * updating an already created blog post» — Renat, 18.09.2026. The slug was the
 * whole of the model's memory: it had to copy one out of the BLOG POSTS block
 * and copy it right, one turn after the panel had written a brand-new article
 * that block did not yet name. It guessed, and a cover set on the wrong post is
 * indistinguishable from a cover that was never set — which is the other half
 * of «assistant is not able to add cover photos … although it says it does».
 *
 * Two doors close that, both here:
 *   · `openSlug` — the article the owner has open in the blog editor right
 *     now, sent by the panel with the question (blogOpenForAI() in
 *     public/shop2/app.js) and named in the prompt. A photo action that
 *     carries no slug at all is about THAT article, which is the plain reading
 *     of «поставь сюда обложку» while looking at it.
 *   · `postSlugs` — every slug the prompt's BLOG POSTS block listed. A slug
 *     outside it was invented, and an invented slug used to survive all the way
 *     to «Применить» and fail there, under a reply that had already said the
 *     photo was in. Refused here instead, so the route can tell the owner the
 *     photo was NOT added (see route.ts, PHOTO_MISSED).
 * An empty `postSlugs` means the block was never fetched, so nothing is
 * checked against it — the older behaviour, unchanged.
 */
function postSlugOf(x: Record<string, unknown>, openSlug: string, postSlugs: Set<string>): string {
  const raw = typeof x.slug === "string" ? x.slug.trim().toLowerCase() : "";
  const slug = raw || openSlug;
  if (!BLOG_SLUG_RE.test(slug)) return "";
  if (postSlugs.size && !postSlugs.has(slug)) return "";
  return slug;
}

export function sanitizeSetPostCover(
  raw: unknown,
  attached: Set<string>,
  openSlug = "",
  postSlugs: Set<string> = new Set(),
): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const slug = postSlugOf(x, openSlug, postSlugs);
  if (!slug) return null;
  const key = attachKey(x.key);
  if (!key || !attached.has(key)) return null;
  return { slug, key };
}

/**
 * A photo INSIDE the article, as opposed to its cover — «добавь это фото в
 * статью». Until today there was no such action at all: the model had a cover
 * action and nothing else, so an in-article photo was a sentence saying it was
 * done and an `action: null` under it. The picture goes in as the very same
 * <figure> the editor's own «Фото» button writes, at the END of the text, and
 * both the confirm card and the reply say so — the owner moves it with the
 * arrows on the picture's own control bar (applyPostPhoto in
 * public/shop2/app.js).
 */
export function sanitizeAddPostPhoto(
  raw: unknown,
  attached: Set<string>,
  openSlug = "",
  postSlugs: Set<string> = new Set(),
): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const slug = postSlugOf(x, openSlug, postSlugs);
  if (!slug) return null;
  const key = attachKey(x.key);
  if (!key || !attached.has(key)) return null;
  return { slug, key };
}

/* ---- product creation (create_product) ----------------------------------
 *
 * The one action that makes a product the catalogue file does not have. The
 * bounds mirror src/lib/custom-products.ts (PRODUCT_CATS, 1–500 €, twelve
 * sizes) — duplicated on purpose, this file stays free of database imports;
 * tests/custom-products.test.ts checks the two agree. The route behind
 * «Применить» (POST /api/admin/products) validates again — this is the
 * first door, not the only one.
 */
const PRODUCT_CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"];
const PRODUCT_PRICE = [1, 500] as const;
const PRODUCT_MAX_SIZES = 12;

function productPrice(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < PRODUCT_PRICE[0] || n > PRODUCT_PRICE[1]) return null;
  return Math.round(n * 100) / 100;
}

/**
 * {brand, name, cat, price?, sizes?: [{size, price}] | [string], description?}
 * → {brand, name, cat, price, sizes: string[], prices: number[], description}.
 * Sizes without a price of their own take the product's; a product with
 * neither a price nor priced sizes is not a product.
 */
export function sanitizeCreateProduct(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  const brand = clean(x.brand, 60);
  const name = clean(x.name, 120);
  const cat = clean(x.cat ?? x.category, 20).toLowerCase();
  if (!brand || !name || !PRODUCT_CATS.includes(cat)) return null;

  const price = productPrice(x.price);
  const sizes: string[] = [];
  const prices: number[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(x.sizes) ? x.sizes.slice(0, PRODUCT_MAX_SIZES) : []) {
    const o = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const label = clean(o ? (o.size ?? o.label ?? o.name) : item, 30);
    if (!label || seen.has(label.toLowerCase())) continue;
    const own = o && o.price !== undefined ? productPrice(o.price) : null;
    const p = own ?? price;
    if (p === null) continue; // a size nobody priced is dropped, not guessed
    seen.add(label.toLowerCase());
    sizes.push(label);
    prices.push(p);
  }
  if (!sizes.length && price === null) return null;

  const description = blogTrilingual(x.description, 4000);
  return {
    brand,
    name,
    cat,
    price: sizes.length ? prices[0] : price,
    sizes,
    prices: sizes.length ? prices : [price as number],
    description: Object.keys(description).length ? description : null,
  };
}

/* ---- a custom product changed (update_product) --------------------------
 *
 * The PATCH PUT /api/admin/products/[id] takes, for a product the owner
 * created himself: only an id with the `c-` prefix that the prompt listed
 * (a catalogue product has set_price/set_stock/set_seo — its name and sizes
 * are the file's), and only the keys the model actually sent. Sizes follow
 * create_product's rules; a size the model did not price falls back to the
 * product's price, and a size nobody priced at all is dropped rather than
 * guessed. The server validates the merged row again — first door, not the
 * only one.
 */
const CUSTOM_ID_RE = /^c-[a-z0-9][a-z0-9-]*$/;

export function sanitizeUpdateProduct(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const id = typeof x.id === "string" ? x.id.trim() : "";
  if (!CUSTOM_ID_RE.test(id) || id.length > 80 || !known.has(id)) return null;
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  const out: Record<string, unknown> = { id };

  if (x.brand !== undefined) {
    const brand = clean(x.brand, 60);
    if (!brand) return null;
    out.brand = brand;
  }
  if (x.name !== undefined) {
    const name = clean(x.name, 120);
    if (!name) return null;
    out.name = name;
  }
  if (x.cat !== undefined || x.category !== undefined) {
    const cat = clean(x.cat ?? x.category, 20).toLowerCase();
    if (!PRODUCT_CATS.includes(cat)) return null;
    out.cat = cat;
  }
  if (x.subcat !== undefined) {
    const sub = clean(x.subcat, 10).toLowerCase();
    // the server drops a subsection its section does not have to «авто» ("")
    out.subcat = /^[a-z]{2}$/.test(sub) ? sub : "";
  }

  const price = x.price !== undefined ? productPrice(x.price) : null;
  if (x.price !== undefined && price === null) return null;
  if (x.sizes !== undefined) {
    if (!Array.isArray(x.sizes)) return null;
    const rawPrices = Array.isArray(x.prices) ? x.prices : null;
    const sizes: string[] = [];
    const prices: number[] = [];
    const seen = new Set<string>();
    x.sizes.slice(0, PRODUCT_MAX_SIZES).forEach((item, i) => {
      const o = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
      const label = clean(o ? (o.size ?? o.label ?? o.name) : item, 30);
      if (!label || seen.has(label.toLowerCase())) return;
      const own = o && o.price !== undefined ? productPrice(o.price) : rawPrices ? productPrice(rawPrices[i]) : null;
      const p = own ?? price;
      if (p === null) return; // a size nobody priced is dropped, not guessed
      seen.add(label.toLowerCase());
      sizes.push(label);
      prices.push(p);
    });
    if (!sizes.length && price === null) return null;
    out.sizes = sizes;
    out.prices = sizes.length ? prices : [price as number];
    if (!sizes.length) out.price = price;
  } else if (price !== null) {
    out.price = price;
  }

  if (x.description !== undefined) {
    const description = blogTrilingual(x.description, 4000);
    out.description = Object.keys(description).length ? description : null;
  }

  return Object.keys(out).length > 1 ? out : null;
}

/* ---- wholesale/loyalty (set_pricing, adjust_points) ---------------------
 *
 * Bounds are duplicated from src/lib/loyalty.ts PRICING_BOUNDS on purpose —
 * same reasoning as PROMO_MAX_* above: this file stays free of database
 * imports so its tests run as pure functions. tests/loyalty.test.ts checks
 * the two copies agree.
 */
const PRICING_BOUNDS = {
  proDiscountPct: [0, 90] as const,
  proMinOrder: [0, 100_000] as const,
  earnPct: [0, 50] as const,
  redeemMaxPct: [0, 100] as const,
  minRedeem: [0, 10_000] as const,
};
function inRange(v: unknown, [lo, hi]: readonly [number, number]): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/**
 * A PARTIAL patch — «подними скидку для салонов до 25 %» must not silently
 * reset the loyalty rates. The panel (demoApply's set_pricing case,
 * public/shop2/app.js) merges this over what it already has, and
 * PUT /api/admin/settings clamps again on the way into the database
 * (cleanPricing() in src/lib/loyalty.ts) — this is the first door, not the
 * only one.
 */
export function sanitizePricing(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  /* «Партнёры и баллы» — the one switch above both programmes (Dim,
     07.09.2026). «Включи партнёров и баллы» is a thing the owner will
     plausibly say out loud, so the assistant may propose it; the panel still
     shows the confirm card first, like every other change. */
  if (typeof x.partnersOn === "boolean") out.partnersOn = x.partnersOn;

  const pct = inRange(x.proDiscountPct, PRICING_BOUNDS.proDiscountPct);
  if (pct !== null) out.proDiscountPct = pct;
  const min = inRange(x.proMinOrder, PRICING_BOUNDS.proMinOrder);
  if (min !== null) out.proMinOrder = min;

  if (x.loyalty && typeof x.loyalty === "object" && !Array.isArray(x.loyalty)) {
    const l = x.loyalty as Record<string, unknown>;
    const loyalty: Record<string, unknown> = {};
    if (typeof l.enabled === "boolean") loyalty.enabled = l.enabled;
    const earn = inRange(l.earnPct, PRICING_BOUNDS.earnPct);
    if (earn !== null) loyalty.earnPct = earn;
    const redeemMax = inRange(l.redeemMaxPct, PRICING_BOUNDS.redeemMaxPct);
    if (redeemMax !== null) loyalty.redeemMaxPct = redeemMax;
    const minRedeem = inRange(l.minRedeem, PRICING_BOUNDS.minRedeem);
    if (minRedeem !== null) loyalty.minRedeem = minRedeem;
    if (Object.keys(loyalty).length) out.loyalty = loyalty;
  }

  return Object.keys(out).length ? out : null;
}

const CUSTOMER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// integration: format check only — duplicated from customers.ts's EMAIL_RE on
// purpose, same reasoning as CUSTOMER_ID_RE duplicating loyalty.ts's UUID_RE:
// this file stays free of database imports. The real resolution (and the
// only place an unknown address is rejected) is getCustomerAdminByEmail() in
// src/lib/loyalty.ts, called from the customers/[id] route.
const CUSTOMER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * A manual credit or correction to one customer's point balance — reachable
 * once the panel is looking at that customer's card (customerId, the uuid it
 * already has) OR once the owner has named the customer by e-mail in the
 * conversation (customerEmail — the one identifier a model can plausibly
 * know without the card being open; resolved to a row server-side, see the
 * customers/[id] route). Exactly one of the two travels in the sanitised
 * action, never both.
 */
export function sanitizePointsAdjust(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const customerId = typeof x.customerId === "string" ? x.customerId.trim() : "";
  const emailRaw = typeof x.customerEmail === "string" ? x.customerEmail : typeof x.customer_email === "string" ? x.customer_email : "";
  const customerEmail = emailRaw.trim().toLowerCase().slice(0, 160);
  const hasId = CUSTOMER_ID_RE.test(customerId);
  const hasEmail = !hasId && CUSTOMER_EMAIL_RE.test(customerEmail);
  if (!hasId && !hasEmail) return null;
  const delta = Math.trunc(Number(x.delta));
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100_000) return null;
  const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return hasId ? { customerId, delta, note } : { customerEmail, delta, note };
}

/* ---- everything the assistant may propose ------------------------------- */

export interface SanitizeOptions {
  /** The photo keys the panel uploaded for this conversation — the only ones a photo action may name. */
  attachedKeys?: Set<string>;
  /** The article open in the blog editor — what a photo action with no slug of its own is about. */
  openPostSlug?: string;
  /** Every slug the prompt's BLOG POSTS block listed; empty when it was never fetched. */
  postSlugs?: Set<string>;
}

export function sanitizeAction(a: unknown, known: Set<string>, isAdmin: boolean, opts: SanitizeOptions = {}): object | null {
  if (!a || typeof a !== "object") return null;
  const x = a as Record<string, unknown>;
  const t = x.type;
  const attached = opts.attachedKeys ?? new Set<string>();
  const openPostSlug = typeof opts.openPostSlug === "string" ? opts.openPostSlug : "";
  const postSlugs = opts.postSlugs ?? new Set<string>();
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
    // the same one-line, 70/170 shape src/lib/product-seo.ts stores — a
    // snippet, not a paragraph, and nothing a <title> cannot carry
    const title = oneLine(x.title, 70);
    const description = oneLine(x.description, 170);
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
  /* «Наборы»: propose one, or change one that exists. Dim keeps building the
     sets himself — this is the assistant helping, and both go through the
     confirm card first (see the two sanitisers above for why the proposal
     carries no price). */
  if (t === "propose_bundle") {
    const proposal = sanitizeProposeBundle(x, known);
    return proposal ? { type: t, ...proposal } : null;
  }
  if (t === "set_bundle") {
    const bundle = sanitizeSetBundle(x.bundle ?? x, known);
    return bundle ? { type: t, ...bundle } : null;
  }
  /* …and a set removed. The only action here the change journal cannot take
     back, which is why the panel puts it behind the same red «Да, удалить»
     card the set editor's own delete button uses. */
  if (t === "delete_bundle") {
    const gone = sanitizeDeleteBundle(x);
    return gone ? { type: t, ...gone } : null;
  }
  if (t === "set_hero") {
    // null is «вернуть стандартный баннер» — a real thing the owner asks for
    if (x.value === null) return { type: t, value: null };
    const hero = sanitizeHero(x.value, known);
    return hero ? { type: t, value: hero } : null;
  }
  if (t === "create_promo") {
    const promo = sanitizePromo(x.promo ?? x.value ?? x);
    return promo ? { type: t, promo } : null;
  }
  if (t === "toggle_promo" && typeof x.value === "boolean") {
    const code = String(x.code ?? "").toUpperCase().replace(/\s+/g, "");
    if (!PROMO_CODE_RE.test(code) || !/[A-Z0-9]/.test(code)) return null;
    return { type: t, code, value: x.value };
  }
  if (t === "set_shipping_rules") {
    const rules = sanitizeShippingRules(x.rules ?? x.value);
    return rules ? { type: t, rules } : null;
  }
  /* The shop's own details — company, hours, socials, announcement bar,
     contact page, letter footer. A PATCH, not a document: «поменяй телефон»
     sends only the phone, and everything else keeps the value it had. The
     rebuild-field-by-field sanitiser lives in @/lib/content so the panel and
     this route can never disagree about what is allowed. */
  if (t === "set_content") {
    const patch = sanitizeContentPatch(x.value ?? x.content);
    return patch ? { type: t, value: patch } : null;
  }
  // blog: no demo layer to write into, so the panel calls the admin API
  // directly once the owner clicks «Применить» — see applyBlogAction() in
  // public/shop2/app.js. Both still go through the same confirm-first flow.
  if (t === "draft_post") {
    const post = sanitizeDraftPost(x, known);
    return post ? { type: t, ...post } : null;
  }
  if (t === "publish_post") {
    const pub = sanitizePublishPost(x);
    return pub ? { type: t, ...pub } : null;
  }
  /* photos attached in the chat: filed onto a product's gallery (the
     panel's own set_gallery write, journalled and undoable) or onto a
     post's cover — only a key this conversation uploaded, see above */
  if (t === "add_product_photo") {
    const photo = sanitizeAddProductPhoto(x, known, attached);
    return photo ? { type: t, ...photo } : null;
  }
  if (t === "set_post_cover") {
    const cover = sanitizeSetPostCover(x, attached, openPostSlug, postSlugs);
    return cover ? { type: t, ...cover } : null;
  }
  // …and the same photo inside the article rather than on top of it
  if (t === "add_post_photo") {
    const photo = sanitizeAddPostPhoto(x, attached, openPostSlug, postSlugs);
    return photo ? { type: t, ...photo } : null;
  }
  // assistant-work: the accountant export — «выгрузи отчёт за август» hands
  // back a month, the panel turns it into a download link
  // (GET /api/admin/reports/orders?month=…) rather than a demoApply/undo
  // change, so this is the whole of the sanitising this action needs.
  if (t === "export_report") {
    const month = String(x.month ?? "").trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { type: t, month } : null;
  }
  // wholesale/loyalty: pro discount, loyalty rates, on/off («подними скидку
  // для салонов до 25 %», «выключи баллы»); adjust_points is a manual credit
  // on one customer's card, only ever proposed once the panel has an id.
  if (t === "set_pricing") {
    const pricing = sanitizePricing(x.value ?? x);
    return pricing ? { type: t, value: pricing } : null;
  }
  if (t === "adjust_points") {
    const adj = sanitizePointsAdjust(x);
    return adj ? { type: t, ...adj } : null;
  }
  /* inventory: numeric stock, always variant-aware. stock_adjust is a
     relative move («приход 6 штук масла Proraso» → delta +6, reason
     'goods_in'); stock_set is an absolute «останется 10 штук». Both are
     admin-only and applied straight through POST /api/admin/inventory/moves/
     (applyStockAction() in public/shop2/app.js) — no demo layer, same story
     as the blog posts above. reason is deliberately NOT the full move-reason
     set: 'sale_web'/'sale_pos' are what a real web or till sale writes on
     its own, and letting the assistant claim one from a chat message risks
     a manual adjustment double-counting as a sale in the ledger. */
  if (t === "stock_adjust" && typeof x.product_id === "string" && known.has(x.product_id)) {
    const delta = Math.trunc(Number(x.delta));
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10_000) return null;
    const reason = (STOCK_ADJUST_REASONS as readonly string[]).includes(String(x.reason)) ? String(x.reason) : "adjust";
    const variant = stockRow(x.product_id, x.variant);
    return { type: t, product_id: x.product_id, variant, delta, reason };
  }
  if (t === "stock_set" && typeof x.product_id === "string" && known.has(x.product_id)) {
    const qty = Math.trunc(Number(x.qty));
    if (!Number.isFinite(qty) || qty < 0 || qty > 100_000) return null;
    const variant = stockRow(x.product_id, x.variant);
    return { type: t, product_id: x.product_id, variant, qty };
  }
  /* product creation: a new row in custom_products — no demo layer, the
     panel POSTs it to /api/admin/products once the owner confirms and opens
     the editor on «Фото и видео» (applyCreateProduct() in app.js); the undo
     is «снять с продажи». */
  if (t === "create_product") {
    const product = sanitizeCreateProduct(x);
    return product ? { type: t, ...product } : null;
  }
  /* …and a change to one of those rows: the panel PUTs the patch once the
     owner confirms (applyUpdateProduct() in app.js) and keeps the row as it
     was in the journal, so «Вернуть» is the same PUT the other way. */
  if (t === "update_product") {
    const patch = sanitizeUpdateProduct(x, known);
    return patch ? { type: t, ...patch } : null;
  }
  return null;
}

/* ---- what the panel tells the model about the banner it already has ----- */

type HeroBrief = {
  id: string;
  eyebrow: Trilingual;
  title: Trilingual;
  sub: Trilingual;
  cta: Trilingual;
  go: string;
  image: string;
  on: boolean;
};

/**
 * The storefront posts its current banner along with the question, so «поменяй
 * второй слайд» has something to point at. It is the owner's own text coming
 * back through the browser, and it lands inside a prompt — so it is trimmed
 * hard and stripped of anything that could be read as structure.
 *
 * Every field of every slide, in all three languages: set_hero replaces the
 * WHOLE banner, and the model used to be shown one Russian headline per slide
 * and nothing else — so «поменяй второй слайд» came back with the other slides
 * stripped of their Estonian and English, their eyebrow, their subtitle and
 * their button, because the model cannot copy through what it was never shown.
 * This is the same shape the action takes back, so «keep the other slides
 * exactly as the list above has them» is now something it can actually do.
 */
export function briefHero(raw: unknown): HeroBrief[] {
  if (!Array.isArray(raw)) return [];
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  /* A panel cached from before the banner travelled in three languages sends
     the Russian title as a bare string — read as Russian rather than dropped.
     The backtick goes the same way it did when these were flat lines: nothing
     that could be read as a fence reaches the prompt. */
  const noTicks = (s: string) => s.replace(/`+/g, " ");
  const tri = (v: unknown, max: number): Trilingual => {
    if (typeof v === "string") return heroText({ RU: noTicks(v) }, max);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const src = v as Record<string, unknown>;
    const flat: Record<string, unknown> = {};
    for (const l of HERO_LANGS) if (typeof src[l] === "string") flat[l] = noTicks(src[l] as string);
    return heroText(flat, max);
  };
  return raw.slice(0, HERO_MAX_SLIDES).map((s, i) => {
    const row = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      id: clean(row.id, 24) || `s${i + 1}`,
      eyebrow: tri(row.eyebrow, 40),
      title: tri(row.title, 40),
      sub: tri(row.sub, 90),
      cta: tri(row.cta, 24),
      go: clean(row.go, 80),
      image: clean(row.image, 300),
      on: row.on !== false,
    };
  });
}

/* ---- analytics agent: what the panel tells the model about sales -------- */

export type AnalyticsBrief = {
  revenue: number;
  orders: number;
  aov: number;
  conversionPct: number;
  topProducts: Array<{ name: string; brand: string; revenue: number }>;
  topSearchTerms: Array<{ term: string; count: number }>;
};

/**
 * analyticsForAI() in app.js posts a 30-day summary along with the owner's
 * question — «сколько продали за неделю» needs numbers to answer from. It is
 * plain figures the panel itself fetched from GET /api/admin/analytics, not
 * anything the owner typed, so there is nothing here worth sanitising the way
 * briefHero() does for free-form text; this only re-shapes and bounds it, the
 * same defensive distance every other body field gets before it reaches a
 * prompt.
 */
export function briefAnalytics(raw: unknown): AnalyticsBrief | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

  const products = Array.isArray(x.topProducts) ? x.topProducts.slice(0, 5) : [];
  const terms = Array.isArray(x.topSearchTerms) ? x.topSearchTerms.slice(0, 5) : [];
  return {
    revenue: n(x.revenue),
    orders: n(x.orders),
    aov: n(x.aov),
    conversionPct: n(x.conversionPct),
    topProducts: products.map((p) => {
      const row = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return { name: clean(row.name, 80), brand: clean(row.brand, 40), revenue: n(row.revenue) };
    }),
    topSearchTerms: terms.map((t) => {
      const row = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      return { term: clean(row.term, 60), count: n(row.count) };
    }),
  };
}
