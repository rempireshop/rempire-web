import { clientIp, rateLimit } from "@/lib/auth";
import { renderDemo, isTemplateId, TEMPLATE_IDS } from "@/emails";
import { normalizeLang } from "@/emails/layout";

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

  if (!isTemplateId(template)) {
    return Response.json(
      { ok: false, error: "unknown_template", templates: TEMPLATE_IDS },
      { status: 400 },
    );
  }

  let mail;
  try {
    mail = renderDemo(template, lang);
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
