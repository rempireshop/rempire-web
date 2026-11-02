/**
 * «Продолжить с Google» (src/lib/google-signin.ts, the two routes under
 * src/app/api/account/google/) — the whole door, driven the way a browser
 * drives it: GET start → the state cookie and Google's URL → POST callback
 * with a form Google would send. Google itself is a locally generated RSA key
 * pair and a stubbed keys endpoint; the database is the real PGlite one, so
 * «signs in an existing account» and «creates a new one» are rows, not mocks.
 *
 * Every refusal is asserted the same way, because that is the promise: a 303
 * back to the page the sign-in started from with `?google=cancel`, the state
 * cookie cleared, and NO `rmp_cust` — a refusal that signed anybody in, or
 * answered with an error page the shopper cannot get out of, is the failure.
 */
import { generateKeyPairSync, sign as rsaSign, type KeyObject } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";
import { query } from "@/lib/db";
import { resetRateLimits } from "@/lib/auth";
import { readCustomerToken, recordLogin, updateCustomer } from "@/lib/customers";
import {
  createJwksCache,
  GOOGLE_JWKS_URL,
  readStateToken,
  safeReturnPath,
  verifyIdToken,
  withGoogleFlag,
  type JwksAnswer,
} from "@/lib/google-signin";

/** «the customers table does not answer» — around the real recordLogin(), like tests/account-login-spent-code.test.ts. */
const blip = { profile: false };
vi.mock("@/lib/customers", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/customers")>();
  return {
    ...real,
    recordLogin: async (email: string, lang?: unknown) => {
      if (blip.profile) throw new Error("customers row unavailable");
      return real.recordLogin(email, lang);
    },
  };
});

const CLIENT = "1234567890-test.apps.googleusercontent.com";
const SHOP = "https://rempireshop.com";

/* ---------- a Google of our own ------------------------------------------- */

function rsa() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}
const K1 = rsa();
const K2 = rsa();
const jwk = (pub: KeyObject, kid: string) => ({ ...(pub.export({ format: "jwk" }) as object), kid, alg: "RS256", use: "sig" });
const JWK1 = jwk(K1.publicKey, "kid-1");
const JWK2 = jwk(K2.publicKey, "kid-2");

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");

function jwt(claims: Record<string, unknown>, o: { kid?: string; key?: KeyObject; alg?: string } = {}): string {
  const head = b64({ alg: o.alg ?? "RS256", kid: o.kid ?? "kid-1", typ: "JWT" });
  const body = b64(claims);
  const sig = rsaSign("RSA-SHA256", Buffer.from(`${head}.${body}`), o.key ?? K1.privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

function claims(nonce: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT,
    azp: CLIENT,
    sub: "109876543210",
    email: "new.person@example.com",
    email_verified: true,
    name: "Anna Kask",
    iat: now,
    exp: now + 3600,
    nonce,
    ...over,
  };
}

/** What the stubbed https://www.googleapis.com/oauth2/v3/certs publishes. */
let published: unknown[] = [JWK1];
let keyFetches = 0;

/* ---------- the browser --------------------------------------------------- */

let ip = 0;
const nextIp = () => `198.51.100.${(ip = (ip % 250) + 1)}`;

async function begin(ret = "/ru/checkout") {
  const { GET } = await import("@/app/api/account/google/start/route");
  const res = await GET(
    new Request(`${SHOP}/api/account/google/start?return=${encodeURIComponent(ret)}`, { headers: { "x-forwarded-for": nextIp() } }),
  );
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location") ?? "");
  const set = res.headers.get("set-cookie") ?? "";
  const token = set.split(";")[0].split("=").slice(1).join("=");
  return { res, loc, set, token, state: loc.searchParams.get("state") ?? "", nonce: loc.searchParams.get("nonce") ?? "" };
}

async function finish(fields: Record<string, string>, o: { cookie?: string; origin?: string | null } = {}) {
  const { POST } = await import("@/app/api/account/google/callback/route");
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "x-forwarded-for": nextIp(),
  };
  if (o.origin !== null) headers.origin = o.origin ?? "https://accounts.google.com";
  if (o.cookie) headers.cookie = o.cookie;
  return POST(new Request(`${SHOP}/api/account/google/callback`, { method: "POST", headers, body: new URLSearchParams(fields).toString() }));
}

