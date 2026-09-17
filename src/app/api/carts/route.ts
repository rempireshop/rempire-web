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
 *
 * Which leaves the guest, who is the whole point of the letter and proves
 * nothing at all. Dim, 17.09.2026: keep the feature, bound the exposure per
 * ADDRESS rather than per IP. The per-IP limiter below stays — it is what
 * keeps a single client from hammering this route — but it is a Map in one
 * Node process, so a serverless cold start forgets it and a second instance
 * never saw it. The bound that matters is `allowGuestCartWrite`
 * (src/lib/customers.ts): a counter on the address itself, in the database,
 * rolling over on the Tallinn day. A signed-in shopper writing their own
 * mailbox is proven and is not counted.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { allowGuestCartWrite, isEmail, normalizeEmail, saveCart, sessionEmail } from "@/lib/customers";

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

  const session = sessionEmail(req);
  const email = session ?? normalizeEmail(body.email);
  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400 });
  }

  try {
    /* Nobody proved this address is theirs. Count the write against the
       address and refuse once the day's budget is gone — same answer as the
       per-IP limiter above, because from the browser's side it is the same
       thing: this snapshot was not filed, try later. The storefront already
       treats a failed snapshot as a snapshot it will send again on the next
       change, so nothing on screen depends on it. */
    if (!session && !(await allowGuestCartWrite(email))) {
      return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
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
