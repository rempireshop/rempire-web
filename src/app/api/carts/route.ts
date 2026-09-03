/**
 * POST /api/carts — the abandoned-cart snapshot.
 *
 * The checkout calls this the moment the e-mail field holds a valid address,
 * and `addToCart` calls it for a signed-in shopper. One row per address: the
 * newest snapshot replaces the previous one.
 *
 * Prices are **not** taken from the body. The browser sends ids, sizes and
 * quantities; src/lib/customers.ts `cartSnapshot` rebuilds names and prices
 * from the catalogue and the owner's overrides, exactly like `createOrder`
 * does — a doctored cart can only produce a wrong-looking reminder letter for
 * its own author, and now it cannot even do that.
 *
 * The address is used as written unless a customer session says otherwise, in
 * which case the session wins: a signed-in shopper cannot file a cart under
 * somebody else's mailbox.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { isEmail, normalizeEmail, saveCart, sessionEmail } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8_000;

export async function POST(req: Request) {
  if (rateLimit("carts", clientIp(req), 30, 60_000)) {
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
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const email = sessionEmail(req) ?? normalizeEmail(body.email);
  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400 });
  }

  try {
    const snap = await saveCart({ email, lang: body.lang, items: body.items });
    return Response.json(
      { ok: true, items: snap?.items.length ?? 0, total: snap?.total ?? 0 },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/carts] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
