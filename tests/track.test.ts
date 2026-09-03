/**
 * POST /api/track — the storefront's analytics beacon. Public, no cookie:
 * see db/migrations/080_events.sql and docs/analytics.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const UA_MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const UA_BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let ip = 0;
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/track/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(ip++ % 200) + 1}`,
      "user-agent": UA_DESKTOP,
      "x-vercel-ip-country": "EE",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function rows() {
  return query<Record<string, unknown>>("select * from events order by id");
}

describe("POST /api/track", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate events restart identity");
    resetRateLimits();
  });

  it("204s and records a well-formed view", async () => {
    const { POST } = await import("@/app/api/track/route");
    const res = await POST(post({ sid: "s1", type: "view", path: "/shop2/", lang: "RU" }));
    expect(res.status).toBe(204);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sid: "s1", type: "view", path: "/shop2/", ua_class: "desktop", country: "EE" });
  });

  it("takes ua_class and country from the request's own headers, never from the body", async () => {
    const { POST } = await import("@/app/api/track/route");
    await POST(post(
      { type: "view", uaClass: "mobile", country: "US" },
      { "user-agent": UA_MOBILE, "x-vercel-ip-country": "FR" },
    ));
    const r = await rows();
    // the header UA really is mobile, so this only proves the header (not the
    // spoofed body field) decided it — country is the clean test of that
    expect(r[0].ua_class).toBe("mobile");
    expect(r[0].country).toBe("FR");
  });

  it("204s a bot UA and records nothing", async () => {
    const { POST } = await import("@/app/api/track/route");
    const res = await POST(post({ type: "view", path: "/" }, { "user-agent": UA_BOT }));
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it("204s malformed JSON and an unknown type without recording anything", async () => {
    const { POST } = await import("@/app/api/track/route");
    expect((await POST(post("{not json"))).status).toBe(204);
    expect((await POST(post({ type: "made_up_type" }))).status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it("413s a body over 1 KB", async () => {
    const { POST } = await import("@/app/api/track/route");
    const res = await POST(post({ type: "view", path: "/x", extra: "y".repeat(2000) }));
    expect(res.status).toBe(413);
    expect(await rows()).toHaveLength(0);
  });

  it("429s past 60 a minute from the same IP", async () => {
    const { POST } = await import("@/app/api/track/route");
    const sameIp = { "x-forwarded-for": "198.51.100.77" };
    let last = 0;
    for (let i = 0; i < 61; i++) {
      const res = await POST(post({ type: "view", path: "/" }, sameIp));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("GET is not allowed", async () => {
    const { GET } = await import("@/app/api/track/route");
    expect(GET().status).toBe(405);
  });
});
