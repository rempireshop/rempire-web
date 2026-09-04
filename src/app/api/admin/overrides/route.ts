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
 *
 * GET returns the same map as /api/overrides but uncached, for the panel.
 */
import { requireAdmin } from "@/lib/auth";
import { getOverrides, OrderError, upsertOverride, writeAuditSafe, type Override } from "@/lib/orders";
import {
  getDescriptionOverrides,
  setDescriptionOverride,
  type DescriptionOverride,
} from "@/lib/product-descriptions";

type OverrideOut = Override & { description?: DescriptionOverride | null };

function emptyOverride(): Override {
  return {
    price: null, stock: null, seoTitle: null, seoDesc: null, subcat: null,
    varImg: null, videoUrl: null, gallery: null, proPrice: null, updatedAt: null,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Patch = Partial<Override> & { id?: string; product_id?: string };

/** Accepts both the camelCase the storefront sends and the column names. */
function normalise(raw: Record<string, unknown>): { id: string; patch: Partial<Override> } {
  const id = String(raw.id ?? raw.product_id ?? "").trim();
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
  pick(["seoDesc", "seo_desc", "description"], "seoDesc");
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
  return { id, patch };
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const [overrides, descriptions] = await Promise.all([getOverrides(), getDescriptionOverrides()]);
    const out: Record<string, OverrideOut> = overrides;
    for (const [id, description] of Object.entries(descriptions)) {
      out[id] = { ...(out[id] ?? emptyOverride()), description };
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
