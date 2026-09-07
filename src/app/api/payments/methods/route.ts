import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cleanBankFilter, fetchPaymentMethods, filterBanks } from "@/lib/payments/methods";
import { allow, clientIp } from "@/lib/payments/ratelimit";

/**
 * GET /api/payments/methods/
 *   → { ok: true, banks: [{code, name, country, logoUrl}], allBanks, card, wallets }
 *
 * Which banks Montonio has active for this store, each with its own logo, so
 * the checkout's "Банковская ссылка" step can draw a real bank mark instead
 * of a plain-text button (UX fix 9). `preferredProvider` still travels as the
 * bank's BIC code (public/shop2/app.js, BANK_CODES) whether this route
 * answers or not — logoUrl only changes the picture.
 *
 * `banks` is what the checkout draws: Montonio's list minus the banks the
 * owner switched off in «Настройки → Доставка и оплата» (settings.payment_banks,
 * src/lib/payments/methods.ts). `allBanks` is the same list with nothing taken
 * out — it is what the panel ticks the boxes against, and it carries nothing a
 * shopper could not already see on Montonio's own page.
 *
 * Only answers when Montonio is configured: without keys there is no real
 * list to give, and the checkout already knows how to fall back to its
 * built-in bank names when this comes back anything but 200.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/** settings.payment_banks — one primary-key read, same shape as giftAmountsOnSale(). */
async function allowedBankCodes(): Promise<string[]> {
  try {
    const rows = await query<{ value: unknown }>(
      "select value from settings where key = 'payment_banks'",
      [],
    );
    return cleanBankFilter(rows.length ? rows[0].value : null);
  } catch (err) {
    /* No database, or one that is down: show every bank. A checkout that
       cannot read a *preference* must still be able to take money. */
    console.error("[payments/methods] settings.payment_banks unreadable —", err);
    return [];
  }
}

export async function GET(req: Request) {
  if (!allow(`paymethods:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const data = await fetchPaymentMethods();
  if (!data) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const banks = filterBanks(data.banks, await allowedBankCodes());

  return NextResponse.json(
    { ok: true, banks, allBanks: data.banks, card: data.card, wallets: data.wallets },
    {
      headers: {
        /* Five minutes at the shared cache, not the six hours it used to be.
           The expensive half — Montonio's own answer — is still held for six
           hours in the instance (src/lib/payments/methods.ts), so a short TTL
           here costs a settings read and nothing else. What it buys: the owner
           unticks a bank and sees the checkout change within minutes rather
           than at the end of the afternoon. A day of stale-while-revalidate so
           a slow Montonio never blocks the payment step. */
        "cache-control": "public, s-maxage=300, stale-while-revalidate=86400",
      },
    },
  );
}
