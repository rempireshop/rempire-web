/**
 * POST /api/account/pro-request — «Стать партнёром (салон/мастер)».
 *
 * Body `{company, regCode, phone?}`. Requires the `rmp_cust` cookie — this is
 * a signed-in customer's own account, never something a guest can ask for.
 * Stores the request and stamps `pro_requested_at`; the tier itself only
 * flips once the owner approves it in «Клиенты» (PATCH /api/admin/customers/
 * [id]). Asking again after a rejection is fine — see requestProTier() in
 * src/lib/loyalty.ts.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { sessionEmail } from "@/lib/customers";
import { requestProTier } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000;
const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (rateLimit("pro-request", clientIp(req), 5, 60_000)) {
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
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  try {
    const out = await requestProTier(email, {
      company: body.company,
      regCode: body.regCode ?? body.reg_code,
      phone: body.phone,
    });
    if (!out.ok) {
      return Response.json({ ok: false, error: out.error ?? "bad_request" }, { status: 400, headers: NO_STORE });
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/account/pro-request] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
