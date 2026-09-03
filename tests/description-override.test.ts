/**
 * The trilingual product description override (db/migrations/110_..._description.sql,
 * src/lib/product-descriptions.ts) — a separate module from src/lib/orders.ts
 * on purpose (that file is shared/owned by backend-core), talking to the very
 * same product_overrides row through its own column.
 *
 * Precedence under test: override present for a language → wins; absent for
 * that language (even if present for another) → null, so the caller (app.js
 * descFor(), or a future prerender) falls back to the static per-language
 * text — never to Russian, never to a stale mix of the two.
 */
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDescriptionPatch,
  getDescriptionOverride,
  getDescriptionOverrides,
  pickDescription,
  setDescriptionOverride,
} from "@/lib/product-descriptions";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

describe("cleanDescriptionPatch — pure sanitiser", () => {
  it("keeps only RU/ET/EN string values, trimmed", () => {
    expect(cleanDescriptionPatch({ RU: "  Привет  ", other: "x" })).toEqual({ RU: "Привет" });
  });
  it("drops a language whose value is empty after trimming", () => {
    expect(cleanDescriptionPatch({ RU: "Text", ET: "   " })).toEqual({ RU: "Text" });
  });
  it("returns null for a non-object, an array, or an object with no valid language", () => {
    expect(cleanDescriptionPatch(null)).toBeNull();
    expect(cleanDescriptionPatch("string")).toBeNull();
    expect(cleanDescriptionPatch([])).toBeNull();
    expect(cleanDescriptionPatch({ FR: "bonjour" })).toBeNull();
  });
  it("caps an absurdly long description rather than rejecting it", () => {
    const out = cleanDescriptionPatch({ RU: "a".repeat(9000) });
    expect(out!.RU!.length).toBeLessThanOrEqual(4000);
  });
});

describe("pickDescription — precedence", () => {
  it("returns the language's own text when present", () => {
    expect(pickDescription({ RU: "Русский текст" }, "RU")).toBe("Русский текст");
  });
  it("returns null when that language is absent, even if another language has text", () => {
    expect(pickDescription({ RU: "Русский текст" }, "ET")).toBeNull();
  });
  it("returns null for no override at all", () => {
    expect(pickDescription(null, "RU")).toBeNull();
    expect(pickDescription(undefined, "EN")).toBeNull();
  });
});

describe("product-descriptions (PGlite)", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("round-trips a full trilingual override", async () => {
    const saved = await setDescriptionOverride("touchable", { RU: "Ру", ET: "Ee", EN: "En" });
    expect(saved).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });
    expect(await getDescriptionOverride("touchable")).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });
  });

  it("a product never touched has no override — the precedence a fresh product starts from", async () => {
    expect(await getDescriptionOverride("never-touched")).toBeNull();
    expect(await getDescriptionOverrides()).toEqual({});
  });

  it("a partial override (RU only) leaves ET/EN absent, not empty strings", async () => {
    await setDescriptionOverride("touchable", { RU: "Только русский" });
    const stored = await getDescriptionOverride("touchable");
    expect(stored).toEqual({ RU: "Только русский" });
    expect(pickDescription(stored, "RU")).toBe("Только русский");
    expect(pickDescription(stored, "ET")).toBeNull(); // caller falls back to static ET text
    expect(pickDescription(stored, "EN")).toBeNull();
  });

  it("setting null clears the override back to 'no override'", async () => {
    await setDescriptionOverride("touchable", { RU: "Текст" });
    expect(await getDescriptionOverride("touchable")).not.toBeNull();

    await setDescriptionOverride("touchable", null);
    expect(await getDescriptionOverride("touchable")).toBeNull();
  });

  it("re-saving replaces the whole object (a translate-then-save writes all three at once)", async () => {
    await setDescriptionOverride("touchable", { RU: "Ру" });
    await setDescriptionOverride("touchable", { RU: "Ру", ET: "Ee", EN: "En" });
    expect(await getDescriptionOverride("touchable")).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });
  });

  it("getDescriptionOverrides bulk-reads only touched products, filterable by id list", async () => {
    await setDescriptionOverride("a", { RU: "A" });
    await setDescriptionOverride("b", { RU: "B" });
    // "c" never touched — must not appear
    const all = await getDescriptionOverrides();
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);

    const filtered = await getDescriptionOverrides(["a", "c"]);
    expect(Object.keys(filtered)).toEqual(["a"]);
  });

  it("does not disturb a product's other overrides (price/stock) — same row, different column", async () => {
    const { upsertOverride, getOverrides } = await import("@/lib/orders");
    await upsertOverride("touchable", { price: 19.9, stock: "low" });
    await setDescriptionOverride("touchable", { RU: "Новое описание" });

    const overrides = await getOverrides(["touchable"]);
    expect(overrides.touchable.price).toBe(19.9);
    expect(overrides.touchable.stock).toBe("low");
    expect(await getDescriptionOverride("touchable")).toEqual({ RU: "Новое описание" });
  });
});

describe("description precedence through the HTTP routes", () => {
  let admin = "";
  const ORIGIN = "https://rempireshop.com";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(truncateAll);

  function put(path: string, body: unknown, cookie?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    return new Request(`${ORIGIN}${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
  }
  function get(path: string, cookie?: string) {
    return new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
  }

  it("PUT /api/admin/overrides with a description saves it, and both GETs expose it — even with no other override on the product", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");

    const res = await PUT(
      put("/api/admin/overrides/", { id: "touchable", description: { RU: "Ру", ET: "Ee", EN: "En" } }, admin),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.overrides.touchable.description).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });
    // no price/stock/etc were sent — the rest of the row still comes back
    // shaped like a normal Override, just with every other field null
    expect(body.overrides.touchable.price).toBeNull();

    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable.description).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });

    const publicView = await (await publicGet()).json();
    expect(publicView.overrides.touchable.description).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });
  });

  it("a product with only a price override and no description never gets a fabricated description field", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    await PUT(put("/api/admin/overrides/", { id: "touchable", price: 25 }, admin));

    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable.price).toBe(25);
    expect(adminView.overrides.touchable.description).toBeUndefined();
  });

  it("PUT with description: null clears it, and it disappears from both GETs", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");

    await PUT(put("/api/admin/overrides/", { id: "touchable", description: { RU: "Ру" } }, admin));
    await PUT(put("/api/admin/overrides/", { id: "touchable", description: null }, admin));

    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable?.description).toBeFalsy();
    const publicView = await (await publicGet()).json();
    expect(publicView.overrides.touchable?.description).toBeFalsy();
  });

  it("the public route requires no admin cookie, the admin route does", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const denied = await PUT(put("/api/admin/overrides/", { id: "touchable", description: { RU: "x" } }));
    expect(denied.status).toBe(401);
  });
});
