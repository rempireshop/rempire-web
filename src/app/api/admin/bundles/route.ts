/**
 * The sets («Наборы»), the owner's side. Every verb is behind requireAdmin.
 *
 * GET    /api/admin/bundles/                    → { ok, bundles }  (incl. hidden ones)
 * POST   /api/admin/bundles/  {id, cat, title{RU,ET,EN}, desc{…}, items:[{productId,
 *                              variant, qty}], price | discountPct, image, active, sort}
 *                                               → { ok, bundle }   (create or edit)
 * PATCH  /api/admin/bundles/  {id, active}      → { ok, bundle }   (show/hide one)
 *        /api/admin/bundles/  {order:[id,…]}    → { ok, bundles }  (the sort arrows)
 * DELETE /api/admin/bundles/?id=<slug>          → { ok, bundle }
 *
 * Everything is validated by validateBundle() in src/lib/bundles.ts — the same
 * door the seed and the tests use, so a set typed in the panel and a set
 * written by anything else are held to identical bounds: at least two real
 * catalogue products, no product twice, and a price strictly below what the
 * parts cost separately (`price_too_high`).
 *
 * DELETE is real here, unlike promo codes: a set is a shop-window object, not
 * a redemption record — the order it was bought in keeps its own frozen copy
 * of the line (src/lib/orders.ts writes title and price into the order). The
 * panel still asks before it deletes.
 *
 * NB: trailing slash on all of them (next.config has trailingSlash: true).
 */
import { requireAdmin } from "@/lib/auth";
import {
  deleteBundle,
  listBundles,
  reorderBundles,
  setBundleActive,
  upsertBundle,
  validateBundle,
} from "@/lib/bundles";
import { getOverrides, writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

const bad = (error: string, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: NO_STORE });

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.text();
    if (raw.length > 32_000) return null;
    const body = JSON.parse(raw || "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, bundles: await listBundles() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/bundles] read failed:", err);
    return bad("db_unavailable", 503);
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await readBody(req);
  if (!body) return bad("bad_body");

  /* The owner's own price overrides decide what the parts cost today, so the
     «дешевле по отдельности» rule is checked against the shop's real prices
     and not against the catalogue's printed ones. */
  let overrides = {};
  try {
    overrides = await getOverrides();
  } catch (err) {
    console.error("[api/admin/bundles] overrides unavailable:", err);
    return bad("db_unavailable", 503);
  }

  const check = validateBundle(body, overrides);
  if (!check.ok) return bad(check.error);

  try {
    const bundle = await upsertBundle(check.value);
    await writeAuditSafe("admin", "bundle.set", {
      id: bundle.id,
      items: bundle.items.length,
      price: bundle.price,
      active: bundle.active,
    });
    return Response.json({ ok: true, bundle }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/bundles] write failed:", err);
    return bad("db_unavailable", 503);
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await readBody(req);
  if (!body) return bad("bad_body");

  try {
    // the sort arrows send the whole order they want, not a delta
    if (Array.isArray(body.order)) {
      if (body.order.length > 200) return bad("bad_body");
      if (body.order.some((x) => typeof x !== "string")) return bad("bad_body");
      const bundles = await reorderBundles(body.order as string[]);
      await writeAuditSafe("admin", "bundle.reorder", { order: body.order });
      return Response.json({ ok: true, bundles }, { headers: NO_STORE });
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return bad("bad_id");
    if (typeof body.active !== "boolean") return bad("bad_active");
    const bundle = await setBundleActive(id, body.active);
    if (!bundle) return bad("not_found", 404);
    await writeAuditSafe("admin", "bundle.active", { id: bundle.id, active: bundle.active });
    return Response.json({ ok: true, bundle }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/bundles] patch failed:", err);
    return bad("db_unavailable", 503);
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return bad("bad_id");

  try {
    const bundle = await deleteBundle(id);
    if (!bundle) return bad("not_found", 404);
    await writeAuditSafe("admin", "bundle.delete", { id: bundle.id });
    return Response.json({ ok: true, bundle }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/bundles] delete failed:", err);
    return bad("db_unavailable", 503);
  }
}
