import { NextResponse } from "next/server";
import { fetchPaymentMethods } from "@/lib/payments/methods";
import { allow, clientIp } from "@/lib/payments/ratelimit";

/**
 * GET /api/payments/methods/
 *   → { ok: true, banks: [{code, name, country, logoUrl}], card, wallets }
 *
 * Which banks Montonio has active for this store, each with its own logo, so
 * the checkout's "Банковская ссылка" step can draw a real bank mark instead
 * of a plain-text button (UX fix 9). `preferredProvider` still travels as the
 * bank's BIC code (public/shop2/app.js, BANK_CODES) whether this route
 * answers or not — logoUrl only changes the picture.
 *
 * Only answers when Montonio is configured: without keys there is no real
 * list to give, and the checkout already knows how to fall back to its
 * built-in bank names when this comes back anything but 200.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export async function GET(req: Request) {
  if (!allow(`paymethods:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const data = await fetchPaymentMethods();
  if (!data) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  return NextResponse.json(
    { ok: true, banks: data.banks, card: data.card, wallets: data.wallets },
    {
      headers: {
        // 6h at the shared cache, matching the in-memory cache in
        // src/lib/payments/methods.ts; a day of stale-while-revalidate so a
        // slow Montonio response never blocks the payment step
        "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    },
  );
}
