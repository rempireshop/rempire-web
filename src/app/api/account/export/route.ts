/**
 * GET /api/account/export/ — «Скачать мои данные» in «Кабинет» (GDPR art. 15
 * and 20: access and portability; Dim, 28.09.2026).
 *
 * The signed-in customer's own data as one readable JSON file,
 * `rempire-mydata-<Tallinn day>.json` — what src/lib/account-privacy.ts
 * exportCustomerData() collects. The address comes out of the signed
 * `rmp_cust` cookie, exactly as /api/account/me reads it, so nobody can ask
 * for anybody else's file: there is nothing in the request to name one.
 *
 * A plain GET behind a plain link: the browser downloads it (Content-
 * Disposition: attachment) with the cookie it already sends, which SameSite
 * =Lax allows for a same-site link and nothing cross-site can read — the
 * answer is a download, not a page another origin can script. `no-store`,
 * so no shared cache and no back-forward cache ever keeps a copy.
 *
 * A session from before the account was deleted (another device's leftover
 * cookie) is not a customer any more: 401, and the cookie is cleared.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { exportCustomerData, exportFilename, isErasedSession } from "@/lib/account-privacy";
import { clearCustomerCookie, getCustomer, sessionEmail, sessionIssuedAt } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(req: Request) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  /* A file is asked for once, maybe twice. Ten a minute is room for a
     double tap and a retry, and nothing like a loop. */
  if (rateLimit("account-export", clientIp(req), 10, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  try {
    if (!(await getCustomer(email)) && (await isErasedSession(email, sessionIssuedAt(req)))) {
      return Response.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers: { ...NO_STORE, "set-cookie": clearCustomerCookie(req) } },
      );
    }
    const now = new Date();
    const data = await exportCustomerData(email, now);
    const body = JSON.stringify(data, null, 2) + "\n";
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename(now)}"`,
        "x-content-type-options": "nosniff",
        ...NO_STORE,
      },
    });
  } catch (err) {
    console.error("[api/account/export] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
