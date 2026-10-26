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
  ownPrev,
  setCustomProductActive,
  toCatalogueProduct,
  updateCustomProduct,
} from "@/lib/custom-products";
import { productUrls } from "@/lib/indexnow.mjs";
import { submitIndexNow } from "@/lib/indexnow-ping";
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
  const { active, undoOf: undoRaw, ...fields } = patch;
  // «Вернуть» on audit row N from the journal: that row reads «возвращено» everywhere
  const undoOf = Number.isInteger(undoRaw) && (undoRaw as number) > 0 ? (undoRaw as number) : 0;

  try {
    /* What this patch is about to replace — the audit's `prev`, so «Вернуть»
       in the journal puts the owner's own product back from any device, as
       it does a catalogue product's (src/lib/audit-undo.ts). Best effort: a
       read that fails costs the row its way back, never the save. */
    let before: { before: Record<string, unknown> } | undefined;
    if (Object.keys(fields).length) {
      try {
        const cur = await getCustomProduct(id);
        if (cur) before = { before: ownPrev(cur, fields) };
      } catch {
        before = undefined;
      }
    }
    let row = Object.keys(fields).length ? await updateCustomProduct(id, fields) : await getCustomProduct(id);
    if (!row) return notFound();
    if (typeof active === "boolean" && active !== row.active) {
      row = (await setCustomProductActive(id, active)) ?? row;
      await writeAuditSafe("admin", active ? "product.show" : "product.hide", { id });
    }
    if (Object.keys(fields).length) {
      const keys = Object.keys(fields);
      await writeAuditSafe("admin", "product.update", undoOf ? { id, keys, undoOf } : { id, keys }, before);
    }
    // its page changed, appeared or went (live shop only, fire-and-forget)
    if (Object.keys(fields).length || typeof active === "boolean") submitIndexNow(productUrls(id));
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
    // its page now answers 404 — the engines hear that too
    submitIndexNow(productUrls(id));
    return Response.json({ ok: true, product: toCatalogueProduct(row) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/products/:id] hide failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
