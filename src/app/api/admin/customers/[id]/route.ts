/**
 * GET   /api/admin/customers/<id> — one customer's card: profile, orders
 *       count/revenue, points balance, notes, and the last 50 ledger lines.
 * PATCH /api/admin/customers/<id> — any of:
 *   {"action":"approve"}                 «Одобрить» a pending pro request
 *   {"action":"reject"}                  «Отклонить» — clears the request, tier stays retail
 *   {"tier":"retail"|"pro"}              set the tier directly (also how a pro is demoted)
 *   {"notes":"…"|null}                   the admin's own note about this customer
 *   {"pointsDelta":10,"note":"…"}        adjust_points — a manual credit/correction
 *
 * `id` is the customers.id uuid, OR an e-mail address — resolved server-side
 * (integration: the assistant's adjust_points action lets the owner name a
 * customer by e-mail, which a model can plausibly know, unlike a uuid; see
 * docs/loyalty.md and src/app/api/assistant/actions.ts sanitizePointsAdjust).
 * Every write below runs against the resolved row's real uuid, never the raw
 * path segment, so an e-mail id behaves identically to a uuid one throughout.
 */
import { isEmail } from "@/lib/customers";
import { requireAdmin } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import {
  adjustLoyaltyPoints,
  approveProCustomer,
  getCustomerAdmin,
  getCustomerAdminByEmail,
  getLoyaltyHistory,
  rejectProCustomer,
  setCustomerNotes,
  setCustomerTier,
} from "@/lib/loyalty";

/** uuid or e-mail in the URL, resolved to the real admin-shaped row. */
function resolveCustomer(idOrEmail: string) {
  return isEmail(idOrEmail) ? getCustomerAdminByEmail(idOrEmail) : getCustomerAdmin(idOrEmail);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const customer = await resolveCustomer(id);
    if (!customer) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    const history = await getLoyaltyHistory(customer.id, 50);
    return Response.json({ ok: true, customer, history }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/customers/:id] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: {
    action?: unknown;
    tier?: unknown;
    notes?: unknown;
    pointsDelta?: unknown;
    note?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const tier = body.tier === "retail" || body.tier === "pro" ? body.tier : null;
  const hasNotes = "notes" in body;
  const pointsDelta = body.pointsDelta != null ? Math.trunc(Number(body.pointsDelta)) : null;
  /* Checked here, before the approve/tier/notes half of the same body is
     written: adjustPoints() (src/lib/loyalty.ts) refuses the same values, but
     by then the other changes had already been committed and the panel only
     got a bare 400 to show. Same ceiling as the ledger's own. */
  if (body.pointsDelta != null && (!Number.isFinite(pointsDelta as number) || Math.abs(pointsDelta as number) > 1_000_000)) {
    return Response.json({ ok: false, error: "bad_points" }, { status: 400 });
  }
  if (
    action !== "approve" &&
    action !== "reject" &&
    !tier &&
    !hasNotes &&
    !(pointsDelta && Number.isFinite(pointsDelta) && pointsDelta !== 0)
  ) {
    return Response.json({ ok: false, error: "nothing_to_do" }, { status: 400 });
  }

  try {
    let customer = await resolveCustomer(id);
    if (!customer) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    // every write below goes through the resolved real uuid, not the raw
    // path segment — the segment may have been an e-mail address
    const realId = customer.id;

    if (action === "approve") {
      customer = (await approveProCustomer(realId)) ?? customer;
      await writeAuditSafe("admin", "customer.pro_approved", { id: realId, email: customer.email });
    } else if (action === "reject") {
      customer = (await rejectProCustomer(realId)) ?? customer;
      await writeAuditSafe("admin", "customer.pro_rejected", { id: realId, email: customer.email });
    } else if (tier) {
      customer = (await setCustomerTier(realId, tier)) ?? customer;
      await writeAuditSafe("admin", "customer.tier_set", { id: realId, tier });
    }

    if (hasNotes) {
      const notes = typeof body.notes === "string" ? body.notes : null;
      customer = (await setCustomerNotes(realId, notes)) ?? customer;
    }

    if (pointsDelta && Number.isFinite(pointsDelta) && pointsDelta !== 0) {
      const note = typeof body.note === "string" ? body.note : "";
      const out = await adjustLoyaltyPoints(realId, pointsDelta, note);
      if (!out.ok) return Response.json({ ok: false, error: out.error ?? "bad_delta" }, { status: 400 });
      await writeAuditSafe("admin", "customer.points_adjust", { id: realId, delta: pointsDelta, note });
      customer = (await getCustomerAdmin(realId)) ?? customer;
    }

    return Response.json({ ok: true, customer }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/customers/:id] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
