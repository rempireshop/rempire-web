/**
 * /feed/google-local.xml — the salon's local product inventory for Google's
 * free local listings (src/lib/local-inventory.ts, prepared 02.11.2026 and
 * switched OFF until the salon's Business Profile is linked to Merchant
 * Center; docs/google-local-listings.md).
 *
 * What matters, and what this file holds down:
 *   · off means off: no settings.gbp_store_code (or an empty one, or no
 *     database at all) is a 404 that no cache keeps, so the day Dim sets the
 *     code the feed is there;
 *   · on, it is RSS 2.0 with the g: namespace and Google's attribute names —
 *     store_code, id, availability (in_stock / out_of_stock), price,
 *     pickup_method, pickup_sla — one item per item of the product feed;
 *   · every id, price and availability is the PRODUCT feed's own, item for
 *     item, in its order: Google joins the two feeds on the id, and the
 *     counted shelf, a manual «нет в наличии», a size counted to zero, a
 *     hidden product and a set all follow;
 *   · the settings route stores only a clean code.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/feed/[file]/route";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { setBundleActive, upsertBundle, validateBundle } from "@/lib/bundles";
import { exec } from "@/lib/db";
import { setQty } from "@/lib/inventory";
import { buildLocalFeed, cleanStoreCode, LOCAL_FEED_FILE, PICKUP, STORE_CODE_KEY, STORE_CODE_MAX } from "@/lib/local-inventory";
import { getSettingRaw, setSetting, upsertOverride } from "@/lib/orders";
import { resetShippingRulesCache } from "@/lib/shipping";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const LIVE = "https://rempireshop.com";
const SHAMPOO = "system-4-bio-botanical-shampoo"; // 75/250/500 мл
const NIGHT_RIDER = "night-rider"; // 30/100 г
const GATSBY = "mandom-gatsby-moving-rubber"; // no sizes
const PRORASO = "proraso-wood-spice-beard-balm-100ml"; // no sizes

async function fetchFeed(file: string): Promise<Response> {
  return GET(new Request(`${LIVE}/feed/${file}`), { params: Promise.resolve({ file }) });
}
type Item = Record<string, string[]>;
const items = (xml: string): Item[] =>
  [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const f: Item = {};
    for (const x of m[1].matchAll(/<g:([a-z_]+)>([^<]*)<\/g:\1>/g)) (f[x[1]] ??= []).push(x[2]);
    return f;
  });
/** The product feed's own items, as [id, price, availability]. */
async function productFeed(lang = "en"): Promise<Array<[string, string, string]>> {
  const res = await fetchFeed(`google-${lang}.xml`);
  expect(res.status).toBe(200);
  return items(await res.text()).map((f) => [f.id[0], f.price[0], f.availability[0]]);
}
async function localFeed(): Promise<{ xml: string; list: Item[] }> {
  const res = await fetchFeed(LOCAL_FEED_FILE);
  expect(res.status).toBe(200);
  const xml = await res.text();
  return { xml, list: items(xml) };
}
const triple = (f: Item): [string, string, string] => [f.id[0], f.price[0], f.availability[0]];

/** Every tag closed in order, nothing left open, no bare ampersand. */
function assertWellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) expect(stack.pop(), `closing </${m[2]}>`).toBe(m[2]);
    else stack.push(m[2]);
  }
  expect(stack).toEqual([]);
  expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
}

