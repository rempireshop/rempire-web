/**
 * The per-language Google title/description
 * (db/migrations/130_product_overrides_seo_langs.sql, src/lib/product-seo.ts).
 *
 * What is pinned: the Russian pair IS the legacy seo_title/seo_desc pair
 * (an older row needs no migration, an older reader still sees it), Estonian
 * and English are their own values, a page whose language has none falls
 * back to the Russian field, and the whole set is replaced on every write so
 * an emptied pair really goes away.
 */
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanSeoPatch, getSeoOverride, getSeoOverrides, pickSeo, setSeoOverride } from "@/lib/product-seo";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

describe("cleanSeoPatch — pure sanitiser", () => {
  it("keeps RU/ET/EN pairs, trimmed, in the API spelling", () => {
    expect(cleanSeoPatch({ RU: { title: "  Заголовок ", desc: "Описание" }, FR: { title: "non" } }))
      .toEqual({ RU: { title: "Заголовок", desc: "Описание" } });
  });
  it("understands the panel's own {t, d} spelling too", () => {
    expect(cleanSeoPatch({ ET: { t: "Pealkiri", d: "" } })).toEqual({ ET: { title: "Pealkiri" } });
  });
  it("drops a language whose pair is empty, and returns null when nothing is left", () => {
    expect(cleanSeoPatch({ RU: { title: " ", desc: "" }, EN: {} })).toBeNull();
    expect(cleanSeoPatch(null)).toBeNull();
    expect(cleanSeoPatch([])).toBeNull();
    expect(cleanSeoPatch("x")).toBeNull();
  });
  it("caps a title at 70 and a description at 170 characters, on one line", () => {
    const out = cleanSeoPatch({ RU: { title: "a".repeat(200), desc: "b\n\n c ".repeat(100) } })!;
    expect(out.RU!.title!.length).toBe(70);
    expect(out.RU!.desc!.length).toBeLessThanOrEqual(170);
    expect(out.RU!.desc).not.toMatch(/\n/);
  });
});

describe("pickSeo — precedence", () => {
  const ov = { RU: { title: "Ру", desc: "Ру-описание" }, ET: { title: "Ee" } };
  it("takes the language's own field first", () => {
    expect(pickSeo(ov, "ET")!.title).toBe("Ee");
  });
  it("falls back to the Russian field for a half the language has not got", () => {
    expect(pickSeo(ov, "ET")!.desc).toBe("Ру-описание");
    expect(pickSeo(ov, "EN")).toEqual({ title: "Ру", desc: "Ру-описание" });
  });
  it("returns null with no override, or with nothing in any language", () => {
    expect(pickSeo(null, "RU")).toBeNull();
    expect(pickSeo({}, "RU")).toBeNull();
  });
});

describe("product-seo (PGlite)", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("round-trips all three languages, and the Russian pair is the legacy columns", async () => {
    const saved = await setSeoOverride("touchable", {
      RU: { title: "Ру", desc: "Ру-опис" }, ET: { title: "Ee", desc: "Ee-kirj" }, EN: { title: "En", desc: "En-desc" },
    });
    expect(saved).toEqual({
      RU: { title: "Ру", desc: "Ру-опис" }, ET: { title: "Ee", desc: "Ee-kirj" }, EN: { title: "En", desc: "En-desc" },
    });
    expect(await getSeoOverride("touchable")).toEqual(saved);

    const { getOverrides } = await import("@/lib/orders");
    const legacy = (await getOverrides(["touchable"])).touchable;
    expect(legacy.seoTitle).toBe("Ру");
    expect(legacy.seoDesc).toBe("Ру-опис");
  });

  it("a pair written by the older panel (seo_title/seo_desc only) reads back as the Russian pair", async () => {
    const { upsertOverride } = await import("@/lib/orders");
    await upsertOverride("touchable", { seoTitle: "Старый заголовок", seoDesc: "Старое описание" });
    expect(await getSeoOverride("touchable")).toEqual({ RU: { title: "Старый заголовок", desc: "Старое описание" } });
    expect(pickSeo(await getSeoOverride("touchable"), "ET")).toEqual({ title: "Старый заголовок", desc: "Старое описание" });
  });

  it("re-saving replaces the whole set — a pair the owner emptied is gone", async () => {
    await setSeoOverride("touchable", { RU: { title: "Ру" }, ET: { title: "Ee" }, EN: { title: "En" } });
    await setSeoOverride("touchable", { RU: { title: "Ру-2" }, ET: { title: "" }, EN: { title: "En" } });
    expect(await getSeoOverride("touchable")).toEqual({ RU: { title: "Ру-2" }, EN: { title: "En" } });
  });

  it("null clears every language, including the legacy columns", async () => {
    await setSeoOverride("touchable", { RU: { title: "Ру" }, ET: { title: "Ee" } });
    await setSeoOverride("touchable", null);
    expect(await getSeoOverride("touchable")).toBeNull();
    const { getOverrides } = await import("@/lib/orders");
    expect((await getOverrides(["touchable"])).touchable.seoTitle).toBeNull();
  });

  it("does not disturb the row's other overrides — same row, other columns", async () => {
    const { upsertOverride, getOverrides } = await import("@/lib/orders");
    await upsertOverride("touchable", { price: 19.9, stock: "low" });
    await setSeoOverride("touchable", { EN: { title: "En" } });
    const row = (await getOverrides(["touchable"])).touchable;
    expect(row.price).toBe(19.9);
    expect(row.stock).toBe("low");
    expect(row.seoTitle).toBeNull();
    expect(await getSeoOverride("touchable")).toEqual({ EN: { title: "En" } });
  });

  it("getSeoOverrides lists only touched products, filterable by id list", async () => {
    await setSeoOverride("a", { RU: { title: "A" } });
    await setSeoOverride("b", { ET: { desc: "B" } });
    expect(Object.keys(await getSeoOverrides()).sort()).toEqual(["a", "b"]);
    expect(Object.keys(await getSeoOverrides(["a", "c"]))).toEqual(["a"]);
  });
});

