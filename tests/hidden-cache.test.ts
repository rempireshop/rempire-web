/**
 * The hidden-products list is cached by the CDN and dropped on every hide —
 * src/lib/hidden-cache.ts. What must hold: a write to `hidden` purges the
 * tag (so the middleware's next lookup sees it), any other override write
 * does not (so a price edit does not throw the cache away), and the route
 * files its answer under that tag. A 503 is never cached.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import { HIDDEN_CACHE_TAG, refreshHiddenCache } from "@/lib/hidden-cache";

const id = (catalogueMin as Array<{ id: string }>)[0].id;

describe("hidden-products cache", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    nextCache.revalidateTag.mockReset();
  });

  it("a hide and a show each drop the tag", async () => {
    await upsertOverride(id, { hidden: true });
    expect(nextCache.revalidateTag).toHaveBeenCalledWith(HIDDEN_CACHE_TAG);
    nextCache.revalidateTag.mockReset();
    await upsertOverride(id, { hidden: false });
    expect(nextCache.revalidateTag).toHaveBeenCalledWith(HIDDEN_CACHE_TAG);
  });

  it("a price or a name edit leaves the cached list alone", async () => {
    await upsertOverride(id, { price: 12.5 });
    await upsertOverride(id, { name: "Другое имя" });
    expect(nextCache.revalidateTag).not.toHaveBeenCalled();
  });

  it("the route files its answer under the tag; a failure is never cached", async () => {
    const { GET } = await import("@/app/api/overrides/hidden/route");
    const ok = await GET();
    expect(ok.headers.get("vercel-cache-tag")).toBe(HIDDEN_CACHE_TAG);
    expect(ok.headers.get("cache-control")).toMatch(/s-maxage=\d+/);

    const db = await import("@/lib/db");
    const spy = vi.spyOn(db, "query").mockRejectedValueOnce(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await GET();
    expect(bad.status).toBe(503);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect(bad.headers.get("vercel-cache-tag")).toBeNull();
    spy.mockRestore();
    err.mockRestore();
  });

  it("a purge that throws does not fail the save", () => {
    nextCache.revalidateTag.mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing");
    });
    expect(() => refreshHiddenCache()).not.toThrow();
  });
});
