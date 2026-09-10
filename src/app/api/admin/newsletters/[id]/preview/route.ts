/**
 * GET /api/admin/newsletters/<id>/preview/?lang=RU[&format=html|text|json]
 *
 * The letter as the reader will see it — the HTML the editor's iframe loads,
 * rendered by the same function the send uses (src/emails/newsletter.ts
 * through renderNewsletterFor), so the preview is the letter and not a
 * picture of one. Unlike /api/admin/mail/preview/ this is the owner's own
 * draft, not demo data, so it stays behind requireAdmin — the iframe is
 * same-origin and carries the cookie.
 *
 * A language with nothing in it still renders the frame, so the owner sees
 * what an empty Estonian version would look like; the unsubscribe link is
 * drawn for a sample mailbox.
 */
import { requireAdmin } from "@/lib/auth";
import { normalizeLangCode } from "@/lib/customers";
import { getNewsletter, isNewsletterId, loadNewsletterBrand, renderNewsletterFor } from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!isNewsletterId(id)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const lang = normalizeLangCode(url.searchParams.get("lang"));
  const format = (url.searchParams.get("format") ?? "html").toLowerCase();

  try {
    const n = await getNewsletter(id);
    if (!n) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    await loadNewsletterBrand();
    const mail = await renderNewsletterFor(n, lang, "klient@example.com");
    if (format === "json") return Response.json({ ok: true, lang, ...mail }, { headers: HEADERS });
    if (format === "text") {
      return new Response(mail.text, { headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
    }
    return new Response(mail.html, { headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error("[api/admin/newsletters/preview] failed:", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
