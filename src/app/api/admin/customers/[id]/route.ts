/**
 * GET   /api/admin/customers/<id> — one customer's card: profile, orders
 *       count/revenue, points balance, notes, and the last 50 ledger lines —
 *       plus, since 10.09.2026 (Dim: «the card says two orders and shows
 *       none»), what is behind the numbers:
 *         orders   the last 20 orders under this e-mail, every status
 *                  (id, number, createdAt, total, status, itemsCount,
 *                  firstItem, and channel/labeled/invoice for the chip)
 *         stats    firstOrderAt, lastOrderAt, avgOrder, topBrands[≤3]
 *                  over every purchase (cancelled and failed left out)
 *         reviews  this person's reviews — id, productId, product,
 *                  rating, text, status, createdAt, name. The reviews
 *                  table has no e-mail column, so they are matched by
 *                  name: the account's and the ones on their orders
 *                  (reviewsByAuthor in src/lib/reviews.ts).
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
 *
 * A tier that flips retail → pro here — «Одобрить» or `{tier:"pro"}` from the
 * card's switch — sends the «Цены для салонов включены» letter, the same one
 * «+ Партнёр» sends (src/lib/partner-mail.ts); the answer carries `mail`.
 * Demotions and repeats send nothing.
 */
import { isEmail, productsForAlerts } from "@/lib/customers";
import { requireAdmin } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import { sendPartnerWelcome } from "@/lib/partner-mail";
import { reviewsByAuthor } from "@/lib/reviews";
import {
  adjustLoyaltyPoints,
  approveProCustomer,
  customerOrdersAdmin,
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
    const [history, bought] = await Promise.all([getLoyaltyHistory(customer.id, 50), customerOrdersAdmin(customer.email)]);
    /* The reviews signed with any name this person is known by, each with
       its product named the way the panel names one («Brand — title»); a
       product the catalogue no longer has keeps its id and the panel shows
       that. */
    const found = await reviewsByAuthor([customer.name, ...bought.names]);
    const products = await productsForAlerts(found.map((r) => r.productId));
    const reviews = found.map((r) => {
      const p = products.get(r.productId);
      return {
        id: r.id,
        productId: r.productId,
        product: p ? `${p.brand} — ${p.name}` : "",
        rating: r.rating,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt,
        name: r.name,
      };
    });
    return Response.json(
      { ok: true, customer, history, orders: bought.orders, stats: bought.stats, reviews },
      { headers: { "cache-control": "no-store" } },
    );
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
    const tierBefore = customer.tier;

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

    /* The welcome letter, once, on the flip itself: approve and the switch
       both land here, a card that was pro already sends nothing. Best effort
       — the tier is already written; a mail failure is reported, not raised. */
    let mail: { sent: boolean; skipped?: boolean; reason?: string } | undefined;
    if (tierBefore !== "pro" && customer.tier === "pro" && (action === "approve" || tier === "pro")) {
      const res = await sendPartnerWelcome({
        email: customer.email,
        name: customer.name,
        lang: customer.lang,
        company: customer.company,
      });
      mail = { sent: res.ok, skipped: res.skipped, reason: res.reason };
    }

    return Response.json({ ok: true, customer, ...(mail ? { mail } : {}) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/customers/:id] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
