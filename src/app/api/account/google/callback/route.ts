/**
 * POST /api/account/google/callback — «Продолжить с Google», step 2.
 *
 * Google's account chooser posts a form here (`response_mode=form_post`):
 * `id_token` + `state` when the shopper picked an account, `error` (e.g.
 * `access_denied`) when they backed out. The answer is always a 303 back to
 * the page the sign-in started from, with `?google=ok` or `?google=cancel` —
 * one word for every failure, because the shopper can do the same thing about
 * all of them (try again, or use the code). The reason goes to the log.
 *
 * What makes it safe, in the order it is checked (src/lib/google-signin.ts):
 *   · the Origin, when the browser sends one, is accounts.google.com — the one
 *     route in the shop that accepts a POST from another site, and only from
 *     that one. There is no shop-wide Origin/CSRF layer to exempt it from:
 *     src/middleware.ts leaves /api/ out by its matcher, and each route that
 *     needs a check makes its own (account/delete, search, assistant);
 *   · the `state` field equals the one in the signed `rmp_gauth` cookie this
 *     browser was given by the start route ten minutes ago at most — a form
 *     posted from anywhere else has no such cookie;
 *   · the ID token is signed by Google (RS256, the published keys), was
 *     issued for this shop's client ID, has not expired, carries the nonce
 *     from the same cookie, and says the address is verified.
 * Then the customer is signed in exactly as a correct code signs them in
 * (signInCustomer, src/lib/customer-signin.ts). One addition only: an account
 * with no name takes the name Google sent, so the checkout's «Имя и фамилия»
 * is filled — the privacy policy says the shop receives it, and the shopper
 * can change it in «Мои данные» like any other field. A name already there is
 * never touched.
 *
 * 404 while GOOGLE_CLIENT_ID is unset, like the start route.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { signInCustomer } from "@/lib/customer-signin";
import { updateCustomer } from "@/lib/customers";
import {
  clearStateCookie,
  DEFAULT_RETURN,
  GOOGLE_ORIGIN,
  googleClientId,
  googleSignInOn,
  langOfReturn,
  pendingOf,
  sameString,
  verifyIdToken,
  withGoogleFlag,
} from "@/lib/google-signin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An ID token is ~1.2 KB; the whole form is a few. Anything far bigger is not Google. */
const MAX_BYTES = 16_000;
const NO_STORE = { "cache-control": "no-store" } as const;

/** The browser's word for who posted this. Absent is allowed (a non-browser client still needs the cookie). */
function fromGoogle(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === null || origin === GOOGLE_ORIGIN;
}

/** 303 to `ret` with the flag, the state cookie cleared — and `extra` cookies, the session among them. */
function back(req: Request, ret: string, flag: "ok" | "cancel", extra: string[] = []): Response {
  const headers = new Headers(NO_STORE);
  headers.set("location", new URL(withGoogleFlag(ret, flag), new URL(req.url).origin).toString());
  headers.append("set-cookie", clearStateCookie());
  for (const c of extra) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

function refused(req: Request, ret: string, why: string): Response {
  // the reason only: never the token, the address or the state
  console.error(`[api/account/google/callback] refused: ${why}`);
  return back(req, ret, "cancel");
}

export async function POST(req: Request) {
  const clientId = googleClientId();
  if (!clientId || !googleSignInOn()) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (!fromGoogle(req)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  if (rateLimit("account-google-callback", clientIp(req), 30, 15 * 60 * 1000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const pending = pendingOf(req);
  const ret = pending?.ret ?? DEFAULT_RETURN;

  let form: URLSearchParams;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return refused(req, ret, "too_large");
    form = new URLSearchParams(raw);
  } catch {
    return refused(req, ret, "bad_body");
  }

  // the shopper closed the chooser or said no — a normal answer, not an error
  const error = form.get("error");
  if (error) {
    console.info(`[api/account/google/callback] cancelled at Google: ${error.slice(0, 40)}`);
    return back(req, ret, "cancel");
  }
  if (!pending) return refused(req, ret, "no_state_cookie");
  if (!sameString(form.get("state"), pending.state)) return refused(req, ret, "state_mismatch");

  const verdict = await verifyIdToken(form.get("id_token"), { clientId, nonce: pending.nonce });
  if (!verdict.ok) return refused(req, ret, verdict.error);
  const { email, name } = verdict.identity;

  const { cookie, customer } = await signInCustomer(req, email, langOfReturn(ret));
  if (customer && !customer.name && name) {
    try {
      await updateCustomer(email, { name });
    } catch (err) {
      // the name is a convenience; the sign-in already stands
      console.error("[api/account/google/callback] name not saved:", err);
    }
  }
  return back(req, ret, "ok", [cookie]);
}
