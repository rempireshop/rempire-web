/**
 * GET  /api/account/me — profile + the last 20 orders for the signed-in address.
 * PATCH /api/account/me — name, phone, birthday, marketing consent, language,
 * and «Доставка по умолчанию» (shipPref — src/lib/customers.ts normalizeShipPref).
 *
 * The e-mail is never in the body: it comes out of the signed cookie, so a
 * shopper can only ever read and edit their own row.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import {
  getCustomer,
  listCustomerOrders,
  recordLogin,
  sessionEmail,
  updateCustomer,
} from "@/lib/customers";
import { accountLoyaltySummary } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000;
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const [customer, orders] = await Promise.all([getCustomer(email), listCustomerOrders(email)]);
    const loyalty = await accountLoyaltySummary(customer?.id ?? null);
    return Response.json(
      {
        ok: true,
        customer: customer ?? {
          email,
          name: "",
          phone: "",
          lang: "RU",
          birthday: null,
          marketing: false,
          shipPref: null,
          tier: "retail",
          company: null,
          regCode: null,
          proRequestedAt: null,
          proApprovedAt: null,
        },
        orders,
        loyalty,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/account/me] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function PATCH(req: Request) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (rateLimit("account-patch", clientIp(req), 30, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  const patch: Record<string, unknown> = {};
  for (const key of ["name", "phone", "birthday", "marketing", "lang", "shipPref"] as const) {
    if (key in body) patch[key] = body[key];
  }

  try {
    // A shopper signed in from another device before the row existed (only
    // possible if the row was deleted) still gets a row rather than a 404.
    let customer = await updateCustomer(email, patch);
    if (!customer) {
      await recordLogin(email, patch.lang);
      customer = await updateCustomer(email, patch);
    }
    return Response.json({ ok: true, customer }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/account/me] patch failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
