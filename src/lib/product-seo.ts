/**
 * Per-language Google title/description for a product —
 * product_overrides.seo_title / seo_desc (the Russian pair, 001_core.sql)
 * plus product_overrides.seo_langs (Estonian and English,
 * db/migrations/130_product_overrides_seo_langs.sql).
 *
 * A separate module from src/lib/orders.ts for the same reason
 * src/lib/product-descriptions.ts is: that file is shared/owned by
 * backend-core ("others import, don't edit"), and its Override shape carries
 * the one Russian pair. This module reads and writes the very same row —
 * all three columns at once — through its own tiny read/write pair, so the
 * legacy `seoTitle`/`seoDesc` fields keep meaning what they always meant.
 *
 * One shape everywhere: `{ RU?: {title?, desc?}, ET?: {…}, EN?: {…} }`, only
 * the languages that have text. Precedence on a page in language L: L's own
 * field → the Russian field → nothing (the caller builds its own title).
 */
import { jsonbParam, query } from "@/lib/db";

export const SEO_LANGS = ["RU", "ET", "EN"] as const;
export type SeoLang = (typeof SEO_LANGS)[number];
export type SeoPair = { title?: string; desc?: string };
export type SeoOverride = Partial<Record<SeoLang, SeoPair>>;

/** The same caps the editor's fields carry (maxlength 70 / 170). */
const MAX_TITLE = 70;
const MAX_DESC = 170;

type Row = { product_id: string; seo_title: string | null; seo_desc: string | null; seo_langs: unknown };

function parseJsonb(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

/** One line, collapsed whitespace, capped — a snippet, not an article. */
function line(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanPair(raw: unknown): SeoPair | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  // the panel says {t, d} in its own state, the API says {title, desc}
  const title = line(src.title ?? src.t, MAX_TITLE);
  const desc = line(src.desc ?? src.d ?? src.description, MAX_DESC);
  if (!title && !desc) return null;
  const out: SeoPair = {};
  if (title) out.title = title;
  if (desc) out.desc = desc;
  return out;
}

/** Rebuilt field by field — the same discipline every sanitiser in this repo follows. */
export function cleanSeoPatch(raw: unknown): SeoOverride | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: SeoOverride = {};
  for (const lang of SEO_LANGS) {
    const pair = cleanPair(src[lang]);
    if (pair) out[lang] = pair;
  }
  return Object.keys(out).length ? out : null;
}

/** The three columns of one row → the one shape. */
function fromRow(r: Row): SeoOverride | null {
  const out: SeoOverride = {};
  const ru = cleanPair({ title: r.seo_title, desc: r.seo_desc });
  if (ru) out.RU = ru;
  const rest = parseJsonb(r.seo_langs);
  if (rest && typeof rest === "object" && !Array.isArray(rest)) {
    const src = rest as Record<string, unknown>;
    for (const lang of ["ET", "EN"] as const) {
      const pair = cleanPair(src[lang]);
      if (pair) out[lang] = pair;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Every product with a Google pair in any language, or just the ones asked for. */
export async function getSeoOverrides(ids?: string[]): Promise<Record<string, SeoOverride>> {
  const where = "(seo_title is not null or seo_desc is not null or seo_langs is not null)";
  let rows: Row[];
  if (ids && ids.length) {
    const holes = ids.map((_, i) => `$${i + 1}`).join(",");
    rows = await query<Row>(
      `select product_id, seo_title, seo_desc, seo_langs from product_overrides where product_id in (${holes}) and ${where}`,
      ids,
    );
  } else {
    rows = await query<Row>(`select product_id, seo_title, seo_desc, seo_langs from product_overrides where ${where}`);
  }
  const out: Record<string, SeoOverride> = {};
  for (const r of rows) {
    const v = fromRow(r);
    if (v) out[r.product_id] = v;
  }
  return out;
}

export async function getSeoOverride(productId: string): Promise<SeoOverride | null> {
  const rows = await query<Row>(
    `select product_id, seo_title, seo_desc, seo_langs from product_overrides where product_id = $1`,
    [productId],
  );
  return rows.length ? fromRow(rows[0]) : null;
}

/**
 * Replaces the whole per-language set — the editor sends all three pairs
 * every time, so a pair the owner emptied is cleared here too. `null` (or
 * nothing valid left after cleaning) clears every language, handing the
 * page back to its built-in title. The Russian pair lands in the two legacy
 * columns, so an older reader (`seoTitle`/`seoDesc`) still sees it.
 */
export async function setSeoOverride(productId: string, patch: unknown): Promise<SeoOverride | null> {
  const id = String(productId ?? "").trim();
  if (!id) throw new Error("bad_id");
  const clean = patch == null ? null : cleanSeoPatch(patch);
  const ru = clean?.RU ?? null;
  const rest: SeoOverride = {};
  if (clean?.ET) rest.ET = clean.ET;
  if (clean?.EN) rest.EN = clean.EN;
  const langs = Object.keys(rest).length ? jsonbParam(rest) : null;
  await query(
    `insert into product_overrides (product_id, seo_title, seo_desc, seo_langs, updated_at)
     values ($1, $2, $3, $4::jsonb, now())
     on conflict (product_id) do update
       set seo_title = $2, seo_desc = $3, seo_langs = $4::jsonb, updated_at = now()`,
    [id, ru?.title ?? null, ru?.desc ?? null, langs],
  );
  return clean;
}

/**
 * The pair a page in `lang` shows: each field from its own language, else
 * from the Russian one — or null when the owner wrote nothing at all.
 */
export function pickSeo(override: SeoOverride | null | undefined, lang: string): SeoPair | null {
  if (!override) return null;
  const key = (SEO_LANGS as readonly string[]).includes(lang) ? (lang as SeoLang) : "RU";
  const own = override[key] ?? {};
  const ru = override.RU ?? {};
  const title = own.title || ru.title || "";
  const desc = own.desc || ru.desc || "";
  if (!title && !desc) return null;
  const out: SeoPair = {};
  if (title) out.title = title;
  if (desc) out.desc = desc;
  return out;
}
