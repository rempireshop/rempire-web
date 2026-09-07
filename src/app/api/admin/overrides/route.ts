/**
 * PUT /api/admin/overrides — the admin's edits to a product.
 *
 * Partial by design: send only what changed. `null` clears an override and
 * hands the field back to the catalogue.
 *
 *   { "id": "touchable", "price": 25.5 }
 *   { "id": "touchable", "stock": "low", "seoTitle": "…", "seoDesc": "…" }
 *   { "items": [ { "id": "a", "price": 9 }, { "id": "b", "stock": "out" } ] }
 *   { "id": "touchable", "gallery": [ { "url": "…", "thumb": "…", "alt": "" } ] }
 *   { "id": "touchable", "seo": { "RU": { "title": "…", "desc": "…" }, "ET": { … }, "EN": { … } } }
 *
 * `seo` is the per-language Google pair (src/lib/product-seo.ts) and is
 * replaced as a whole: a language left out is cleared. Its RU half lands in
 * the legacy seo_title/seo_desc columns, which `seoTitle`/`seoDesc` still
 * read and write on their own for anything that predates it.
 *
 * GET returns the same map as /api/overrides but uncached, for the panel.
 */
import { requireAdmin } from "@/lib/auth";
import { getOverrides, MAX_SIZES, OrderError, upsertOverride, writeAuditSafe, type Override } from "@/lib/orders";
import {
  getDescriptionOverrides,
  setDescriptionOverride,
  type DescriptionOverride,
} from "@/lib/product-descriptions";
import { getSeoOverrides, setSeoOverride, type SeoOverride } from "@/lib/product-seo";

type OverrideOut = Override & { description?: DescriptionOverride | null; seo?: SeoOverride | null };

