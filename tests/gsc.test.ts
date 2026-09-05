/**
 * src/lib/gsc.ts — Google Search Console via a service account, JWT signed by
 * hand with node:crypto (no googleapis dependency). fetch is stubbed
 * throughout, so no real call ever leaves this process; the token-exchange
 * stub verifies the JWT's RS256 signature against the test keypair's public
 * half, which is the one thing worth not just trusting.
 */
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const SERVICE_ACCOUNT = JSON.stringify({
  client_email: "rempire-analytics@test-project.iam.gserviceaccount.com",
  private_key: privateKey,
});

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Verifies the assertion is a real RS256 JWT for our service account,
 *  signed with the private half of the test keypair — proving signedJwt()
 *  actually produces a signature Google's own RS256 verifier would accept. */
function assertValidAssertion(assertion: string) {
  const parts = assertion.split(".");
  expect(parts).toHaveLength(3);
  const header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
  const claims = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
  expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
  expect(claims).toMatchObject({
    iss: "rempire-analytics@test-project.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
  });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  expect(verifier.verify(publicKey, b64urlDecode(parts[2]))).toBe(true);
}

function row(clicks: number, impressions: number, ctr: number, position: number, key?: string) {
  return key ? { keys: [key], clicks, impressions, ctr, position } : { clicks, impressions, ctr, position };
}

