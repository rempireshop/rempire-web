/**
 * POST /api/admin/login  {password} → sets the rmp_admin cookie for 30 days.
 *
 * The password is compared against the scrypt digest in ADMIN_PASSWORD_HASH,
 * and a wrong password never says which half was wrong.
 *
 * WHAT SLOWS A GUESSER DOWN. Consecutive wrong passwords make the NEXT attempt
 * wait, and the wait doubles — nothing for the first two, then half a second,
 * a second, two, up to a twenty-second ceiling, forgotten again after an hour
 * of quiet. The ladder is keyed on the account, not on the caller's address.
 * The rules, the numbers and an honest account of what this does and does not
 * guarantee all live in one place: the «failed-login backoff» section of
 * src/lib/auth.ts. Do not restate them here — the previous version of this
 * docstring stated a five-tries-a-minute limit as enforced fact, and it had
 * not been true since the day it was written.
 *
 * There is deliberately no 429 on this route any more. It used to come from
 * rateLimit(), the per-IP Map that resets on every cold start, and the panel
 * turns a 429 into «Слишком много попыток — подождите минуту.» (admLogin() in
 * public/shop2/app.js) — a promise about a minute that nothing kept. A wrong
 * password is now simply a slow 401.
 *
 * `maxDuration` must stay above LOGIN_DELAY_MAX_MS: the wait happens inside
 * the request, so a budget under the ceiling would turn the longest delays
 * into killed functions and 500s instead of throttling.
 */
import {
  ADMIN_ACCOUNT,
  adminCookie,
  clearLoginFailures,
  clientIp,
  noteLoginFailure,
  pendingLoginDelayMs,
  sessionSecretOk,
  sleepForLogin,
  verifyPassword,
} from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const ip = clientIp(req);

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  if (!process.env.ADMIN_PASSWORD_HASH) {
    console.error("[api/admin/login] ADMIN_PASSWORD_HASH is not set — nobody can sign in.");
    return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  }
  /* sessionSecretOk(), not `process.env.SESSION_SECRET` — the same sixteen-character
     rule makeSessionToken() signs by. A shorter one used to pass this gate and
     throw two lines below, AFTER the password had been verified: a 500 with no
     `error` field, read by the login card as «Сервер не отвечает» (audit). */
  if (!sessionSecretOk()) {
    console.error("[api/admin/login] SESSION_SECRET is missing or under 16 characters — no session can be signed.");
    return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  /* The wait comes BEFORE the password is looked at, not after it is refused.
     Answering first and sleeping afterwards would hand the guesser the result
     at full speed and charge them nothing they could not hang up on; this way
     the answer itself is what is late. A correct password is never refused for
     being early — it waits its turn and then opens the door. */
  await sleepForLogin(pendingLoginDelayMs(ADMIN_ACCOUNT));

  if (!verifyPassword(password)) {
    noteLoginFailure(ADMIN_ACCOUNT);
    await writeAuditSafe(`ip:${ip}`, "admin.login.failed");
    return Response.json({ ok: false, error: "bad_password" }, { status: 401 });
  }

  // right password: the ladder goes back to the bottom, so the owner who
  // mistyped twice does not keep paying for it on his next visit
  clearLoginFailures(ADMIN_ACCOUNT);
  await writeAuditSafe(`ip:${ip}`, "admin.login");
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": adminCookie(req), "cache-control": "no-store" } },
  );
}
