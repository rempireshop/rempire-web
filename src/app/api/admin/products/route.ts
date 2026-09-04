/**
 * GET  /api/admin/products — every custom product, hidden ones included
 *                            (the panel's list shows them with «скрыт»)
 * POST /api/admin/products — create one
 *
 *   { "brand": "Proraso", "name": "Beard Balm — бальзам для бороды",
 *     "cat": "beard", "subcat": "ba",
 *     "price": 14.9 }                                   — one price, or
 *     "sizes": ["100 мл", "250 мл"], "prices": [14.9, 24.9]   — one per size
 *     "description": {"RU": "…", "ET": "…", "EN": "…"}, "seo": {…}, "gallery": [ … ]
 *   → 201 { ok, product }   — product in the catalogue's own shape, id `c-…`
 *   → 400 { ok:false, error, field }  — error names the rule, field the box
 *
 * Both behind requireAdmin. The row lands in the public feed
 * (GET /api/overrides, `custom`) on the next boot of the shop; the editor is
 * opened on the answer straight away. See src/lib/custom-products.ts.
 */
import { requireAdmin } from "@/lib/auth";
import { createCustomProduct, CustomProductError, listCustomProducts, toCatalogueProduct } from "@/lib/custom-products";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const rows = await listCustomProducts();
    return Response.json({ ok: true, products: rows.map(toCatalogueProduct) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/products] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  try {
    const row = await createCustomProduct(body);
    await writeAuditSafe("admin", "product.create", { id: row.id, brand: row.brand, name: row.name, cat: row.cat });
    return Response.json({ ok: true, product: toCatalogueProduct(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof CustomProductError) {
      return Response.json({ ok: false, error: err.code, field: err.field }, { status: 400 });
    }
    console.error("[api/admin/products] create failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
