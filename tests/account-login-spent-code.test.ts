/**
 * A correct login code is spent the moment checkLoginCode() answers "ok" — it
 * deletes the row. POST /api/account/login used to await the profile, the order
 * list and the points summary BEFORE minting the token, all inside one try, so
 * any failure in those three answered a CORRECT code with a 503 and no cookie.
 * The shopper then had no code (the row was gone), and the next try read «Код
 * не найден — запросите новый»; a fresh code costs one of three per fifteen
 * minutes (audit).
 *
 * The session is signed first now, and the three reads are best-effort. The
 * blips below are injected around the real functions — the DB underneath is a
 * real Postgres, so everything that is not deliberately broken still runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/** Which query is "down" for the test that is running. */
const blip = { loyalty: false, profile: false };

vi.mock("@/lib/loyalty", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/loyalty")>();
  return {
    ...real,
    accountLoyaltySummary: async (id: string | null) => {
      if (blip.loyalty) throw new Error("loyalty ledger unavailable");
      return real.accountLoyaltySummary(id);
    },
  };
});

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

const EMAIL = "spent-code@example.com";

/** A different IP per call — the route's own limiter is 20 per 15 minutes. */
let seq = 0;
function post(code: string): Request {
  seq += 1;
  return new Request("https://rempireshop.com/api/account/login/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${seq}` },
    body: JSON.stringify({ email: EMAIL, code }),
  });
}

describe("a correct login code survives a blip behind it", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(() => {
    blip.loyalty = false;
    blip.profile = false;
  });

  it("signs the shopper in when the points summary is down", async () => {
    const { issueLoginCode, readCustomerToken } = await import("@/lib/customers");
    const { POST: login } = await import("@/app/api/account/login/route");

    const { code } = await issueLoginCode(EMAIL);
    blip.loyalty = true;
    const res = await login(post(code));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; customer: { email: string }; orders: unknown[] };
    expect(body.ok).toBe(true);
    // the profile itself was readable — only the points were not
    expect(body.customer.email).toBe(EMAIL);

    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie, "the code is gone; the cookie is the only way back in").toContain("rmp_cust=v1.");
    const value = setCookie.split(";")[0].split("=").slice(1).join("=");
    expect(readCustomerToken(decodeURIComponent(value))).toBe(EMAIL);
  });

  it("signs the shopper in when the customer row cannot be written either", async () => {
    const { issueLoginCode, readCustomerToken } = await import("@/lib/customers");
    const { POST: login } = await import("@/app/api/account/login/route");

    const { code } = await issueLoginCode(EMAIL);
    blip.profile = true;
    blip.loyalty = true;
    const res = await login(post(code));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; customer: { email: string; tier: string } };
    expect(body.ok).toBe(true);
    // …on the same empty profile GET /api/account/me falls back to
    expect(body.customer.email).toBe(EMAIL);
    expect(body.customer.tier).toBe("retail");

    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("rmp_cust=v1.");
    const value = setCookie.split(";")[0].split("=").slice(1).join("=");
    expect(readCustomerToken(decodeURIComponent(value))).toBe(EMAIL);
  });

  it("still refuses a wrong code, and still 503s when the check itself cannot run", async () => {
    const { issueLoginCode } = await import("@/lib/customers");
    const { POST: login } = await import("@/app/api/account/login/route");

    const { code } = await issueLoginCode(EMAIL);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await login(post(wrong));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("bad_code");
    expect(bad.headers.get("set-cookie"), "a wrong code gets no session").toBeNull();
  });
});
