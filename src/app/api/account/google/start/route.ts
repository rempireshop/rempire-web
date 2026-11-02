/**
 * GET /api/account/google/start?return=<path> — «Продолжить с Google», step 1.
 *
 * Makes a random state and nonce, leaves them with the return path in the
 * signed ten-minute `rmp_gauth` cookie, and sends the browser to Google's
 * account chooser. The whole flow, and why the cookie is SameSite=None, is in
 * src/lib/google-signin.ts.
 *
 * `return` is the page to come back to (the account screen or the checkout,
 * in its language). Anything that is not a plain path inside the shop —
 * `//host`, a scheme, a backslash, the API — is replaced by the account
 * screen: there is no open redirect through here.
 *
 * 404 while GOOGLE_CLIENT_ID is unset: the feature does not exist until the
 * owner has made a Google client (docs/google-login.md).
 */
import { clientIp, rateLimit } from "@/lib/auth";
import {
  authorizeUrl,
  callbackUrl,
  DEFAULT_RETURN,
  googleClientId,
  googleSignInOn,
  makeStateToken,
  randomToken,
  safeReturnPath,
  stateCookie,
} from "@/lib/google-signin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const clientId = googleClientId();
  if (!clientId || !googleSignInOn()) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (rateLimit("account-google-start", clientIp(req), 30, 15 * 60 * 1000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const url = new URL(req.url);
  const ret = safeReturnPath(url.searchParams.get("return")) ?? DEFAULT_RETURN;
  const state = randomToken();
  const nonce = randomToken();

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl({ clientId, redirectUri: callbackUrl(url.origin), state, nonce }),
      "set-cookie": stateCookie(makeStateToken({ state, nonce, ret })),
      ...NO_STORE,
    },
  });
}
