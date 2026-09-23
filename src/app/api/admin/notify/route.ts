/**
 * GET  /api/admin/notify/ → { ok, email: { key, to } }
 * POST /api/admin/notify/ → { ok, to } | { ok: false, error, status?, detail? }
 *
 * The shop's own «оплачен заказ» letter, as «Ещё → Подключения» sees it.
 *
 * Renat, 23.09.2026: «Phone notification arrived — e-mail to
 * shop@rempireshop.com not.» The letter goes to `RESEND_TO`, which has no
 * default on purpose (src/lib/notify.ts), and an unset variable used to be
 * visible only as a warning in the log of a payment webhook. GET says whether
 * the key is there (never the key) and which address the letter goes to — the
 * panel draws a red line when it is empty, naming the variable and the value.
 *
 * POST is «Проверить»: one real letter through sendOwnerMail(), the same
 * function a paid order uses when no phone took the push. It proves the whole
 * chain — the key, the address, the sender domain at Resend — and a refusal
 * comes back as Resend's own sentence instead of a `false`.
 *
 * Admin only; rate-limited like the other two «Проверить» buttons.
 *
 * NB trailing slash: next.config has trailingSlash:true — POST to
 * "/api/admin/notify/" or the request 308s.
 */
import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { ownerMailConfig, sendOwnerMail } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return Response.json({ ok: true, email: ownerMailConfig() }, { headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* The same guard, and the same numbers, as «Отправить мне тест» and the
     push «Проверить» — even the owner should not be able to loop it. */
  if (rateLimit("notify-test", clientIp(req), 20, 3_600_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const res = await sendOwnerMail(
    "REMPIRE — проверка письма магазину",
    [
      "Это проверка из админки: «Ещё» → «Подключения» → «Проверить».",
      "",
      "Такое письмо приходит на этот адрес, когда заказ оплачен, а оповещение на телефон",
      "не дошло ни до одного устройства. Пока телефон получает оповещения, письма о заказах",
      "сюда не приходят — так задумано.",
      "",
      "Адрес получателя задан в Vercel, в переменной RESEND_TO.",
    ].join("\n"),
  );

  if (res.ok) {
    /* It went through Resend, so it comes off the day's allowance like the
       order ping does (noteOwnerMail, src/lib/mail-hooks.ts). Best effort: a
       counter that cannot be written must not turn a delivered letter into a
       failed test. */
    try {
      const { noteSent } = await import("@/lib/mail-budget");
      await noteSent("transactional");
    } catch (err) {
      console.error("[api/admin/notify] the test letter was not counted:", err);
    }
    return Response.json({ ok: true, to: res.to }, { headers: NO_STORE });
  }
  /* Not something the owner can fix from the panel — the same 503 shape the
     mail test answers with for a missing key; a refusal from Resend is an
     upstream failure and says whose. */
  const status = res.error === "send_failed" ? 502 : 503;
  return Response.json(res, { status, headers: NO_STORE });
}