function emptyOverride(): Override {
  return {
    price: null, stock: null, seoTitle: null, seoDesc: null, subcat: null,
    varImg: null, videoUrl: null, gallery: null, proPrice: null,
    sizes: null, hidden: false, updatedAt: null,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Patch = Partial<Override> & { id?: string; product_id?: string };

/* Every row of this table is served to the world by GET /api/overrides and
   cached at the edge, and nothing ever deletes a row — so what is stored
   has to be bounded here, on the way in (audit L8; security re-audit
   04.09.2026). Catalogue ids are slugs of at most 74 characters, custom ids
   `c-…` of at most 80; the legacy Russian pair gets the same 70/170 the
   per-language pair has in src/lib/product-seo.ts; a subsection is a short
   code; varImg is one gallery index per size. */
const MAX_ID = 120;
const MAX_SUBCAT = 40;
const MAX_VAR_IMG = 32;

/** A string field: one line, capped; null clears; anything else is refused. */
function textField(patch: Partial<Override>, key: "seoTitle" | "seoDesc" | "subcat", max: number): void {
  if (!(key in patch)) return;
  const v = patch[key];
  if (v == null) {
    patch[key] = null;
    return;
  }
  if (typeof v !== "string") throw new OrderError("bad_body", key);
  const clean = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (key === "subcat" && clean.length > max) throw new OrderError("bad_body", key);
  patch[key] = clean.slice(0, max);
}

/** Accepts both the camelCase the storefront sends and the column names. */
function normalise(raw: Record<string, unknown>): { id: string; patch: Partial<Override> } {
  const id = String(raw.id ?? raw.product_id ?? "").trim();
  if (id.length > MAX_ID || /[\s\p{Cc}]/u.test(id)) throw new OrderError("bad_id", id.slice(0, 40));
  const patch: Partial<Override> = {};
  const pick = (from: string[], to: keyof Override) => {
    for (const key of from) {
      if (key in raw) {
        (patch as Record<string, unknown>)[to] = raw[key];
        return;
      }
    }
  };
  pick(["price"], "price");
  pick(["stock"], "stock");
  pick(["seoTitle", "seo_title", "title"], "seoTitle");
  pick(["seoDesc", "seo_desc"], "seoDesc");
  /* `description` is two different things on this body: the older panel's
     alias for seoDesc (a string) and the trilingual {RU,ET,EN} product
     description (an object, written below by setDescriptionOverride). Only
     the string is the alias. The object used to land in seo_desc as JSON
     text as well, where getSeoOverrides() read it back as the Russian
     Google description (security re-audit 04.09.2026). */
  if (!("seoDesc" in patch) && typeof raw.description === "string") patch.seoDesc = raw.description;
  pick(["subcat", "sub"], "subcat");
  pick(["varImg", "var_img"], "varImg");
  pick(["videoUrl", "video_url", "video"], "videoUrl");
  /* The photos the owner uploaded (docs/media.md). Whatever arrives is put
     through cleanGallery() in upsertOverride, so a malformed entry is dropped
     rather than stored; an empty list means «back to the catalogue photos». */
  pick(["gallery", "photos"], "gallery");
  // wholesale/loyalty: the salon/pro price for this one product — null clears
  // it back to base price × (1 − settings.pricing.proDiscountPct/100).
  pick(["proPrice", "pro_price"], "proPrice");
  /* migration 147 — the editor's «+ Размер» / «×» and «Показывать в магазине».
     The ladder travels whole (a merge cannot say «this rung is gone»), goes
     through cleanSizes() in upsertOverride, and `null` gives the product back
     to the generated catalogue file. */
  pick(["sizes"], "sizes");
  pick(["hidden"], "hidden");
  if ("price" in patch && patch.price != null) {
    const n = Number(patch.price);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new OrderError("bad_price", id);
    patch.price = n;
  }
  if ("proPrice" in patch && patch.proPrice != null) {
    const n = Number(patch.proPrice);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new OrderError("bad_price", id);
    patch.proPrice = n;
  }
  textField(patch, "seoTitle", 70);
  textField(patch, "seoDesc", 170);
  textField(patch, "subcat", MAX_SUBCAT);
  if ("varImg" in patch && patch.varImg != null) {
    const v = patch.varImg as unknown;
    const ok = Array.isArray(v) && v.length <= MAX_VAR_IMG &&
      v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= -1 && n <= 999);
    if (!ok) throw new OrderError("bad_body", "varImg");
  }
  /* The ladder is either a list or `null`; a scalar or an object is a caller
     that thinks it is sending something else, and silently storing null for
     it would wipe the sizes the owner had. cleanSizes() (src/lib/orders.ts)
     drops the rungs inside it that make no sense. */
  if ("sizes" in patch && patch.sizes != null && !Array.isArray(patch.sizes)) {
    throw new OrderError("bad_body", "sizes");
  }
  if ("sizes" in patch && Array.isArray(patch.sizes) && patch.sizes.length > MAX_SIZES) {
    throw new OrderError("bad_body", "sizes");
  }
  if ("hidden" in patch && typeof patch.hidden !== "boolean") throw new OrderError("bad_body", "hidden");
  return { id, patch };
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const [overrides, descriptions, seos] = await Promise.all([getOverrides(), getDescriptionOverrides(), getSeoOverrides()]);
    const out: Record<string, OverrideOut> = overrides;
    for (const [id, description] of Object.entries(descriptions)) {
      out[id] = { ...(out[id] ?? emptyOverride()), description };
    }
    // the per-language Google pairs — the RU half is the same seo_title /
    // seo_desc the row already carries, ET/EN come from seo_langs
    for (const [id, seo] of Object.entries(seos)) {
      out[id] = { ...(out[id] ?? emptyOverride()), seo };
    }
    return Response.json({ ok: true, overrides: out }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/overrides] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const list: Patch[] = Array.isArray(body?.items)
    ? (body.items as Patch[])
    : Array.isArray(body)
      ? (body as Patch[])
      : [body as Patch];
  if (!list.length || list.length > 200) return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  /* A body of `null`, `5` or `"x"` parses fine and lands here as a one-entry
     list; normalise() then reads `.id` off it and throws (audit: fuzz). */
  if (list.some((p) => !p || typeof p !== "object" || Array.isArray(p))) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const saved: Record<string, OverrideOut> = {};
  try {
    for (const raw0 of list) {
      const raw = raw0 as Record<string, unknown>;
      const { id, patch } = normalise(raw);
      if (!id) return Response.json({ ok: false, error: "bad_id" }, { status: 400 });
      const row: OverrideOut = await upsertOverride(id, patch);
      // assistant-work: description {RU,ET,EN} lives in its own column
      // (src/lib/product-descriptions.ts) — see the GET handler's comment.
      if ("description" in raw || "descriptions" in raw) {
        row.description = await setDescriptionOverride(id, raw.description ?? raw.descriptions);
        await writeAuditSafe("admin", "override.description", { id });
      }
      /* The per-language Google pairs, written after the legacy pair so a
         body carrying both (`seoTitle` and `seo`) ends with the per-language
         set in charge — it is the one the editor sends. */
      if ("seo" in raw) {
        row.seo = await setSeoOverride(id, raw.seo);
        row.seoTitle = row.seo?.RU?.title ?? null;
        row.seoDesc = row.seo?.RU?.desc ?? null;
        await writeAuditSafe("admin", "override.seo", { id });
      }
      saved[id] = row;
      await writeAuditSafe("admin", "override.set", { id, patch });
    }
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ ok: false, error: err.code, detail: err.detail }, { status: 400 });
    console.error("[api/admin/overrides] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }

  return Response.json({ ok: true, overrides: saved }, { headers: { "cache-control": "no-store" } });
}
