/**
 * POST /api/account/logout — clears `rmp_cust`.
 *
 * No auth check on purpose: "forget me" must work even when the cookie is
 * already stale, and the only thing this can do is remove a cookie the caller
 * already had.
 */
import { clearCustomerCookie } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": clearCustomerCookie(req), "cache-control": "no-store" } },
  );
}
