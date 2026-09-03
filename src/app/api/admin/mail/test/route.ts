import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { renderDemo, isTemplateId, TEMPLATE_IDS } from "@/emails";
import { normalizeLang } from "@/emails/layout";
import { mailConfigured, sendMail } from "@/lib/mail";

/**
 * POST /api/admin/mail/test/  { template, to, lang }
 *
 * Sends one sample letter, filled with the same demo data the preview shows,
 * to whatever address the admin typed. Subject carries a [test] prefix so a
 * sample «Заказ принят» in a real inbox is never mistaken for a real order.
 *
 * NB trailing slash: next.config has trailingSlash:true — POST to
 * "/api/admin/mail/test/" or the request 308s and the body is dropped.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000;
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  // Even an admin should not be able to turn this into a sending loop.
  if (rateLimit("mail-test", clientIp(req), 20, 3_600_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: { template?: unknown; to?: unknown; lang?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const template = String(body.template ?? TEMPLATE_IDS[0]);
  if (!isTemplateId(template)) {
    return Response.json(
      { ok: false, error: "unknown_template", templates: TEMPLATE_IDS },
      { status: 400 },
    );
  }

  const to = String(body.to ?? "").trim();
  if (!EMAIL_RX.test(to)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400 });
  }

  const lang = normalizeLang(body.lang);

  if (!mailConfigured()) {
    // Not an error the admin can fix from the panel — say so plainly.
    return Response.json(
      { ok: false, skipped: true, error: "no_api_key", template, lang, to },
      { status: 503 },
    );
  }

  let mail;
  try {
    mail = renderDemo(template, lang);
  } catch (err) {
    console.error("[mail-test] render failed", template, lang, err);
    return Response.json({ ok: false, error: "render_failed" }, { status: 500 });
  }

  const res = await sendMail({
    to,
    subject: `[test] ${mail.subject}`,
    html: mail.html,
    text: mail.text,
    tags: { template, lang, mode: "test" },
  });

  return Response.json(
    {
      ok: res.ok,
      skipped: res.skipped,
      id: res.id,
      error: res.error,
      retried: res.retried,
      template,
      lang,
      to,
    },
    { status: res.ok ? 200 : 502 },
  );
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