function fakeFetch() {
  let tokenCalls = 0;
  const queryCalls: unknown[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls++;
      const params = new URLSearchParams(String(init?.body));
      assertValidAssertion(params.get("assertion")!);
      return new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/searchAnalytics/query")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      queryCalls.push(body);
      const dims: string[] = body.dimensions ?? [];
      const rows = dims.includes("query")
        ? [row(38, 320, 0.11, 4, "kevin murphy tallinn")]
        : dims.includes("page")
          ? [row(41, 95, 0.43, 1, "/shop2/p/handmade-soap-666/")]
          : [row(120, 2400, 0.05, 6.4)]; // totals: no dimensions, no keys
      return new Response(JSON.stringify({ rows }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { fn, tokenCalls: () => tokenCalls, queryCalls };
}

describe("src/lib/gsc.ts", () => {
  let savedSA: string | undefined, savedSite: string | undefined;

  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate settings restart identity");
    savedSA = process.env.GSC_SERVICE_ACCOUNT_JSON;
    savedSite = process.env.GSC_SITE_URL;
    const { resetGscTokenCache } = await import("@/lib/gsc");
    resetGscTokenCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedSA === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON; else process.env.GSC_SERVICE_ACCOUNT_JSON = savedSA;
    if (savedSite === undefined) delete process.env.GSC_SITE_URL; else process.env.GSC_SITE_URL = savedSite;
  });

  it("answers not_configured when the env is missing, without touching fetch", async () => {
    delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    delete process.env.GSC_SITE_URL;
    vi.stubGlobal("fetch", () => { throw new Error("must not call out when unconfigured"); });
    const { getSearchConsoleSummary } = await import("@/lib/gsc");
    expect(await getSearchConsoleSummary()).toEqual({ ok: false, error: "not_configured" });
  });

  it("answers bad_key when the key variable is set but is not Google's JSON file — half a paste, a path, a key without private_key", async () => {
    process.env.GSC_SITE_URL = "sc-domain:rempireshop.com";
    vi.stubGlobal("fetch", () => { throw new Error("must not call out with a broken key"); });
    const { getSearchConsoleSummary } = await import("@/lib/gsc");
    for (const raw of ['{"type":"service_account","client_email":"a@b.iam', "C:/Users/dim/Downloads/rempire-shop-1234.json", '{"client_email":"a@b.iam.gserviceaccount.com"}']) {
      process.env.GSC_SERVICE_ACCOUNT_JSON = raw;
      expect(await getSearchConsoleSummary(), raw).toEqual({ ok: false, error: "bad_key" });
    }
    // a key alone, no site url, is still "not configured" — nothing to read yet
    process.env.GSC_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
    delete process.env.GSC_SITE_URL;
    expect(await getSearchConsoleSummary()).toEqual({ ok: false, error: "not_configured" });
  });

  it("reads the key file in the shapes a paste into a web form produces — quoted, pretty-printed with real line breaks in the key, doubled \\n, base64", async () => {
    process.env.GSC_SITE_URL = "sc-domain:rempireshop.com";
    const pretty = JSON.stringify(JSON.parse(SERVICE_ACCOUNT), null, 2);
    const shapes: Array<[string, string]> = [
      ["wrapped in quotes", `"${SERVICE_ACCOUNT}"`],
      ["real line breaks inside the private key", pretty.replace(/\\n/g, "\n")],
      ["doubled backslash-n", SERVICE_ACCOUNT.replace(/\\n/g, "\\\\n")],
      ["base64 of the file", Buffer.from(SERVICE_ACCOUNT, "utf8").toString("base64")],
      ["trailing newline and spaces", SERVICE_ACCOUNT + "\n  \n"],
    ];
    for (const [name, raw] of shapes) {
      process.env.GSC_SERVICE_ACCOUNT_JSON = raw;
      vi.resetModules();
      const { fn } = fakeFetch();
      vi.stubGlobal("fetch", fn);
      const { getSearchConsoleSummary } = await import("@/lib/gsc");
      const res = await getSearchConsoleSummary(new Date("2026-06-15T12:00:00Z"));
      expect(res.ok, `${name}: ${JSON.stringify(res)}`).toBe(true);
    }
  });

  it("signs a valid RS256 assertion, fetches totals + top 20 queries + top 20 pages, and caches the answer", async () => {
    process.env.GSC_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
    process.env.GSC_SITE_URL = "sc-domain:rempireshop.com";
    const { fn, queryCalls } = fakeFetch();
    vi.stubGlobal("fetch", fn);

    const { getSearchConsoleSummary } = await import("@/lib/gsc");
    const first = await getSearchConsoleSummary(new Date("2026-06-15T12:00:00Z"));
    if (!first.ok) throw new Error("expected ok:true, got " + JSON.stringify(first));
    expect(first.cached).toBe(false);
    expect(first).toMatchObject({ clicks: 120, impressions: 2400, ctr: 0.05, position: 6.4 });
    expect(first.topQueries[0]).toMatchObject({ query: "kevin murphy tallinn", clicks: 38 });
    expect(first.topPages[0]).toMatchObject({ page: "/shop2/p/handmade-soap-666/", clicks: 41 });
    expect(queryCalls).toHaveLength(3); // totals, query, page
    for (const c of queryCalls as Array<{ rowLimit?: number }>) {
      if (c.rowLimit !== undefined) expect(c.rowLimit).toBe(20);
    }

    // second call within 24h must come back from settings.gsc_cache, no new fetch
    const second = await getSearchConsoleSummary(new Date("2026-06-15T13:00:00Z"));
    if (!second.ok) throw new Error("expected ok:true");
    expect(second.cached).toBe(true);
    expect(second.clicks).toBe(120);
    expect(fn).toHaveBeenCalledTimes(4); // 1 token + 3 query calls, none repeated

    const cached = await query<{ value: unknown }>("select value from settings where key = 'gsc_cache'");
    expect(cached).toHaveLength(1);
  });

  it("refetches once the 24h cache has expired", async () => {
    process.env.GSC_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
    process.env.GSC_SITE_URL = "sc-domain:rempireshop.com";
    const { fn } = fakeFetch();
    vi.stubGlobal("fetch", fn);
    const { getSearchConsoleSummary } = await import("@/lib/gsc");

    await getSearchConsoleSummary(new Date("2026-06-15T12:00:00Z"));
    const stale = await getSearchConsoleSummary(new Date("2026-06-17T00:00:00Z")); // > 24h later
    expect(stale.ok && stale.cached).toBe(false);
    // the settings.gsc_cache round trips again (3 fresh query calls), but the
    // bearer token from the first round is real-time-valid for another hour —
    // reused rather than re-exchanged: 4 (token + 3 queries) + 3 (queries only)
    expect(fn).toHaveBeenCalledTimes(7);
  });

  it("answers fetch_failed, never throws, when Google errors out", async () => {
    process.env.GSC_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
    process.env.GSC_SITE_URL = "sc-domain:rempireshop.com";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { getSearchConsoleSummary } = await import("@/lib/gsc");
    expect(await getSearchConsoleSummary()).toEqual({ ok: false, error: "fetch_failed" });
  });
});

describe("GET /api/admin/analytics/gsc", () => {
  let adminCookie = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    adminCookie = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate settings restart identity");
    delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    delete process.env.GSC_SITE_URL;
  });

  it("401s without the admin cookie", async () => {
    const { GET } = await import("@/app/api/admin/analytics/gsc/route");
    const res = await GET(new Request("https://rempireshop.com/api/admin/analytics/gsc/"));
    expect(res.status).toBe(401);
  });

  it("200s not_configured (not an error state) once signed in", async () => {
    const { GET } = await import("@/app/api/admin/analytics/gsc/route");
    const res = await GET(new Request("https://rempireshop.com/api/admin/analytics/gsc/", { headers: { cookie: adminCookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("200s bad_key too — a settings state the panel explains, not an outage", async () => {
    const savedSA = process.env.GSC_SERVICE_ACCOUNT_JSON;
    const savedSite = process.env.GSC_SITE_URL;
    process.env.GSC_SERVICE_ACCOUNT_JSON = "not json at all";
    process.env.GSC_SITE_URL = "sc-domain:rempireshop.com";
    try {
      const { GET } = await import("@/app/api/admin/analytics/gsc/route");
      const res = await GET(new Request("https://rempireshop.com/api/admin/analytics/gsc/", { headers: { cookie: adminCookie } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, error: "bad_key" });
    } finally {
      if (savedSA === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON; else process.env.GSC_SERVICE_ACCOUNT_JSON = savedSA;
      if (savedSite === undefined) delete process.env.GSC_SITE_URL; else process.env.GSC_SITE_URL = savedSite;
    }
  });
});
