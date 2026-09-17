/**
 * Promo codes, the owner's side. All three verbs are behind requireAdmin.
 *
 * GET    /api/admin/promos/            → { ok, promos }
 * POST   /api/admin/promos/  {code, kind, value, minSubtotal, startsAt,
 *                             endsAt, maxUses, active, note}
 *                                      → { ok, promo }   (create or edit)
 * PATCH  /api/admin/promos/  {code, active}
 *                                      → { ok, promo }   (switch one on/off)
 * DELETE /api/admin/promos/?code=SUVI10
 *                                      → { ok, code }    (a code nobody used)
 *
 * DELETE is narrow on purpose (Renat, 12.09.2026): a code that has already
 * been used is part of the order history, so deletePromo() refuses it with
 * `in_use` and the panel leaves the owner the switch. Everything else is
 * validated by validatePromo() in src/lib/promos.ts — the same door the
 * assistant's create_promo goes through, so a code typed here and a code
 * proposed by the model are held to identical bounds.
 *
 * NB: trailing slash on all of them (next.config has trailingSlash: true).
 */
import { requireAdmin } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import {
  deletePromo, listPromos, normalisePromoCode, setPromoActive, upsertPromo, validatePromo,
} from "@/lib/promos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Codes are not secret, but usage counts and notes are the owner's. */
const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, promos: await listPromos() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/promos] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return null;
    const body = JSON.parse(raw || "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await readBody(req);
  if (!body) return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });

  const check = validatePromo(body);
  if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: 400, headers: NO_STORE });

  try {
    const promo = await upsertPromo(check.value);
    await writeAuditSafe("admin", "promo.set", { code: promo.code, kind: promo.kind, value: promo.value });
    return Response.json({ ok: true, promo }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/promos] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await readBody(req);
  if (!body) return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });

  const code = normalisePromoCode(body.code);
  if (!code) return Response.json({ ok: false, error: "bad_code" }, { status: 400, headers: NO_STORE });
  if (typeof body.active !== "boolean") {
    return Response.json({ ok: false, error: "bad_active" }, { status: 400, headers: NO_STORE });
  }

  try {
    const promo = await setPromoActive(code, body.active);
    if (!promo) return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
    await writeAuditSafe("admin", "promo.active", { code: promo.code, active: promo.active });
    return Response.json({ ok: true, promo }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/promos] patch failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

/**
 * Delete a code nobody has used yet. The code rides in the query string, the
 * way the sets endpoint takes its id — a DELETE with a body is awkward for
 * every client there is, and a promo code is not secret.
 *
 * 409 `in_use` is the interesting answer: it is not a failure, it is the rule
 * (see deletePromo). The panel turns it into one sentence and leaves the
 * switch where it is.
 */
export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const code = normalisePromoCode(new URL(req.url).searchParams.get("code"));
  if (!code) return Response.json({ ok: false, error: "bad_code" }, { status: 400, headers: NO_STORE });

  try {
    const gone = await deletePromo(code);
    if (!gone.ok) {
      /* `on_order` is 409 beside `in_use`: both mean «the code is part of
         somebody's order», and the panel tells them apart by the body so it
         can stop saying «уже использован» about a code nobody has paid with. */
      const status = gone.error === "not_found" ? 404 : gone.error === "bad_code" ? 400 : 409;
      return Response.json({ ok: false, error: gone.error }, { status, headers: NO_STORE });
    }
    await writeAuditSafe("admin", "promo.delete", { code });
    return Response.json({ ok: true, code }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/promos] delete failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
