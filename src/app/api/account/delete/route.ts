/**
 * «Удалить аккаунт» in «Кабинет» (GDPR art. 17; Dim, 28.09.2026).
 *
 *   GET  /api/account/delete/ — the dialog's first question: `{ok, open}` —
 *        the numbers of the orders that stop the deletion today (paid and not
 *        yet delivered, or waiting to be paid by invoice), empty when none.
 *   POST /api/account/delete/ — body `{confirm: "<the account's e-mail>"}`.
 *        Deletes the account (src/lib/account-privacy.ts eraseCustomerAccount:
 *        what goes, what stays and why), clears the `rmp_cust` cookie and
 *        writes one row in the owner's journal. `409 open_orders` with the
 *        numbers while an order is still being performed.
 *
 * Who: the signed `rmp_cust` cookie, like every account route — the address
 * is never taken from the body. The typed confirmation must be that same
 * address (checked here as well as in the dialog), so a stray request with a
 * live cookie and no deliberate act behind it deletes nothing.
 *
 * Cross-site: what protects every account route protects this one — the
 * cookie is SameSite=Lax, so a POST from another site arrives without it and
 * answers 401 — and, because this one cannot be undone, the Origin a browser
 * sends with every POST must also be this site's own (the check the
 * assistant route makes, src/app/api/assistant/route.ts).
 *
 * Idempotent: a second POST from the same session after a deletion that
 * happened — a double tap, a retry after a dropped answer — answers
 * `{ok:true, already:true}` and clears the cookie again; it deletes nothing
 * and writes no second journal row. A session from before the deletion on
 * another device gets the same answer, and 401 from GET.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import {
  eraseCustomerAccount,
  erasureAuditPayload,
  isErasedSession,
  openOrdersBlockingErasure,
} from "@/lib/account-privacy";
import { clearCustomerCookie, getCustomer, normalizeEmail, sessionEmail, sessionIssuedAt } from "@/lib/customers";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000;
const NO_STORE = { "cache-control": "no-store" } as const;

/** Same-origin, when the browser says where the request came from at all. */
function foreignOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const from = new URL(origin).host;
    const self = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    return from !== self;
  } catch {
    return true;
  }
}

function signedOut(req: Request, status = 401) {
  return Response.json(
    { ok: false, error: "unauthorized" },
    { status, headers: { ...NO_STORE, "set-cookie": clearCustomerCookie(req) } },
  );
}

export async function GET(req: Request) {
  const email = sessionEmail(req);
  if (!email) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (rateLimit("account-delete-check", clientIp(req), 30, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  try {
    if (!(await getCustomer(email)) && (await isErasedSession(email, sessionIssuedAt(req)))) return signedOut(req);
    const open = await openOrdersBlockingErasure(email);
    return Response.json({ ok: true, open }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/account/delete] check failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  const email = sessionEmail(req);
  if (!email) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (foreignOrigin(req)) return Response.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  if (rateLimit("account-delete", clientIp(req), 5, 60_000)) {
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
  if (normalizeEmail(body.confirm) !== email) {
    return Response.json({ ok: false, error: "confirm_mismatch" }, { status: 400, headers: NO_STORE });
  }

  try {
    const out = await eraseCustomerAccount(email, { sessionIssuedAt: sessionIssuedAt(req) });
    if (!out.ok) {
      return Response.json({ ok: false, error: out.error, orders: out.orders }, { status: 409, headers: NO_STORE });
    }
    const headers = { ...NO_STORE, "set-cookie": clearCustomerCookie(req) };
    if (out.already) return Response.json({ ok: true, already: true }, { headers });
    /* After the commit, never inside it: a journal that could not be written
       must not undo a deletion the customer has been told about. No address
       in it — the actor is the word «customer», the line names the orders. */
    await writeAuditSafe("customer", "customer.account_deleted", erasureAuditPayload(out));
    return Response.json({ ok: true }, { headers });
  } catch (err) {
    console.error("[api/account/delete] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
