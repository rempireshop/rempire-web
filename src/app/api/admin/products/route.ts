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
 *
 * ONE «Сохранить товар», ONE PRODUCT. The POST takes an `Idempotency-Key`
 * (src/lib/idempotency.ts). Without it a lost answer is a second live product
 * in the shop window, and not even an obvious one: uniqueCustomId() politely
 * makes room by naming the twin `c-…-2`, so the catalogue ends up with two
 * cards the owner has to spot and delete by hand.
 *
 * The panel does not send the header yet, and until it does this route behaves
 * exactly as it did — runOnce() runs an unkeyed call straight through. The
 * client half is a later pass.
 */
import { requireAdmin } from "@/lib/auth";
import { createCustomProduct, CustomProductError, listCustomProducts, toCatalogueProduct } from "@/lib/custom-products";
import { fingerprintOf, type IdempotentAnswer, readIdempotencyKey, runOnce } from "@/lib/idempotency";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the key is stored against — see src/lib/idempotency.ts `mismatch`. */
const ROUTE = "POST /api/admin/products";
const NO_STORE = { "cache-control": "no-store" } as const;

/** A product card is a few fields and three descriptions, not a gallery of
    base64. The text is read first so the fingerprint sees the bytes the panel
    actually sent — two objects that differ only in key order hash differently
    once they have been through a parse and a re-serialise. */
const MAX_BYTES = 200_000;

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

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  /* At most once per key. `requireAdmin` and the body checks stay outside it:
     they are answers about THIS request, and there is no product to protect
     from a second one. A DIFFERENT key carrying the very same fields is a
     second product and creates one — the owner really may sell the same
     balm in two entries, and uniqueCustomId() is there for exactly that. */
  const done = await runOnce(
    { key: readIdempotencyKey(req), route: ROUTE, fingerprint: fingerprintOf(raw) },
    async (): Promise<IdempotentAnswer> => {
      try {
        const row = await createCustomProduct(body);
        await writeAuditSafe("admin", "product.create", { id: row.id, brand: row.brand, name: row.name, cat: row.cat });
        return { status: 201, body: { ok: true, product: toCatalogueProduct(row) } };
      } catch (err) {
        /* Caught rather than thrown on, so the key is released (runOnce() lets
           go of anything past 399) and the corrected card goes through on the
           same key instead of meeting the old complaint. */
        if (err instanceof CustomProductError) {
          return { status: 400, body: { ok: false, error: err.code, field: err.field } };
        }
        console.error("[api/admin/products] create failed:", err);
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
    },
  );

  /* The owner's own first tap is still being carried out. Not an error — the
     panel says «подождите», not «не сохранилось». */
  if (done.outcome === "in_flight") {
    return Response.json({ ok: false, error: "in_progress" }, { status: 409, headers: NO_STORE });
  }
  /* This key already carries a different card, or belongs to another route. */
  if (done.outcome === "mismatch") {
    return Response.json({ ok: false, error: "key_reused" }, { status: 409, headers: NO_STORE });
  }
  return Response.json(done.body, { status: done.status, headers: NO_STORE });
}
