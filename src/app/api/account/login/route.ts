/**
 * POST /api/account/login — trade a code for a session.
 *
 * Body `{email, code, lang?}` → sets `rmp_cust` for 90 days and answers with
 * the profile. Wrong codes cost an attempt; five of them and the code is gone
 * (src/lib/customers.ts).
 */
import { clientIp, rateLimit } from "@/lib/auth";
import {
  checkLoginCode,
  customerCookie,
  isEmail,
  listCustomerOrders,
  makeCustomerToken,
  normalizeEmail,
  normalizeLangCode,
  recordLogin,
} from "@/lib/customers";

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

  try {
    const verdict = await checkLoginCode(email, String(body.code ?? ""));
    if (verdict !== "ok") {
      return Response.json({ ok: false, error: verdict }, { status: STATUS[verdict] ?? 400 });
    }

    const customer = await recordLogin(email, body.lang ?? normalizeLangCode(undefined));
    const orders = await listCustomerOrders(email);
    const token = makeCustomerToken(email);
    return Response.json(
      { ok: true, customer, orders },
      {
        status: 200,
        headers: {
          "set-cookie": customerCookie(req, token),
          "cache-control": "no-store",
        },
      },
    );
  } catch (err) {
    console.error("[api/account/login] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
