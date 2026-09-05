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
 * doing it for him) produces one letter at Resend, not three.
 */

import { renderPartnerWelcome } from "@/emails/partner-welcome";
import { normalizeLang } from "@/emails/layout";
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

function dayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
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
      idempotencyKey: `partner:${to}:${dayStamp()}`,
    });
    return { ok: res.ok, skipped: res.skipped, reason: res.error, id: res.id };
  } catch (err) {
    console.error("[partner-mail] sendPartnerWelcome failed", err);
    return { ok: false, reason: "exception" };
  }
}
