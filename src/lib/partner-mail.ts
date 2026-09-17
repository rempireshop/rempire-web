/**
 * The one sender of «Цены для салонов включены» (src/emails/partner-welcome.ts).
 *
 * Called whenever an admin action flips a customer into the pro tier:
 *   · POST  /api/admin/customers/          — «+ Партнёр», add by e-mail
 *   · PATCH /api/admin/customers/[id]/     — «Одобрить Pro» and the tier
 *                                            switch on the customer card
 *
 * A demotion sends nothing, and a customer who was already pro gets no second
 * letter — the routes check the previous tier before calling this. Same
 * best-effort contract as the order hooks: never throws, a mail failure is
 * reported in the return value and the tier change stands regardless.
 *
 * The idempotency key is the address plus the day, so an owner who flips a
 * card retail → pro → retail → pro within an afternoon (or the panel's undo
 * doing it for him) produces one letter at Resend, not three. The day is the
 * shop's own — Tallinn, see below.
 */

import { renderPartnerWelcome } from "@/emails/partner-welcome";
import { normalizeLang } from "@/emails/layout";
/* The shop's calendar day, never UTC and never the machine clock
   (src/lib/day.ts) — the same rule the gift card's «Действует до …» is cut on
   (src/lib/giftcards.ts), and the one pointsRef() in the customer card's route
   was written for: a day boundary in the wrong zone is a double send that only
   ever happens in the evening. */
import { shopDay } from "@/lib/day";
import { sendRendered, type SendMailResult } from "@/lib/mail";
import { loadBrand } from "@/lib/mail-hooks";
import { getPricingSettings } from "@/lib/loyalty";

export interface PartnerLike {
  email: string;
  name?: string | null;
  lang?: string | null;
  company?: string | null;
}

export interface PartnerMailResult {
  ok: boolean;
  /** Nothing went out on purpose — no address, or no RESEND_API_KEY on this deployment. */
  skipped?: boolean;
  reason?: string;
  id?: string;
}

/**
 * The address plus the shop's calendar day — one welcome per address per day.
 *
 * Tallinn, not UTC: UTC midnight falls at 02:00 or 03:00 on the Estonian
 * clock, so an owner tapping either side of it is inside one Estonian night
 * and would get two keys — and a second letter — out of a `toISOString()`
 * stamp. The other half is just as wrong: 23:00 and 00:30 local are two
 * Estonian days that UTC calls one, and a welcome that is genuinely due the
 * next day would be suppressed.
 */
function idemKey(to: string): string {
  return `partner:${to}:${shopDay(new Date())}`;
}

export async function sendPartnerWelcome(partner: PartnerLike): Promise<PartnerMailResult> {
  try {
    const to = String(partner.email ?? "").trim().toLowerCase();
    if (!to) return { ok: true, skipped: true, reason: "no_customer_email" };

    // the footer details and the owner's own subject/intro/signature
    await loadBrand();
    const pricing = await getPricingSettings();
    const lang = normalizeLang(partner.lang);
    const mail = renderPartnerWelcome(
      { email: to, customer_name: partner.name ?? "", lang },
      lang,
      { percent: pricing.proDiscountPct, company: partner.company ?? "" },
    );
    const res: SendMailResult = await sendRendered(to, mail, {
      tags: { template: "partner-welcome" },
      idempotencyKey: idemKey(to),
    });
    return { ok: res.ok, skipped: res.skipped, reason: res.error, id: res.id };
  } catch (err) {
    console.error("[partner-mail] sendPartnerWelcome failed", err);
    return { ok: false, reason: "exception" };
  }
}
