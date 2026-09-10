/**
 * POST /api/admin/newsletters/<id>/test/  { to, lang }
 *
 * «Отправить себе тест»: the letter as it is saved right now, in `lang` (or
 * in the nearest language that has a subject and a body), to the address
 * the owner typed — the same idiom as POST /api/admin/mail/test/, with the
 * same [test] prefix on the subject so a sample is never mistaken for the
 * real thing. Twenty an hour per address, like the other test button.
 *
 * Answers: { ok, id, lang, to }, or { ok:false, error } — `no_api_key` (503)
 * when nothing can leave this deployment, `bad_email`, `empty_body`,
 * `no_subject`, `not_found`, `rate_limited`.
 *
 * NB trailing slash: POST to "/api/admin/newsletters/<id>/test/".
 */
import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { normalizeLangCode } from "@/lib/customers";
import {
  getNewsletter,
  isNewsletterId,
  loadNewsletterBrand,
  NewsletterError,
  newsletterMailReady,
  sendNewsletterTest,
} from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 4_000;
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error, ...extra }, { status });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  if (rateLimit("news-test", clientIp(req), 20, 3_600_000)) return bad("rate_limited", 429);

  const { id } = await ctx.params;
  if (!isNewsletterId(id)) return bad("not_found", 404);

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return bad("bad_request");
  }
  if (raw.length > MAX_BYTES) return bad("too_large", 413);
  let body: { to?: unknown; lang?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return bad("bad_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("bad_body");

  const to = String(body.to ?? "").trim();
  if (!EMAIL_RX.test(to)) return bad("bad_email");
  const lang = normalizeLangCode(body.lang);

  if (!newsletterMailReady()) return bad("no_api_key", 503, { skipped: true });

  try {
    const n = await getNewsletter(id);
    if (!n) return bad("not_found", 404);
    await loadNewsletterBrand();
    const { result, lang: sentIn } = await sendNewsletterTest(n, to, lang);
    return Response.json(
      { ok: result.ok, skipped: result.skipped, id: result.id, error: result.error, lang: sentIn, to },
      { status: result.ok ? 200 : 502 },
    );
  } catch (err) {
    if (err instanceof NewsletterError) return bad(err.code, err.code === "not_found" ? 404 : 400);
    console.error("[api/admin/newsletters/test] failed:", err);
    return bad("unavailable", 503);
  }
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
