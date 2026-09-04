/**
 * GET /api/e2e/mail/?template=order-confirmed&to=… — TEST-ONLY readout of the
 * letters this server was asked to send.
 *
 * Why it exists: the e2e suite runs with `RESEND_API_KEY` empty, so every send
 * is "skipped, logged" and there is no mailbox anywhere (docs/mail.md,
 * docs/testing.md). `e2e/admin-mail.spec.ts` has to prove that the subject the
 * owner typed in «Письма» is the subject a real paid order's confirmation
 * carries — not merely that the admin preview changed. Nothing else in the app
 * can answer that: no `mail_log` table exists (deliberately, docs/mail.md) and
 * the receipt screen never shows a subject line.
 *
 * The sink itself is in src/lib/mail.ts and records only the recipient, the
 * subject and the template tag — never a body.
 *
 * Double-gated like /api/e2e/bootstrap, PLUS the admin cookie (like
 * /api/e2e/gift-card, because it hands back real customers' addresses):
 *   1. NODE_ENV !== "production"
 *   2. E2E_BOOTSTRAP === "1"
 *   3. a valid rmp_admin cookie (src/lib/auth.ts)
 */
import { requireAdmin } from "@/lib/auth";
import { capturedMail } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.E2E_BOOTSTRAP !== "1") {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const template = (params.get("template") ?? "").trim().slice(0, 60);
  const to = (params.get("to") ?? "").trim().toLowerCase().slice(0, 160);

  const mails = capturedMail().filter(
    (m) =>
      (!template || m.template === template) &&
      (!to || m.to.some((addr) => addr.toLowerCase() === to)),
  );

  return Response.json(
    { ok: true, mails },
    { headers: { "cache-control": "no-store" } },
  );
}
