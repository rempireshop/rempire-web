/**
 * POST /api/account/login — trade a code for a session.
 *
 * Body `{email, code, lang?}` → sets `rmp_cust` for 90 days and answers with
 * the profile. Wrong codes cost an attempt; five of them and the code is gone
 * (src/lib/customers.ts).
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { signInCustomer } from "@/lib/customer-signin";
import {
  checkLoginCode,
  isEmail,
  listCustomerOrders,
  normalizeEmail,
  normalizeLangCode,
  type CustomerOrder,
  type LoginCheck,
} from "@/lib/customers";
import { accountLoyaltySummary, type AccountLoyalty } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000;

const STATUS: Record<string, number> = {
  no_code: 400,
  expired: 400,
  too_many: 429,
  bad_code: 400,
};

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("account-login", ip, 20, 15 * 60 * 1000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400 });
  }

  let verdict: LoginCheck;
  try {
    verdict = await checkLoginCode(email, String(body.code ?? ""));
  } catch (err) {
    console.error("[api/account/login] code check failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (verdict !== "ok") {
    return Response.json({ ok: false, error: verdict }, { status: STATUS[verdict] ?? 400 });
  }

  /* The code is SPENT the moment the verdict is "ok" — checkLoginCode() deletes
     the row (src/lib/customers.ts). Nothing after this line may turn a correct
     code into a refusal: the shopper cannot type it again, a fresh one costs
     one of three per fifteen minutes, and what he would read in the meantime is
     «Код не найден». The profile, the orders and the points used to be awaited
     BEFORE the token was minted, so one slow query answered a correct code with
     a 503 and no cookie, and the code was already gone (audit).
     The session is signed first — makeCustomerToken() is pure crypto and cannot
     fail — and the three reads below are best-effort. That order lives in
     signInCustomer() (src/lib/customer-signin.ts) since 02.11.2026, because
     «Продолжить с Google» signs customers in too and must do it the same way. */
  const { cookie, customer } = await signInCustomer(req, email, body.lang ?? normalizeLangCode(undefined));
  const headers = { "set-cookie": cookie, "cache-control": "no-store" };

  let orders: CustomerOrder[] = [];
  // wholesale/loyalty: acctApply() in app.js applies this response exactly
  // like a GET /api/account/me one, so both must carry the same "loyalty" shape.
  let loyalty: AccountLoyalty | null = null;
  if (customer) {
    try {
      [orders, loyalty] = await Promise.all([listCustomerOrders(email), accountLoyaltySummary(customer.id)]);
    } catch (err) {
      /* Signed in on an empty screen, not signed out on a full one. The next
         GET /api/account/me fills both in — with the cookie that is already
         on its way back. Same fallback profile that route falls back to. */
      console.error("[api/account/login] signed in, profile unavailable:", err);
    }
  }

  return Response.json(
    { ok: true, customer: customer ?? fallbackCustomer(email), orders, loyalty },
    { status: 200, headers },
  );
}

/** What the shopper is until the row can be read — the shape GET /api/account/me uses. */
function fallbackCustomer(email: string) {
  return {
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
  };
}