function cookiesOf(res: Response): string[] {
  return res.headers.getSetCookie();
}
function sessionOf(res: Response): string | null {
  const c = cookiesOf(res).find((x) => x.startsWith("rmp_cust="));
  if (!c) return null;
  return readCustomerToken(decodeURIComponent(c.split(";")[0].slice("rmp_cust=".length)));
}

/** The one shape every refusal has. */
function expectCancelled(res: Response, ret = "/ru/checkout") {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`${SHOP}${withGoogleFlag(ret, "cancel")}`);
  expect(cookiesOf(res).some((c) => c.startsWith("rmp_cust=")), "a refusal signs nobody in").toBe(false);
  expect(cookiesOf(res).some((c) => /^rmp_gauth=;.*Max-Age=0/.test(c)), "the state cookie is spent").toBe(true);
}

/* ---------- the suite ----------------------------------------------------- */

describe("«Продолжить с Google»", () => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.SESSION_SECRET };

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(async () => {
    await teardownDb();
    if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = saved.id;
    process.env.SESSION_SECRET = saved.secret;
  });
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    process.env.SESSION_SECRET = TEST_SECRET;
    resetRateLimits();
    published = [JWK1];
    keyFetches = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== GOOGLE_JWKS_URL) throw new Error(`unexpected fetch: ${url}`);
      keyFetches += 1;
      return Response.json({ keys: published }, { headers: { "cache-control": "public, max-age=3600" } });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("off until GOOGLE_CLIENT_ID is set", () => {
    it("answers 404 on both routes and tells the storefront there is no button", async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const { GET } = await import("@/app/api/account/google/start/route");
      const { POST } = await import("@/app/api/account/google/callback/route");
      const start = await GET(new Request(`${SHOP}/api/account/google/start?return=/account`));
      expect(start.status).toBe(404);
      expect(start.headers.get("set-cookie")).toBeNull();
      const cb = await POST(new Request(`${SHOP}/api/account/google/callback`, { method: "POST", body: "state=x&id_token=y" }));
      expect(cb.status).toBe(404);
      expect(cb.headers.get("set-cookie")).toBeNull();

      const { GET: feed } = await import("@/app/api/overrides/route");
      const off = (await (await feed()).json()) as { settings: Record<string, unknown> };
      expect(off.settings.google_signin).toBe(false);
      process.env.GOOGLE_CLIENT_ID = CLIENT;
      const on = (await (await feed()).json()) as { settings: Record<string, unknown> };
      expect(on.settings.google_signin).toBe(true);
    });

    it("treats a blank client ID, or a secret too short to sign with, as off", async () => {
      const { GET } = await import("@/app/api/account/google/start/route");
      process.env.GOOGLE_CLIENT_ID = "   ";
      expect((await GET(new Request(`${SHOP}/api/account/google/start`))).status).toBe(404);
      process.env.GOOGLE_CLIENT_ID = CLIENT;
      process.env.SESSION_SECRET = "short";
      expect((await GET(new Request(`${SHOP}/api/account/google/start`))).status).toBe(404);
    });
  });

  describe("start", () => {
    it("sends the browser to Google's chooser with everything the implicit flow needs", async () => {
      const { loc, state, nonce } = await begin("/ru/checkout");
      expect(`${loc.origin}${loc.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      const p = loc.searchParams;
      expect(p.get("client_id")).toBe(CLIENT);
      expect(p.get("redirect_uri")).toBe(`${SHOP}/api/account/google/callback`);
      expect(p.get("response_type")).toBe("id_token");
      expect(p.get("response_mode")).toBe("form_post");
      expect(p.get("scope")).toBe("openid email profile");
      expect(p.get("prompt")).toBe("select_account");
      expect(state).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(nonce).not.toBe(state);
    });

    it("keeps state, nonce and the return path in a signed ten-minute cookie Google's POST will carry", async () => {
      const { set, token, state, nonce } = await begin("/et/account");
      expect(set).toMatch(/^rmp_gauth=/);
      for (const attr of ["HttpOnly", "Secure", "SameSite=None", "Path=/api/account/google", "Max-Age=600"]) expect(set).toContain(attr);
      expect(readStateToken(token)).toEqual({ state, nonce, ret: "/et/account" });
      // ten minutes and not a second more
      expect(readStateToken(token, Date.now() + 10 * 60 * 1000 + 1)).toBeNull();
      // a cookie with its payload swapped is no cookie
      const [v, exp, , sig] = token.split(".");
      const forged = `${v}.${exp}.${Buffer.from(JSON.stringify({ s: state, n: nonce, r: "/x" })).toString("base64url")}.${sig}`;
      expect(readStateToken(forged)).toBeNull();
    });

    it("makes a fresh state every time", async () => {
      const a = await begin();
      const b = await begin();
      expect(a.state).not.toBe(b.state);
      expect(a.nonce).not.toBe(b.nonce);
    });

    it("replaces a return path that leaves the shop with the account screen", async () => {
      for (const bad of ["//evil.example/", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "evil.example", "/api/account/me"]) {
        const { token } = await begin(bad);
        expect(readStateToken(token)?.ret, bad).toBe("/account");
      }
    });
  });

  describe("the return path", () => {
    it("accepts a plain path inside the shop", () => {
      for (const ok of ["/", "/account", "/ru/checkout", "/et/account", "/ru/checkout?x=1", "/products/a-b_c"]) {
        expect(safeReturnPath(ok), ok).toBe(ok);
      }
      // the fragment is the browser's, not ours
      expect(safeReturnPath("/ru/account#top")).toBe("/ru/account");
    });

    it("refuses everything that could leave the shop or smuggle a header", () => {
      const bad = [
        "", "account", "evil.example", "//evil.example", "//evil.example/ru", "///evil.example",
        "/\\evil.example", "\\\\evil.example", "/ru\\..\\evil", "https://evil.example", "http:/evil.example",
        "javascript:alert(1)", "data:text/html,x", " /account", "/account ", "/ac count", "/a\tb",
        "/a\r\nSet-Cookie: x=1", "/a\u0000b", "/a b", "/api", "/api/account/me", "/api/account/google/start",
        "/" + "a".repeat(600), null, undefined, 42, ["/account"], { toString: () => "/account" },
      ];
      for (const v of bad) expect(safeReturnPath(v), JSON.stringify(String(v))).toBeNull();
    });

    it("carries the flag in the query, once", () => {
      expect(withGoogleFlag("/ru/checkout", "ok")).toBe("/ru/checkout?google=ok");
      expect(withGoogleFlag("/ru/checkout?x=1&google=cancel", "ok")).toBe("/ru/checkout?x=1&google=ok");
      expect(withGoogleFlag("//evil.example", "cancel")).toBe("/account?google=cancel");
    });
  });

  describe("callback — a good token", () => {
    it("creates the account a first code login would, fills its empty name, and signs it in", async () => {
      const email = "First.Timer@Example.com";
      const f = await begin("/ru/checkout");
      const res = await finish(
        { id_token: jwt(claims(f.nonce, { email, name: "Mari Maasikas" })), state: f.state },
        { cookie: `rmp_gauth=${f.token}` },
      );
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${SHOP}/ru/checkout?google=ok`);
      expect(sessionOf(res), "the same 90-day session a code gives, keyed on the lower-cased address").toBe("first.timer@example.com");
      const cust = cookiesOf(res).find((c) => c.startsWith("rmp_cust="))!;
      expect(cust).toContain("HttpOnly");
      expect(cust).toContain("SameSite=Lax");
      expect(cookiesOf(res).some((c) => /^rmp_gauth=;.*Max-Age=0/.test(c))).toBe(true);

      const rows = await query<{ email: string; name: string | null; lang: string; source: string | null; marketing: boolean; last_login_at: unknown }>(
        "select email, name, lang, source, marketing, last_login_at from customers where lower(email) = $1",
        ["first.timer@example.com"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("first.timer@example.com");
      expect(rows[0].lang).toBe("RU");
      expect(rows[0].name).toBe("Mari Maasikas");
      // exactly what recordLogin() writes on a first code login: no source, no consent
      expect(rows[0].source).toBeNull();
      expect(rows[0].marketing).toBe(false);
      expect(rows[0].last_login_at).not.toBeNull();
    });

    it("signs an existing account in by its lower-cased address and leaves its name alone", async () => {
      const email = "returning.customer@example.com";
      await recordLogin(email, "ET");
      await updateCustomer(email, { name: "Juhan Juurikas" });
      const before = await query<{ id: string; last_login_at: Date }>("select id, last_login_at from customers where email = $1", [email]);

      const f = await begin("/et/account");
      const res = await finish(
        // the plain issuer spelling is Google's too
        { id_token: jwt(claims(f.nonce, { email: "Returning.Customer@EXAMPLE.com", name: "Someone Else", iss: "accounts.google.com" })), state: f.state },
        { cookie: `rmp_gauth=${f.token}` },
      );
      expect(res.headers.get("location")).toBe(`${SHOP}/et/account?google=ok`);
      expect(sessionOf(res)).toBe(email);
      const after = await query<{ id: string; name: string; lang: string; last_login_at: Date }>(
        "select id, name, lang, last_login_at from customers where lower(email) = $1",
        [email],
      );
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].name).toBe("Juhan Juurikas");
      expect(after[0].lang).toBe("ET");
      expect(new Date(after[0].last_login_at).getTime()).toBeGreaterThanOrEqual(new Date(before[0].last_login_at).getTime());
    });

    it("lets a minute of clock drift through", async () => {
      const f = await begin();
      const now = Math.floor(Date.now() / 1000);
      const res = await finish(
        { id_token: jwt(claims(f.nonce, { email: "drift@example.com", exp: now - 30, iat: now + 30 })), state: f.state },
        { cookie: `rmp_gauth=${f.token}` },
      );
      expect(res.headers.get("location")).toBe(`${SHOP}/ru/checkout?google=ok`);
    });

    it("signs the shopper in even when the customers table does not answer — the code login's rule", async () => {
      const f = await begin();
      blip.profile = true;
      try {
        const res = await finish({ id_token: jwt(claims(f.nonce, { email: "db.down@example.com" })), state: f.state }, { cookie: `rmp_gauth=${f.token}` });
        expect(res.headers.get("location")).toBe(`${SHOP}/ru/checkout?google=ok`);
        expect(sessionOf(res)).toBe("db.down@example.com");
      } finally {
        blip.profile = false;
      }
      const rows = await query("select 1 from customers where email = $1", ["db.down@example.com"]);
      expect(rows, "no row yet — GET /api/account/me makes it on the next read, as after a code").toHaveLength(0);
    });
  });

  describe("callback — every refusal is a clean «cancel»", () => {
    async function refuse(over: Record<string, unknown>, o: { kid?: string; key?: KeyObject; alg?: string } = {}) {
      const f = await begin();
      return finish({ id_token: jwt(claims(f.nonce, { email: "refused@example.com", ...over }), o), state: f.state }, { cookie: `rmp_gauth=${f.token}` });
    }

    it("refuses a token for another client (aud)", async () => {
      expectCancelled(await refuse({ aud: "someone-else.apps.googleusercontent.com", azp: "someone-else.apps.googleusercontent.com" }));
      expectCancelled(await refuse({ aud: ["someone-else", CLIENT], azp: "someone-else" }));
    });

    it("refuses a token from another issuer (iss)", async () => {
      expectCancelled(await refuse({ iss: "https://evil.example" }));
      expectCancelled(await refuse({ iss: "accounts.google.com.evil.example" }));
    });

    it("refuses an expired token, and one issued in the future", async () => {
      const now = Math.floor(Date.now() / 1000);
      expectCancelled(await refuse({ exp: now - 120, iat: now - 3720 }));
      expectCancelled(await refuse({ iat: now + 600 }));
      expectCancelled(await refuse({ exp: undefined }));
    });

    it("refuses a token whose nonce is not the one this browser was given", async () => {
      expectCancelled(await refuse({ nonce: "a-nonce-from-another-sign-in" }));
      expectCancelled(await refuse({ nonce: undefined }));
    });

    it("refuses a form whose state is not the cookie's", async () => {
      const f = await begin();
      const other = await begin();
      const token = jwt(claims(f.nonce, { email: "refused@example.com" }));
      expectCancelled(await finish({ id_token: token, state: other.state }, { cookie: `rmp_gauth=${f.token}` }));
      expectCancelled(await finish({ id_token: token, state: "" }, { cookie: `rmp_gauth=${f.token}` }));
      // …and a form with no cookie at all: a forged POST from anywhere else
      expectCancelled(await finish({ id_token: token, state: f.state }), "/account");
    });

    it("refuses an address Google has not verified", async () => {
      expectCancelled(await refuse({ email_verified: false }));
      // the claim must be the boolean, not something that looks like it
      expectCancelled(await refuse({ email_verified: "true" }));
      expectCancelled(await refuse({ email: "not-an-address" }));
    });

    it("refuses a key Google does not publish, after asking Google once more", async () => {
      // warm the cache with kid-1, so the unknown kid below is a MISS, not a first fetch
      const ok = await begin();
      await finish({ id_token: jwt(claims(ok.nonce, { email: "warm@example.com" })), state: ok.state }, { cookie: `rmp_gauth=${ok.token}` });
      expectCancelled(await refuse({}, { kid: "kid-unknown", key: K2.privateKey }));
    });

    it("refuses a tampered token", async () => {
      const f = await begin();
      const good = jwt(claims(f.nonce, { email: "victim@example.com" }));
      const [h, , s] = good.split(".");
      const swapped = `${h}.${b64(claims(f.nonce, { email: "attacker@example.com" }))}.${s}`;
      expectCancelled(await finish({ id_token: swapped, state: f.state }, { cookie: `rmp_gauth=${f.token}` }));

      const g = await begin();
      const t = jwt(claims(g.nonce, { email: "victim@example.com" }));
      const flipped = t.slice(0, -2) + (t.slice(-2) === "AA" ? "BB" : "AA");
      expectCancelled(await finish({ id_token: flipped, state: g.state }, { cookie: `rmp_gauth=${g.token}` }));

      // signed with a key that is not kid-1's
      expectCancelled(await refuse({}, { kid: "kid-1", key: K2.privateKey }));
      // «alg: none» and HMAC games
      const n = await begin();
      const none = `${b64({ alg: "none", kid: "kid-1" })}.${b64(claims(n.nonce))}.`;
      expectCancelled(await finish({ id_token: none, state: n.state }, { cookie: `rmp_gauth=${n.token}` }));
      expectCancelled(await refuse({}, { alg: "HS256" }));
      // not a token at all
      const x = await begin();
      expectCancelled(await finish({ id_token: "garbage", state: x.state }, { cookie: `rmp_gauth=${x.token}` }));
    });

    it("takes Google's own «no» (access_denied) back to the page with the alert", async () => {
      const f = await begin("/et/checkout");
      expectCancelled(await finish({ error: "access_denied", state: f.state }, { cookie: `rmp_gauth=${f.token}` }), "/et/checkout");
    });

    it("accepts the POST from accounts.google.com only", async () => {
      const f = await begin();
      const token = jwt(claims(f.nonce, { email: "csrf@example.com" }));
      const res = await finish({ id_token: token, state: f.state }, { cookie: `rmp_gauth=${f.token}`, origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(sessionOf(res)).toBeNull();
      // the same form from Google's own page is the sign-in
      const ok = await finish({ id_token: token, state: f.state }, { cookie: `rmp_gauth=${f.token}` });
      expect(sessionOf(ok)).toBe("csrf@example.com");
    });
  });

  describe("Google's keys", () => {
    function counting(answers: () => JwksAnswer) {
      let n = 0;
      return { fetches: () => n, fetcher: async () => { n += 1; return answers(); } };
    }
    const opts = (nonce: string) => ({ clientId: CLIENT, nonce });

    it("fetches once, then answers from memory", async () => {
      const c = counting(() => ({ keys: [JWK1], maxAgeS: 3600 }));
      const keys = createJwksCache(c.fetcher, { minRefetchMs: 0 });
      for (let i = 0; i < 3; i++) {
        const v = await verifyIdToken(jwt(claims("n")), { ...opts("n"), keys });
        expect(v.ok).toBe(true);
      }
      expect(c.fetches()).toBe(1);
      // …until the endpoint's own max-age runs out
      const later = Date.now() + 3601 * 1000;
      const exp = Math.floor(later / 1000) + 600;
      const v = await verifyIdToken(jwt(claims("n", { iat: exp - 1200, exp })), { ...opts("n"), keys, now: later });
      expect(v.ok).toBe(true);
      expect(c.fetches()).toBe(2);
    });

    it("asks again on an unknown kid, and refuses it when the fresh set has none", async () => {
      const c = counting(() => ({ keys: [JWK1], maxAgeS: 3600 }));
      const keys = createJwksCache(c.fetcher, { minRefetchMs: 0 });
      expect((await verifyIdToken(jwt(claims("n")), { ...opts("n"), keys })).ok).toBe(true);
      const v = await verifyIdToken(jwt(claims("n"), { kid: "kid-2", key: K2.privateKey }), { ...opts("n"), keys });
      expect(v).toEqual({ ok: false, error: "unknown_kid" });
      expect(c.fetches(), "one refetch for the miss").toBe(2);
    });

    it("picks up a rotated key on that refetch", async () => {
      let set: unknown[] = [JWK1];
      const c = counting(() => ({ keys: set, maxAgeS: 3600 }));
      const keys = createJwksCache(c.fetcher, { minRefetchMs: 0 });
      expect((await verifyIdToken(jwt(claims("n")), { ...opts("n"), keys })).ok).toBe(true);
      set = [JWK1, JWK2];
      const v = await verifyIdToken(jwt(claims("n"), { kid: "kid-2", key: K2.privateKey }), { ...opts("n"), keys });
      expect(v.ok).toBe(true);
      expect(c.fetches()).toBe(2);
    });

    it("does not let a run of made-up kids become a run of fetches", async () => {
      const c = counting(() => ({ keys: [JWK1], maxAgeS: 3600 }));
      const keys = createJwksCache(c.fetcher); // the default floor between refetches
      expect((await verifyIdToken(jwt(claims("n")), { ...opts("n"), keys })).ok).toBe(true);
      for (let i = 0; i < 5; i++) {
        const v = await verifyIdToken(jwt(claims("n"), { kid: `made-up-${i}`, key: K2.privateKey }), { ...opts("n"), keys });
        expect(v).toEqual({ ok: false, error: "unknown_kid" });
      }
      expect(c.fetches()).toBe(1);
    });

    it("refuses cleanly when the keys cannot be fetched", async () => {
      const keys = createJwksCache(async () => {
        throw new Error("network down");
      });
      expect(await verifyIdToken(jwt(claims("n")), { ...opts("n"), keys })).toEqual({ ok: false, error: "keys_unavailable" });
    });
  });
});
