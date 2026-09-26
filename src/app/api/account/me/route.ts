/**
 * GET  /api/account/me — profile + the last 20 orders for the signed-in address.
 * PATCH /api/account/me — name, phone, birthday, marketing consent, language,
 * and «Доставка по умолчанию» (shipPref — src/lib/customers.ts normalizeShipPref).
 *
 * The e-mail is never in the body: it comes out of the signed cookie, so a
 * shopper can only ever read and edit their own row.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { recordMarketingConsent, withdrawMarketingConsent } from "@/lib/consent";
import {
  birthdayProblem,
  getCustomer,
  listCustomerOrders,
  recordLogin,
  sessionEmail,
  updateCustomer,
} from "@/lib/customers";
import { accountLoyaltyByEmail } from "@/lib/loyalty";

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
    /* ONE wait. The caller that feels this is the checkout: a signed-in
       shopper's name, phone and address stay empty on screen until this route
       answers (acctLoad in public/shop2/app.js), so every round trip left on
       the critical path here is a second of empty fields on a phone.

       It was four waits, then two (the points summary was made to stop waiting
       for the orders), and the last one left was the points summary itself:
       the ledger is keyed on the customer's id, so it could not start until
       getCustomer() had answered. accountLoyaltyByEmail() looks that id up in
       a sub-select instead, and listCustomerOrders() does the same for the
       gift cards its orders issued — so all six queries of this route now
       leave at once. Measured by giving every query() a fixed delay and
       reading the order they go out in: six queries in two phases became six
       in one, which on the real Postgres is one network hop a shopper is no
       longer watching an empty form for. */
    const [customer, orders, loyalty] = await Promise.all([
      getCustomer(email),
      listCustomerOrders(email),
      accountLoyaltyByEmail(email),
    ]);
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
  for (const key of ["name", "phone", "birthday", "lang", "shipPref"] as const) {
    if (key in body) patch[key] = body[key];
  }
  /* A birthday that cannot be a birth date is refused with its reason, and
     the row keeps the date it had — it used to be stored as sent (a date in
     the future) or as nothing at all (a date nobody could read). The form
     prints the reason under the box (ACCT_ERRS, public/shop2/app.js). */
  if ("birthday" in body) {
    const problem = birthdayProblem(body.birthday);
    if (problem) return Response.json({ ok: false, error: problem }, { status: 400, headers: NO_STORE });
  }
  /* The consent tick travels with the rest of the form but is not a profile
     field: it goes through src/lib/consent.ts, which stamps when and where
     («account») and clears an earlier «Отписаться» on the way on. Only a
     real change is written — the form re-sends the tick on every save, and
     a save that changed the phone must not re-date the consent. */
  const marketing =
    "marketing" in body ? body.marketing === true || body.marketing === "true" || body.marketing === 1 : null;

  try {
    // A shopper signed in from another device before the row existed (only
    // possible if the row was deleted) still gets a row rather than a 404.
    let customer = await updateCustomer(email, patch);
    if (!customer) {
      await recordLogin(email, patch.lang);
      customer = await updateCustomer(email, patch);
    }
    if (marketing !== null && customer && customer.marketing !== marketing) {
      if (marketing) await recordMarketingConsent(email, customer.lang, "account");
      else await withdrawMarketingConsent(email, "account");
      customer = (await getCustomer(email)) ?? customer;
    }
    return Response.json({ ok: true, customer }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/account/me] patch failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