const savedBase = process.env.PUBLIC_BASE_URL;
beforeAll(async () => {
  await setupDb();
});
afterAll(async () => {
  if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedBase;
  await teardownDb();
});
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await exec(
    "truncate custom_products, product_overrides, stock_levels, stock_moves, settings, stock_alerts, bundles restart identity cascade",
  );
  resetShippingRulesCache();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("switched off", () => {
  it("is a 404 nobody caches while no store code is set — no row, an empty one, or garbage", async () => {
    for (const value of [undefined, "", "   ", null, true, ["RMP-MARDI1"], { code: "X" }, "x".repeat(STORE_CODE_MAX + 1)]) {
      if (value !== undefined) await setSetting(STORE_CODE_KEY, value);
      const res = await fetchFeed(LOCAL_FEED_FILE);
      expect(res.status, JSON.stringify(value)).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    }
  });

  it("is a 404 with no database configured at all — there is no setting to read", async () => {
    await setSetting(STORE_CODE_KEY, "RMP-MARDI1");
    const driver = process.env.DB_DRIVER;
    const url = process.env.DATABASE_URL;
    delete process.env.DB_DRIVER;
    delete process.env.DATABASE_URL;
    try {
      expect((await fetchFeed(LOCAL_FEED_FILE)).status).toBe(404);
    } finally {
      process.env.DB_DRIVER = driver;
      if (url !== undefined) process.env.DATABASE_URL = url;
    }
  });

  it("leaves the product feeds alone", async () => {
    expect((await fetchFeed("google-en.xml")).status).toBe(200);
    expect((await fetchFeed("google-local-en.xml")).status).toBe(404);
  });
});

describe("switched on", () => {
  beforeEach(async () => {
    await setSetting(STORE_CODE_KEY, "RMP-MARDI1");
  });

  it("answers RSS 2.0 with Google's local inventory attributes, cached for an hour like the product feeds", async () => {
    const res = await fetchFeed(LOCAL_FEED_FILE);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=3600");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n')).toBe(true);
    expect(xml.endsWith("</channel>\n</rss>\n")).toBe(true);
    assertWellFormed(xml);
    const list = items(xml);
    expect(list.length).toBeGreaterThan(300);
    for (const f of list) {
      // exactly these attributes, once each — the required three first
      expect(Object.keys(f)).toEqual(["store_code", "id", "availability", "price", "pickup_method", "pickup_sla"]);
      for (const k of Object.keys(f)) expect(f[k], k).toHaveLength(1);
      expect(f.store_code[0]).toBe("RMP-MARDI1");
      expect(f.id[0].length).toBeLessThanOrEqual(50);
      expect(["in_stock", "out_of_stock"]).toContain(f.availability[0]);
      expect(f.price[0]).toMatch(/^\d+\.\d{2} EUR$/);
      expect(f.pickup_method[0]).toBe("buy");
      expect(f.pickup_sla[0]).toBe("same day");
    }
    expect(PICKUP).toEqual({ method: "buy", sla: "same day" });
  });

  it("is the product feed item for item: the same ids in the same order, the same prices and stock", async () => {
    const { list } = await localFeed();
    const product = await productFeed("en");
    expect(list.map(triple)).toEqual(product);
    // the ids do not depend on the language — Google joins either feed on them
    expect((await productFeed("ru")).map((t) => t[0])).toEqual(product.map((t) => t[0]));
  });

  it("follows the shelf: a size counted to zero, a manual «нет в наличии», a hidden product, a new price", async () => {
    await setQty(NIGHT_RIDER, "100 г", 0, { reason: "adjust" });
    await setQty(NIGHT_RIDER, "30 г", 7, { reason: "adjust" });
    await upsertOverride(GATSBY, { stock: "out" });
    await upsertOverride(PRORASO, { hidden: true });
    await upsertOverride(SHAMPOO, { price: 10 });
    const { list } = await localFeed();
    const product = await productFeed("en");
    expect(list.map(triple)).toEqual(product);
    const av = list.map((f) => f.availability[0]);
    expect(av).toContain("out_of_stock");
    expect(av).toContain("in_stock");
    // the counted-out size and the switched-off product are out; the hidden one is absent from both feeds
    const outIds = list.filter((f) => f.availability[0] === "out_of_stock").map((f) => f.id[0]);
    expect(outIds.some((id) => id.startsWith("night-rider"))).toBe(true);
    expect(outIds.some((id) => id.startsWith("mandom-gatsby"))).toBe(true);
    expect(list.some((f) => f.id[0].startsWith("proraso-wood-spice-beard-balm"))).toBe(false);
    expect(list.filter((f) => f.id[0].startsWith("system-4-bio-botanical-shampoo")).map((f) => f.price[0]))
      .toEqual(["10.00 EUR", "17.00 EUR", "26.00 EUR"]);
  });

  it("carries the sets the product feed carries, and drops one the product feed drops", async () => {
    const check = validateBundle({
      id: "test-set", cat: "hair",
      title: { RU: "Тестовый набор", ET: "Testkomplekt", EN: "Test set" },
      desc: { RU: "Два товара вместе.", ET: "Kaks toodet koos.", EN: "Two products together." },
      items: [{ productId: SHAMPOO, variant: 1, qty: 1 }, { productId: GATSBY, variant: 0, qty: 2 }],
      discountPct: 10, active: true, sort: 1,
    });
    if (!check.ok) throw new Error("fixture is invalid: " + check.error);
    await upsertBundle(check.value);
    let { list } = await localFeed();
    expect(list.map(triple)).toEqual(await productFeed("en"));
    const set = list.find((f) => f.id[0] === "set-test-set")!;
    expect(set).toBeTruthy();
    expect(set.availability[0]).toBe("in_stock");
    await setBundleActive("test-set", false);
    ({ list } = await localFeed());
    expect(list.some((f) => f.id[0] === "set-test-set")).toBe(false);
  });

  it("states the store code as stored — case kept, trimmed — and escapes it", () => {
    const { xml } = buildLocalFeed({ overrides: {}, descriptions: {}, custom: [], bundles: [], storeCode: "  Mardi&1 ", base: LIVE });
    expect(xml).toContain("<g:store_code>Mardi&amp;1</g:store_code>");
    expect(xml).not.toContain("Mardi&1<");
    expect(() => buildLocalFeed({ overrides: {}, descriptions: {}, custom: [], bundles: [], storeCode: "", base: LIVE })).toThrow();
  });

  it("answers 503 rather than a list without the owner's switches when the database fails", async () => {
    await exec("alter table product_overrides rename to product_overrides_away");
    try {
      const res = await fetchFeed(LOCAL_FEED_FILE);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      await exec("alter table product_overrides_away rename to product_overrides");
    }
  });
});

