/**
 * src/lib/events.ts — the write side of first-party analytics
 * (db/migrations/080_events.sql) — plus GET/POST /api/cron/events-retention,
 * which is just deleteOldEvents() behind the same CRON_SECRET door as
 * /api/cron/flows (see tests/account-flows.test.ts for the sibling test).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import {
  classifyUA,
  deleteOldEvents,
  isBotUA,
  recordEvent,
  recordPurchaseEvent,
  SERVER_SID,
} from "@/lib/events";
import { setupDb, teardownDb } from "./helpers";

type EventRow = {
  id: number;
  at: string;
  sid: string | null;
  type: string;
  path: string | null;
  product_id: string | null;
  value: string | null;
  lang: string | null;
  ref: string | null;
  ua_class: string | null;
  country: string | null;
};

async function allEvents(): Promise<EventRow[]> {
  return query<EventRow>("select * from events order by id");
}

describe("src/lib/events.ts", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("080_events.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate events restart identity");
  });

  describe("UA sniffing", () => {
    it("classifies a mobile UA as mobile and everything else as desktop", () => {
      expect(classifyUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit")).toBe("mobile");
      expect(classifyUA("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("mobile");
      expect(classifyUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")).toBe("desktop");
      expect(classifyUA(null)).toBe("desktop");
    });
    it("recognises common bots and crawlers, and a missing UA", () => {
      expect(isBotUA("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
      expect(isBotUA("Mozilla/5.0 (compatible; AhrefsBot/7.0)")).toBe(true);
      expect(isBotUA(null)).toBe(true);
      expect(isBotUA("")).toBe(true);
      expect(isBotUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe(false);
    });
  });

  describe("recordEvent", () => {
    it("inserts a well-formed view", async () => {
      await recordEvent({ sid: "abc123", type: "view", path: "/shop2/c/hair/", lang: "ru", ref: "google.com", uaClass: "mobile", country: "ee" });
      const rows = await allEvents();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sid: "abc123", type: "view", path: "/shop2/c/hair/", lang: "RU", ref: "google.com", ua_class: "mobile", country: "EE",
      });
    });

    it("drops the row silently when type is missing or not one of the seven", async () => {
      await recordEvent({ type: "not_a_real_type", path: "/x" });
      await recordEvent({ type: undefined, path: "/x" });
      expect(await allEvents()).toHaveLength(0);
    });

    it("lower-cases and stores the search term in path, and the result count in value", async () => {
      await recordEvent({ sid: "s1", type: "search", path: "  Шампунь Davines  ", value: 7 });
      const rows = await allEvents();
      expect(rows[0].path).toBe("шампунь davines");
      expect(Number(rows[0].value)).toBe(7);
    });

    it("drops a value outside the sane range rather than storing garbage", async () => {
      await recordEvent({ type: "purchase", value: -5 });
      await recordEvent({ type: "purchase", value: 999_999 });
      await recordEvent({ type: "purchase", value: "not a number" });
      const rows = await allEvents();
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r.value).toBeNull();
    });

    it("clamps oversized text fields instead of failing", async () => {
      await recordEvent({ type: "view", path: "/" + "x".repeat(2000), sid: "s".repeat(500) });
      const rows = await allEvents();
      expect(rows[0].path!.length).toBeLessThanOrEqual(300);
      expect(rows[0].sid!.length).toBeLessThanOrEqual(64);
    });

    it("reduces a client-sent ref to a bare host, or drops it if it is not one", async () => {
      await recordEvent({ type: "view", ref: "https://www.google.com/search?q=shampoo" });
      await recordEvent({ type: "view", ref: "not a host at all" });
      const rows = await allEvents();
      expect(rows[0].ref).toBe("www.google.com");
      expect(rows[1].ref).toBeNull();
    });
  });

  describe("recordPurchaseEvent", () => {
    it("writes the server-authoritative row with the reserved sid", async () => {
      await recordPurchaseEvent({ id: "R-100042", total: "59.90" });
      const rows = await allEvents();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("purchase");
      expect(rows[0].sid).toBe(SERVER_SID);
      expect(rows[0].product_id).toBe("R-100042");
      expect(Number(rows[0].value)).toBe(59.9);
    });

    it("never throws, even with a nonsense total", async () => {
      await expect(recordPurchaseEvent({ id: "R-1", total: "not a number" })).resolves.toBeUndefined();
      const rows = await allEvents();
      expect(rows[0].value).toBeNull();
    });
  });

  describe("deleteOldEvents", () => {
    it("deletes only what is older than the cutoff", async () => {
      await recordEvent({ type: "view", path: "/old", at: new Date(Date.now() - 100 * 86_400_000) });
      await recordEvent({ type: "view", path: "/recent", at: new Date(Date.now() - 5 * 86_400_000) });
      const deleted = await deleteOldEvents(90);
      expect(deleted).toBe(1);
      const rows = await allEvents();
      expect(rows).toHaveLength(1);
      expect(rows[0].path).toBe("/recent");
    });
  });
});

describe("GET/POST /api/cron/events-retention", () => {
  const URL_ = "https://rempireshop.com/api/cron/events-retention/";
  let savedSecret: string | undefined;

  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate events restart identity");
    savedSecret = process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/events-retention/route");
    const res = await GET(new Request(URL_, { headers: { authorization: "Bearer anything" } }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
  });

  it("401s a missing or wrong bearer", async () => {
    process.env.CRON_SECRET = "s3cret-for-retention";
    const { GET } = await import("@/app/api/cron/events-retention/route");
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "s3cret-for-retention" }]) {
      const res = await GET(new Request(URL_, { headers: headers as Record<string, string> }));
      expect(res.status).toBe(401);
    }
  });

  it("deletes the old rows for the right secret, and POST does the same job", async () => {
    process.env.CRON_SECRET = "s3cret-for-retention";
    await recordEvent({ type: "view", path: "/old", at: new Date(Date.now() - 200 * 86_400_000) });
    await recordEvent({ type: "view", path: "/recent" });

    const { GET, POST } = await import("@/app/api/cron/events-retention/route");
    const res = await GET(new Request(URL_, { headers: { authorization: "Bearer s3cret-for-retention" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: 1, days: 90 });
    const remaining = (await query<{ n: string | number }>("select count(*) as n from events"))[0];
    expect(Number(remaining.n)).toBe(1);

    // idempotent: nothing left to delete the second time
    const again = await POST(new Request(URL_, { method: "POST", headers: { authorization: "Bearer s3cret-for-retention" } }));
    expect(await again.json()).toMatchObject({ ok: true, deleted: 0 });
  });
});
