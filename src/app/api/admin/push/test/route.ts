/**
 * POST /api/admin/push/test/ → { ok, configured, devices, sent, failed, gone }
 *
 * «Проверить» beside the switch. It sends the same kind of message a paid
 * order sends, through the same sendPush(), to every device that is on — so
 * what it proves is the whole chain: the keys, the row, the push service, the
 * worker and the phone's own notification settings.
 *
 * Every device, not just the one that tapped. Renat has three and the
 * interesting failure is the one where two work: a test that only ever asked
 * the phone in his hand could never show him that the Mac has gone quiet.
 *
 * The counts are the answer, and `sent` is the only one that means «a push
 * service took it». It still does not mean he SAW it — a phone on silent, a
 * Focus mode or notifications switched off for the Home Screen app all accept
 * the push and show nothing, and no server can tell. That is the sentence the
 * panel should put under the button.
 *
 * NB trailing slash: next.config has trailingSlash:true — POST to
 * "/api/admin/push/test/" or the request 308s.
 */
import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* Even the owner should not be able to turn his own phone into a nuisance —
     the same guard, and the same numbers, as «Отправить тестовое письмо»
     (src/app/api/admin/mail/test/route.ts). */
  if (rateLimit("push-test", clientIp(req), 20, 3_600_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const res = await sendPush({
    title: "REMPIRE — проверка",
    body: "Уведомления работают. Так будет выглядеть сообщение о новом заказе.",
    url: "/shop2/admin/",
    /* A fixed tag on purpose: tapping «Проверить» four times leaves one line
       in the shade, not four. Orders carry their own number instead. */
    tag: "rempire-test",
  });

  if (!res.configured) {
    /* Not something the owner can fix from the panel — say so plainly, the way
       the mail test says `no_api_key` (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY,
       src/lib/push.ts). */
    return Response.json({ ...res, ok: false, error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (!res.devices) {
    return Response.json({ ...res, ok: false, error: "no_devices" }, { status: 409, headers: NO_STORE });
  }
  return Response.json(res, { headers: NO_STORE });
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
