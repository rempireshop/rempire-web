import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { renderDemo, isTemplateId, TEMPLATE_IDS } from "@/emails";
import { normalizeLang } from "@/emails/layout";
import { mailConfigured, sendMail } from "@/lib/mail";
import { loadMailTexts } from "@/lib/mail-texts";
import { mailTextsOverride, setMailTextsOverride, type MailTexts } from "@/emails/texts";
import { getFlows } from "@/lib/flows";

/**
 * POST /api/admin/mail/test/  { template, to, lang, texts? }
 *
 * `texts` — { subject?, intro?, signature? }: the letter's own three strings
 * in this language as the editor has them on screen, saved or not. The
 * editor's «Отправить мне тест» sends them (map of the panel, 23.09.2026,
 * #14 — it used to mail the SAVED text while the screen showed the draft);
 * «Прислать пример» on a row sends none and gets what is saved. An empty
 * object means «the standard text», exactly as a save of it would.
 *
 * Sends one sample letter, filled with the same demo data the preview shows,
 * to whatever address the admin typed. Subject carries a [test] prefix so a
 * sample «Заказ принят» in a real inbox is never mistaken for a real order.
 *
 * Two buttons reach it: «Отправить мне тест» in a letter's editor, and
 * «Прислать пример» on the letter's own row in «Маркетинг → Письма» (23.09.2026
 * — the automatic letters go out once a day, and on a test day there was no
 * other way to see one). Both send the DEMO letter and nothing else: no cart
 * is stamped, no promo code is written, no «Последний запуск» moves. The code
 * a sample prints (REM-CART-2417, REM-BDAY-2417) is not a shape the shop's own
 * generators produce, so it cannot be spent — tests/mail-flow-samples.test.ts.
 *
 * NB trailing slash: next.config has trailingSlash:true — POST to
 * "/api/admin/mail/test/" or the request 308s and the body is dropped.
 */

export const dynamic = "force-dynamic";

/* Room for the three strings of one letter (1 500 + 300 + 200 characters,
   newlines and quotes escaped in JSON) beside the address. */
const MAX_BYTES = 8_000;
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

  let body: { template?: unknown; to?: unknown; lang?: unknown; texts?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
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

  // The owner's own subject / intro / signature — the sample has to be the
  // letter, not the factory default (src/lib/mail-texts.ts).
  await loadMailTexts();
  /* …and both percents the shop really offers, exactly as the preview iframe
     beside this button reads them (src/app/api/admin/mail/preview). Until
     23.09.2026 only the birthday one was passed, so the sample of «Брошенная
     корзина — письмо со скидкой» promised the factory 5 % whatever the owner
     had typed into «Размер скидки». Since that date this route is also the
     one behind «Прислать пример» on every letter's row. */
  const flows = await getFlows();
  const demo = {
    birthdayPercent: flows.birthdayPercent,
    cartDiscountPercent: flows.abandonedDiscountPercent,
  };

  /* The editor's draft of this letter, if it sent one: laid over the saved
     texts for this one render, cleaned exactly as a save would clean it
     (setMailTextsOverride → cleanMailTexts). The override is one process
     global, but renderDemo() is synchronous, so the saved texts are back in
     place before this request yields — no other letter can be rendered with
     the draft in between. */
  const draft = body.texts;
  const useDraft = !!draft && typeof draft === "object" && !Array.isArray(draft);
  const saved = mailTextsOverride();
  let mail;
  try {
    if (useDraft) {
      const next = { ...saved } as Record<string, unknown>;
      next[template] = { ...((saved as Record<string, Record<string, unknown>>)[template] ?? {}), [lang]: draft };
      setMailTextsOverride(next as MailTexts);
    }
    mail = renderDemo(template, lang, demo);
  } catch (err) {
    console.error("[mail-test] render failed", template, lang, err);
    return Response.json({ ok: false, error: "render_failed" }, { status: 500 });
  } finally {
    if (useDraft) setMailTextsOverride(saved);
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
