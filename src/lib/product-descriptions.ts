/**
 * Trilingual product description override — `product_overrides.description`
 * (db/migrations/110_product_overrides_description.sql).
 *
 * A separate module rather than an addition to `src/lib/orders.ts` on
 * purpose: that file is shared/owned by backend-core (docs/build-contracts.md
 * — "others import, don't edit"), and its `Override`/`upsertOverride()` shape
 * has no `description` field. This module talks to the very same
 * `product_overrides` row through its own column, with its own tiny
 * read/write pair, so nothing there has to change.
 *
 * Semantics match every other override in this table: null (no row, or a
 * null column) means "no override, use the catalogue's static text"; a
 * language key absent from the stored object falls back to that one
 * language's static text, not to Russian — see docs/assistant-work.md
 * "Product descriptions" for the exact precedence the storefront and this
 * module both follow.
 */
import { query } from "@/lib/db";

export const DESC_LANGS = ["RU", "ET", "EN"] as const;
export type DescLang = (typeof DESC_LANGS)[number];
export type DescriptionOverride = Partial<Record<DescLang, string>>;

/** Generous but bounded — a product page copy block, not an article. */
const MAX_DESC_CHARS = 4000;

type Row = { product_id: string; description: unknown };

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

/** Rebuilt field by field — the same discipline every sanitiser in this repo follows. */
export function cleanDescriptionPatch(raw: unknown): DescriptionOverride | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: DescriptionOverride = {};
  for (const lang of DESC_LANGS) {
    const v = src[lang];
    if (typeof v !== "string") continue;
    const t = v
      .replace(/\r\n?/g, "\n")
      .replace(/\p{Cc}/gu, (ch) => (ch === "\n" ? "\n" : " "))
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_DESC_CHARS);
    if (t) out[lang] = t;
  }
  return Object.keys(out).length ? out : null;
}

function toOverride(v: unknown): DescriptionOverride | null {
  const parsed = parseJsonb(v);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const cleaned = cleanDescriptionPatch(parsed);
  return cleaned;
}

/** Every product with a description override, or just the ones asked for. */
export async function getDescriptionOverrides(ids?: string[]): Promise<Record<string, DescriptionOverride>> {
  let rows: Row[];
  if (ids && ids.length) {
    const holes = ids.map((_, i) => `$${i + 1}`).join(",");
    rows = await query<Row>(
      `select product_id, description from product_overrides where product_id in (${holes}) and description is not null`,
      ids,
    );
  } else {
    rows = await query<Row>(`select product_id, description from product_overrides where description is not null`);
  }
  const out: Record<string, DescriptionOverride> = {};
  for (const r of rows) {
    const d = toOverride(r.description);
    if (d) out[r.product_id] = d;
  }
  return out;
}

export async function getDescriptionOverride(productId: string): Promise<DescriptionOverride | null> {
  const rows = await query<Row>(`select product_id, description from product_overrides where product_id = $1`, [
    productId,
  ]);
  return rows.length ? toOverride(rows[0].description) : null;
}

/**
 * Partial upsert — same "insert the row if it does not exist yet, touch only
 * this column" shape as `upsertOverride()` in @/lib/orders. `patch` of `null`
 * (or an object with no valid language left after cleaning) clears the
 * override entirely, handing the product page back to the static text.
 */
export async function setDescriptionOverride(
  productId: string,
  patch: unknown,
): Promise<DescriptionOverride | null> {
  const id = String(productId ?? "").trim();
  if (!id) throw new Error("bad_id");
  const clean = patch == null ? null : cleanDescriptionPatch(patch);
  await query(
    `insert into product_overrides (product_id, description, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (product_id) do update set description = $2::jsonb, updated_at = now()`,
    [id, clean ? JSON.stringify(clean) : null],
  );
  return clean;
}

/** The text the product page shows for one language: override, else null (caller falls back to static). */
export function pickDescription(override: DescriptionOverride | null | undefined, lang: string): string | null {
  if (!override) return null;
  const key = (DESC_LANGS as readonly string[]).includes(lang) ? (lang as DescLang) : "RU";
  const v = override[key];
  return v && v.trim() ? v : null;
}
