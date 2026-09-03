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
  if ("price" in patch && patch.price != null) {
    const n = Number(patch.price);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new OrderError("bad_price", id);
    patch.price = n;
  }
  return { id, patch };
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, overrides: await getOverrides() }, { headers: { "cache-control": "no-store" } });
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

  const saved: Record<string, Override> = {};
  try {
    for (const raw of list) {
      const { id, patch } = normalise(raw as Record<string, unknown>);
      if (!id) return Response.json({ ok: false, error: "bad_id" }, { status: 400 });
      saved[id] = await upsertOverride(id, patch);
      await writeAuditSafe("admin", "override.set", { id, patch });
    }
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ ok: false, error: err.code, detail: err.detail }, { status: 400 });
    console.error("[api/admin/overrides] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }

  return Response.json({ ok: true, overrides: saved }, { headers: { "cache-control": "no-store" } });
}
