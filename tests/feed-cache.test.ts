/**
 * The shop's public feeds are kept by the CDN and dropped on every write to
 * the data behind them — src/lib/feed-cache.ts, the hook in src/lib/db.ts.
 * What must hold: every door a price, a stock count, a setting or a set is
 * written through drops the tag (a single statement and a transaction alike,
 * the transaction only once it committed); a read, or a write to a table the
 * feeds do not show, does not; both routes file their answer under the tag,
 * and a 503 is never cached.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { setSetting, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import { FEED_TABLES, query, withTx, writesShopFeed } from "@/lib/db";
import { FEED_CACHE_TAG, refreshFeedCache } from "@/lib/feed-cache";

const id = (catalogueMin as Array<{ id: string }>)[0].id;
const drops = () => nextCache.revalidateTag.mock.calls.filter((c) => c[0] === FEED_CACHE_TAG).length;

describe("shop feed cache", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    nextCache.revalidateTag.mockReset();
  });

  it("knows a write to each of its tables, in every spelling the code uses", () => {
    for (const t of FEED_TABLES) {
      expect(writesShopFeed(`insert into ${t} (a) values ($1)`), t).toBe(true);
      expect(writesShopFeed(`UPDATE ${t} SET a = 1`), t).toBe(true);
      expect(writesShopFeed(`delete from ${t} where a = 1`), t).toBe(true);
      expect(writesShopFeed(`insert into\n       ${t} (a) values ($1)`), t).toBe(true);
      expect(writesShopFeed(`select * from ${t}`), t).toBe(false);
    }
    // a neighbour whose name only starts the same is not one of them
    expect(writesShopFeed("insert into settings_history (a) values (1)")).toBe(false);
    expect(writesShopFeed("insert into orders (a) values (1)")).toBe(false);
    expect(writesShopFeed("update admin_audit set a = 1")).toBe(false);
  });

  it("a price, a stock word and a setting each drop the tag", async () => {
    await upsertOverride(id, { price: 12.5 });
    expect(drops(), "price").toBe(1);
    await upsertOverride(id, { stock: "out" });
    expect(drops(), "stock").toBe(2);
    await setSetting("hero", null);
    expect(drops(), "setting").toBe(3);
  });

  it("a counted shelf moved inside a transaction drops it once, after the commit", async () => {
    const { setQty } = await import("@/lib/inventory");
    await setQty(id, null, 4);
    expect(drops()).toBe(1);
  });

  it("a transaction that rolls back drops nothing", async () => {
    await expect(
      withTx(async (q) => {
        await q("insert into settings (key, value) values ('hero', 'null'::jsonb)");
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(drops()).toBe(0);
  });

  it("a read, or a write the feeds never show, drops nothing", async () => {
    await query("select * from product_overrides");
    await query("select key, value from settings");
    expect(drops()).toBe(0);
  });

  it("both routes file their answer under the tag; a failure is never cached", async () => {
    for (const path of ["@/app/api/overrides/route", "@/app/api/bundles/route"] as const) {
      const { GET } = await import(path);
      const ok: Response = await GET();
      expect(ok.status, path).toBe(200);
      expect(ok.headers.get("vercel-cache-tag"), path).toBe(FEED_CACHE_TAG);
      expect(ok.headers.get("cache-control"), path).toBe("public, s-maxage=600, stale-while-revalidate=120");
    }
    const db = await import("@/lib/db");
    const spy = vi.spyOn(db, "query").mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/bundles/route");
    const bad: Response = await GET();
    expect(bad.status).toBe(503);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect(bad.headers.get("vercel-cache-tag")).toBeNull();
    spy.mockRestore();
    err.mockRestore();
  });

  it("a purge that throws does not fail the save", async () => {
    nextCache.revalidateTag.mockImplementation(() => {
      throw new Error("CDN unreachable");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(upsertOverride(id, { price: 9 })).resolves.toMatchObject({ price: 9 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    nextCache.revalidateTag.mockReset();
  });

  it("outside a request the missing store is not an error worth a log line", () => {
    nextCache.revalidateTag.mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag shop-feed");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    refreshFeedCache();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