describe("the store code setting", () => {
  it("is cleaned to text of at most 64 characters, or nothing", () => {
    expect(cleanStoreCode("  RMP-MARDI1 ")).toBe("RMP-MARDI1");
    expect(cleanStoreCode("abc\u0000\n")).toBe("abc");
    expect(cleanStoreCode(12345)).toBe("12345");
    expect(cleanStoreCode("x".repeat(64))).toHaveLength(64);
    for (const v of ["x".repeat(65), null, undefined, {}, [], true]) expect(cleanStoreCode(v), String(v)).toBe("");
  });

  it("is stored clean by PUT /api/admin/settings — and switches the feed on and off", async () => {
    const savedSecret = process.env.SESSION_SECRET;
    const savedHash = process.env.ADMIN_PASSWORD_HASH;
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    try {
      const { PUT } = await import("@/app/api/admin/settings/route");
      const cookie = `${ADMIN_COOKIE}=${makeSessionToken()}`;
      const put = (value: unknown) => PUT(new Request(`${LIVE}/api/admin/settings/`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
        body: JSON.stringify({ [STORE_CODE_KEY]: value }),
      }));
      expect((await put("  RMP-MARDI1\n")).status).toBe(200);
      expect((await getSettingRaw(STORE_CODE_KEY)).value).toBe("RMP-MARDI1");
      expect((await fetchFeed(LOCAL_FEED_FILE)).status).toBe(200);
      // emptying it is how the feed goes off again
      expect((await put("")).status).toBe(200);
      expect((await getSettingRaw(STORE_CODE_KEY)).value).toBe("");
      expect((await fetchFeed(LOCAL_FEED_FILE)).status).toBe(404);
      // something that is not a code is stored as «off», never raw
      expect((await put({ evil: "<script>" })).status).toBe(200);
      expect((await getSettingRaw(STORE_CODE_KEY)).value).toBe("");
    } finally {
      if (savedSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = savedSecret;
      if (savedHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
      else process.env.ADMIN_PASSWORD_HASH = savedHash;
    }
  });
});
