import { clientIp, rateLimit } from "@/lib/auth";
import { demoValues, renderDemo, isTemplateId, TEMPLATE_IDS } from "@/emails";
import { normalizeLang } from "@/emails/layout";
import {
  MAIL_PLACEHOLDERS,
  MAIL_TEXT_DEFAULTS,
  MAIL_TEXT_LIMITS,
  MAIL_TEXT_TEMPLATES,
  mailTextsOverride,
} from "@/emails/texts";
import { loadMailTexts } from "@/lib/mail-texts";
/* «Скидка ко дню рождения» and «Письмо со скидкой» — the percents the shop
   really sends. The preview used to print a hard-coded 15 while the letter
   offered whatever this box said (10 out of the box), so the owner read a
   discount he was not giving. */
import { getFlows } from "@/lib/flows";

/**
 * GET /api/admin/mail/preview/?template=order-confirmed&lang=RU
 *
 * The HTML the admin's «Письма» card loads into its iframe. Demo data only —
 * no order, customer or address ever reaches this route, which is why it is
 * not behind requireAdmin: the admin panel Renat opens has no login in front
 * of it yet, and a 401 in the iframe would just look broken. Add
 * `&format=text` for the plain-text alternative, `&format=json` for both plus
 * the subject line.
 *
 * `&format=texts` is the editor's own feed: the built-in default subject /
 * intro / signature for every letter and language, the placeholder list, the
 * length caps, and whatever the owner has already saved
 * (`settings.mail_texts`). Not admin-gated either, and for the same reason —
 * every string in it is already visible in the letter this same route renders
 * to anyone who asks.
 *
 * The letters are rendered *through the owner's texts* (loadMailTexts() below,
 * the same call the real senders make), so this preview is not an
 * approximation of the letter — it is the letter.
 *
 * NB trailing slash: next.config has trailingSlash:true, so link to
 * "/api/admin/mail/preview/?…" — without it the request 308s first.
 */

export const dynamic = "force-dynamic";

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  if (rateLimit("mail-preview", clientIp(req), 120, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const url = new URL(req.url);
  const template = url.searchParams.get("template") ?? TEMPLATE_IDS[0];
  const lang = normalizeLang(url.searchParams.get("lang"));
  const format = (url.searchParams.get("format") ?? "html").toLowerCase();

  // The owner's own subject / intro / signature — before anything is rendered
  // and before the texts feed is answered, so both show the same thing.
  await loadMailTexts();
  /* Both live percents, for the same reason: a preview that prints a number
     the shop is not giving is worse than no preview. */
  const flows = await getFlows();
  const demo = {
    birthdayPercent: flows.birthdayPercent,
    cartDiscountPercent: flows.abandonedDiscountPercent,
  };

  if (format === "texts") {
    return Response.json(
      {
        ok: true,
        templates: MAIL_TEXT_TEMPLATES,
        placeholders: MAIL_PLACEHOLDERS,
        limits: MAIL_TEXT_LIMITS,
        defaults: MAIL_TEXT_DEFAULTS,
        texts: mailTextsOverride(),
        /* What the tokens become in the sample letter this same route renders
           — so the panel's live preview shows the name, the number and the sum
           the iframe beside it shows (Renat, 13.09.2026: «Name also in preview
           is "Mart" in e-mail it's "Renat"»). Keyed by template; the demo data
           is the same in all three languages. */
        samples: Object.fromEntries(TEMPLATE_IDS.map((id) => [id, demoValues(id, lang, demo)])),
      },
      { headers: { "cache-control": "no-store", "X-Robots-Tag": "noindex, nofollow" } },
    );
  }

  if (!isTemplateId(template)) {
    return Response.json(
      { ok: false, error: "unknown_template", templates: TEMPLATE_IDS },
      { status: 400 },
    );
  }

  let mail;
  try {
    mail = renderDemo(template, lang, demo);
  } catch (err) {
    console.error("[mail-preview] render failed", template, lang, err);
    return Response.json({ ok: false, error: "render_failed" }, { status: 500 });
  }

  if (format === "json") {
    return Response.json({ ok: true, template, lang, ...mail });
  }

  if (format === "text") {
    return new Response(mail.text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return html(mail.html);
}
