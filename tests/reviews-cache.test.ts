/**
 * The product pages' reviews are kept by the CDN for a day and dropped on
 * every write to `reviews` — src/lib/reviews-cache.ts, the hook in
 * src/lib/db.ts. What must hold: each door a review changes by drops the tag
 * (a shopper's new one, the owner's approve and reject, an account erasure
 * renaming its author — that one inside a transaction, so only once it
 * committed); a read, or a rolled-back write, does not; the route files its
 * answer under the tag and never caches a degraded one. And a manual
 * migration (POST /api/admin/migrate, which writes through exec()) drops
 * every tagged public answer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addReview, setReviewStatus, validateReview, type ReviewInput } from "@/lib/reviews";
import { setupDb, teardownDb } from "./helpers";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import { exec, query, withTx, writesReviews } from "@/lib/db";
import { REVIEWS_CACHE_TAG, refreshReviewsCache } from "@/lib/reviews-cache";

const GOOD: ReviewInput = {
  product: "handmade-soap-666",
  name: "Андрей",
  rating: 5,
  text: "Беру третий раз, пенится хорошо и запах не бьёт в нос.",
  lang: "RU",
  consent: true,
};
function valid(input: ReviewInput) {
  const res = validateReview(input);
  if (!res.ok) throw new Error("expected valid, got " + res.error);
  return res.value;
}
const drops = () => nextCache.revalidateTag.mock.calls.filter((c) => c[0] === REVIEWS_CACHE_TAG).length;

describe("reviews cache", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate reviews restart identity");
    nextCache.revalidateTag.mockReset();
  });

  it("knows a write to `reviews`, in every spelling the code uses", () => {
    expect(writesReviews("insert into reviews (a) values ($1)")).toBe(true);
    expect(writesReviews("UPDATE reviews SET status = 'approved'")).toBe(true);
    expect(writesReviews("update reviews\n        set status = $2")).toBe(true);
    expect(writesReviews("delete from reviews where id = $1")).toBe(true);
    expect(writesReviews("select * from reviews where product_id = $1")).toBe(false);
    // a neighbour whose name only starts the same is not it
    expect(writesReviews("insert into reviews_archive (a) values (1)")).toBe(false);
    expect(writesReviews("update customers set name = $2")).toBe(false);
  });

  it("a new review, an approve and a reject each drop the tag", async () => {
    const saved = await addReview(valid(GOOD), "hash");
    expect(drops(), "new").toBe(1);
    await setReviewStatus(saved.id, "approved", "renat");
    expect(drops(), "approve").toBe(2);
    await setReviewStatus(saved.id, "rejected", "renat");
    expect(drops(), "reject").toBe(3);
  });

  it("an account erasure renaming its reviews drops it once, after the commit", async () => {
    await addReview(valid(GOOD), null, "gone@example.com");
    nextCache.revalidateTag.mockReset();
    const { eraseCustomerAccount } = await import("@/lib/account-privacy");
    await expect(eraseCustomerAccount("gone@example.com")).resolves.toMatchObject({ ok: true, reviews: 1 });
    expect(drops()).toBe(1);
  });

  it("a read, or a transaction that rolls back, drops nothing", async () => {
    await query("select * from reviews");
    await expect(
      withTx(async (q) => {
        await q("update reviews set name = 'x' where false");
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(drops()).toBe(0);
  });

  it("the route files its answer under the tag for a day; a degraded answer is never cached", async () => {
    const { GET } = await import("@/app/api/reviews/route");
    const ok = await GET(new Request("http://localhost/api/reviews/?product=handmade-soap-666"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=86400");
    expect(ok.headers.get("vercel-cache-tag")).toBe(REVIEWS_CACHE_TAG);

    const db = await import("@/lib/db");
    const spy = vi.spyOn(db, "query").mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await GET(new Request("http://localhost/api/reviews/?product=handmade-soap-666"));
    expect(await bad.json()).toMatchObject({ ok: true, reviews: [], degraded: true });
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
    await expect(addReview(valid(GOOD))).resolves.toMatchObject({ status: "pending" });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    nextCache.revalidateTag.mockReset();
  });

  it("outside a request the missing store is not an error worth a log line", () => {
    nextCache.revalidateTag.mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag reviews");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    refreshReviewsCache();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("a manual migration drops every tagged public answer, and only when one was applied", async () => {
    const migratePending = vi.fn();
    vi.doMock("@/lib/migrate", () => ({ migratePending, migrationStatus: vi.fn() }));
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => null }));
    const { POST } = await import("@/app/api/admin/migrate/route");
    const { FEED_CACHE_TAG } = await import("@/lib/feed-cache");
    const { HIDDEN_CACHE_TAG } = await import("@/lib/hidden-cache");
    const { BLOG_CACHE_TAG } = await import("@/lib/blog-cache");
    const req = () => new Request("http://localhost/api/admin/migrate/", { method: "POST" });

    migratePending.mockResolvedValueOnce({ applied: [], pending: [] });
    expect((await POST(req())).status).toBe(200);
    expect(nextCache.revalidateTag).not.toHaveBeenCalled();

    migratePending.mockResolvedValueOnce({ applied: ["999_example.sql"], pending: [] });
    expect((await POST(req())).status).toBe(200);
    const tags = nextCache.revalidateTag.mock.calls.map((c) => c[0]);
    expect(tags).toEqual(expect.arrayContaining([FEED_CACHE_TAG, HIDDEN_CACHE_TAG, REVIEWS_CACHE_TAG, BLOG_CACHE_TAG]));

    vi.doUnmock("@/lib/migrate");
    vi.doUnmock("@/lib/auth");
  });
});
