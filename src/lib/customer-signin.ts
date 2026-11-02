/**
 * Signing a customer in — the ONE way it is done, whichever door the shopper
 * came through: a correct e-mailed code (POST /api/account/login) or a
 * verified Google ID token (POST /api/account/google/callback,
 * src/lib/google-signin.ts). Both end here, so a Google sign-in finds the same
 * row by the same lower-cased address, creates it exactly as a first code
 * login does, and gets the same 90-day `rmp_cust` cookie.
 *
 * What a first sign-in writes is recordLogin()'s (src/lib/customers.ts): the
 * row with the language and `last_login_at`, nothing else. No consent —
 * marketing stays off until the shopper ticks the box (src/lib/consent.ts);
 * no `source` — null means «made by the shop itself» (221_customer_source.sql),
 * which a Google sign-in is; and a deleted account's address simply gets a new,
 * empty account, its old orders staying detached (223_account_erasure.sql,
 * isErasedSession in src/lib/account-privacy.ts tells the old cookie from this
 * new one by its issue time).
 *
 * The order is the login route's lesson (tests/account-login-spent-code.test.ts):
 * the session is signed FIRST — makeCustomerToken() is pure crypto and cannot
 * fail once SESSION_SECRET is set — and the row is best-effort after it. A
 * slow or broken database must answer a proven identity with a session on an
 * empty screen, never with a refusal: the code is already spent, and the
 * Google token is single-use for us too (its nonce dies with the state cookie).
 *
 * Its own module, not a function inside customers.ts: callers' tests replace
 * recordLogin() through the module boundary (vi.mock("@/lib/customers")), and
 * a call from inside that module would not see the replacement.
 */
import { customerCookie, makeCustomerToken, recordLogin, type Customer } from "@/lib/customers";

export interface SignedIn {
  /** The `set-cookie` value for `rmp_cust`. */
  cookie: string;
  /** The row, or null when the database did not answer — the session stands regardless. */
  customer: Customer | null;
}

export async function signInCustomer(req: Request, email: string, lang: unknown): Promise<SignedIn> {
  const cookie = customerCookie(req, makeCustomerToken(email));
  let customer: Customer | null = null;
  try {
    customer = await recordLogin(email, lang);
  } catch (err) {
    /* Signed in on an empty screen, not signed out on a full one. The next
       GET /api/account/me fills the profile in — with the cookie that is
       already on its way back. */
    console.error("[customer-signin] signed in, profile unavailable:", err);
  }
  return { cookie, customer };
}
