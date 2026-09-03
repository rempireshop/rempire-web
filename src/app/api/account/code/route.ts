/**
 * POST /api/account/code — «Получить код».
 *
 * Body `{email, lang?}`. Always answers `{ok:true}` for a well-formed address,
 * whether or not that address has ever bought anything: telling a stranger
 * which e-mails have accounts is a free customer list.
 *
 * Two limits, both needed. Three per fifteen minutes **per address** stops
 * somebody using the shop to spam one mailbox; three per fifteen minutes per
 * IP stops them walking a list of addresses.
 *
 * ---- e2e test hook -------------------------------------------------------
 * The customer login flow has no password: the only way in is a code mailed
 * to the address, and the e2e suite runs with no RESEND_API_KEY (mail is
 * skipped, see docs/mail.md), so it has no mailbox to read. `codeForE2E()`
 * below is the one deliberate leak: the raw code rides along in this
 * response's body, and ONLY this response — `/api/account/login` still
 * requires the real code, nothing here weakens the hash-and-attempt-limit
 * storage in src/lib/customers.ts.
 *
 * It is double-gated, and both gates must hold:
 *   1. `E2E_EXPOSE_LOGIN_CODE=1` — off by default, on only in the Playwright
 *      webServer env (playwright.config.ts).
 *   2. `NODE_ENV !== "production"` — even if the env var above were ever set
 *      on a real deploy by mistake, a production NODE_ENV still hides the
 *      code. `next start`/`next build` set NODE_ENV=production unless the
 *      environment already names something else, so the e2e webServer runs
 *      with an explicit non-production NODE_ENV (e.g. "test") — see
 *      docs/testing.md for why that is safe and does not weaken the build.
 * tests/account-code-e2e-hook.test.ts asserts the leak cannot happen with
 * either gate missing, including with NODE_ENV="production" specifically.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { CODE_TTL_MS, isEmail, issueLoginCode, normalizeEmail, normalizeLangCode } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000;
const WINDOW_MS = 15 * 60 * 1000;

/** See "e2e test hook" above — the only place this code is allowed to leak. */
function codeForE2E(code: string): { code: string } | Record<string, never> {
  const exposed = process.env.NODE_ENV !== "production" && process.env.E2E_EXPOSE_LOGIN_CODE === "1";
  return exposed ? { code } : {};
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400 });
  }

  if (rateLimit("account-code-ip", ip, 3, WINDOW_MS) || rateLimit("account-code-mail", email, 3, WINDOW_MS)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const lang = normalizeLangCode(body.lang);

  try {
    const { code } = await issueLoginCode(email);
    // The letter must not be able to break the sign-in: a Resend outage means
    // the code exists and the shopper can ask again, not a 500.
    try {
      const [{ renderLoginCode }, { sendRendered }] = await Promise.all([
        import("@/emails/login-code"),
        import("@/lib/mail"),
      ]);
      const mail = renderLoginCode(code, lang.toLowerCase(), { minutes: Math.round(CODE_TTL_MS / 60_000) });
      await sendRendered(email, mail, {
        tags: { template: "login-code", lang: lang.toLowerCase() },
        // No idempotency key: two "send me a code" clicks are two codes, and
        // Resend must not swallow the second letter as a duplicate.
      });
    } catch (err) {
      console.error("[api/account/code] mail failed:", err);
    }
    return Response.json(
      { ok: true, ttl: Math.round(CODE_TTL_MS / 1000), ...codeForE2E(code) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/account/code] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
