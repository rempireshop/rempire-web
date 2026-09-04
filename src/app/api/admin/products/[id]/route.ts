/**
 * GET    /api/admin/products/<id> — one custom product, hidden or not
 * PUT    /api/admin/products/<id> — a PATCH of its own fields
 *          { brand?, name?, cat?, subcat?, price? | sizes?+prices?, description?, gallery?, seo?, active? }
 * DELETE /api/admin/products/<id> — «снять с продажи»: active=false, the row stays
 *
 * `active: true` on PUT is the undo of DELETE — the journal's «Отменить»
 * sends exactly that. Nothing here touches product_overrides: a price or
 * stock override on a custom id is written and cleared through
 * PUT /api/admin/overrides like on any other product.
 */
import { requireAdmin } from "@/lib/auth";
import {
  CustomProductError,
  getCustomProduct,
  isCustomId,
  setCustomProductActive,
  toCatalogueProduct,
  updateCustomProduct,
} from "@/lib/custom-products";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const NO_STORE = { "cache-control": "no-store" } as const;

function notFound() {
  return Response.json({ ok: false, error: "not_found" }, { status: 404 });
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isCustomId(id)) return notFound();
  try {
    const row = await getCustomProduct(id);
    if (!row) return notFound();
    return Response.json({ ok: true, product: toCatalogueProduct(row) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/products/:id] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isCustomId(id)) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const patch = body as Record<string, unknown>;
  const { active, ...fields } = patch;

  try {
    let row = Object.keys(fields).length ? await updateCustomProduct(id, fields) : await getCustomProduct(id);
    if (!row) return notFound();
    if (typeof active === "boolean" && active !== row.active) {
      row = (await setCustomProductActive(id, active)) ?? row;
      await writeAuditSafe("admin", active ? "product.show" : "product.hide", { id });
    }
    if (Object.keys(fields).length) await writeAuditSafe("admin", "product.update", { id, keys: Object.keys(fields) });
    return Response.json({ ok: true, product: toCatalogueProduct(row) }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof CustomProductError) {
      return Response.json({ ok: false, error: err.code, field: err.field }, { status: 400 });
    }
    console.error("[api/admin/products/:id] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isCustomId(id)) return notFound();
  try {
    const row = await setCustomProductActive(id, false);
    if (!row) return notFound();
    await writeAuditSafe("admin", "product.hide", { id });
    return Response.json({ ok: true, product: toCatalogueProduct(row) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/products/:id] hide failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