describe("the per-language pair through the HTTP routes", () => {
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

  it("PUT {seo} saves all three, and both GETs expose `seo` plus the legacy Russian pair", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");

    const res = await PUT(put("/api/admin/overrides/", {
      id: "touchable",
      seo: { RU: { title: "Ру", desc: "Ру-опис" }, ET: { title: "Ee", desc: "" }, EN: { title: "", desc: "En-desc" } },
    }, admin));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.overrides.touchable.seo).toEqual({ RU: { title: "Ру", desc: "Ру-опис" }, ET: { title: "Ee" }, EN: { desc: "En-desc" } });
    expect(body.overrides.touchable.seoTitle).toBe("Ру");
    expect(body.overrides.touchable.seoDesc).toBe("Ру-опис");

    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable.seo).toEqual({ RU: { title: "Ру", desc: "Ру-опис" }, ET: { title: "Ee" }, EN: { desc: "En-desc" } });
    expect(adminView.overrides.touchable.seoTitle).toBe("Ру");

    const publicView = await (await publicGet()).json();
    expect(publicView.overrides.touchable.seo).toEqual({ RU: { title: "Ру", desc: "Ру-опис" }, ET: { title: "Ee" }, EN: { desc: "En-desc" } });
    expect(publicView.overrides.touchable.seoTitle).toBe("Ру");
  });

  it("the legacy body {seoTitle, seoDesc} still works and shows up as seo.RU", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    await PUT(put("/api/admin/overrides/", { id: "touchable", seoTitle: "Старый", seoDesc: "Старое" }, admin));
    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable.seoTitle).toBe("Старый");
    expect(adminView.overrides.touchable.seo).toEqual({ RU: { title: "Старый", desc: "Старое" } });
  });

  it("a product with only a price override never gets a fabricated `seo`", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    await PUT(put("/api/admin/overrides/", { id: "touchable", price: 25 }, admin));
    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable.price).toBe(25);
    expect(adminView.overrides.touchable.seo).toBeUndefined();
  });

  it("PUT {seo: every pair empty} clears it from both GETs, legacy columns included", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");
    await PUT(put("/api/admin/overrides/", { id: "touchable", seo: { RU: { title: "Ру" }, ET: { title: "Ee" } } }, admin));
    await PUT(put("/api/admin/overrides/", { id: "touchable", seo: { RU: { title: "", desc: "" }, ET: { title: "", desc: "" }, EN: { title: "", desc: "" } } }, admin));
    const adminView = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(adminView.overrides.touchable?.seo).toBeFalsy();
    expect(adminView.overrides.touchable?.seoTitle ?? null).toBeNull();
    const publicView = await (await publicGet()).json();
    expect(publicView.overrides.touchable?.seo).toBeFalsy();
  });

  it("the admin route still requires the admin cookie", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const denied = await PUT(put("/api/admin/overrides/", { id: "touchable", seo: { RU: { title: "x" } } }));
    expect(denied.status).toBe(401);
  });
});
