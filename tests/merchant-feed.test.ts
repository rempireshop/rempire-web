/**
 * The Google Merchant Center feeds — /feed/google-<en|et|ru>.xml,
 * src/app/feed/[file]/route.ts over src/lib/merchant-feed.ts.
 *
 * Merchant Center suspends an account over a feed that disagrees with the
 * shop — a price the page does not show, «in stock» for a size the checkout
 * refuses, a shipping price the checkout does not charge — so the checks that
 * matter here are the ones that hold the feed to the shop's OWN functions
 * rather than to numbers typed into this file:
 *
 *   · every item's price and availability against priceItems(), the
 *     checkout's own pricing, with the owner's overrides in play (a «Цена»
 *     shifting a ladder, his own ladder, a manual «нет в наличии», one size
 *     counted to zero);
 *   · every g:shipping entry against quoteFromRules() over the stored rules,
 *     the free-delivery threshold and a switched-off country included;
 *   · hidden products and switched-off custom products absent;
 *   · every link on the live domain, whatever PUBLIC_BASE_URL says;
 *   · the required attributes on every item of all three feeds, ids inside
 *     Google's 50 characters, sizes grouped under one item_group_id;
 *   · and src/data/catalogue.feed.json still being what the storefront's own
 *     files give (tools/pack-feed.mjs), like catalogue.variants.json is held
 *     to catalogue2.js.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { GET } from "@/app/feed/[file]/route";
import { createCustomProduct, setCustomProductActive } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { setLevel, setQty } from "@/lib/inventory";
import {
  apparelOf,
  buildFeed,
  feedBase,
  feedLangOf,
  idStem,
  MAX_ID,
  merchantId,
  sellCountries,
  shippingFor,
  sizeSlug,
  validGtin,
} from "@/lib/merchant-feed";
import { OrderError, priceItems, setSetting, upsertOverride } from "@/lib/orders";
import { setDescriptionOverride } from "@/lib/product-descriptions";
import {
  DEFAULT_SHIPPING_RULES,
  loadShippingRules,
  quoteFromRules,
  resetShippingRulesCache,
  type ShippingRules,
} from "@/lib/shipping";
import { offeredCarriers } from "@/lib/shipping/country-prices";
import { buildFeedData, serialiseFeedData } from "../tools/lib/feed-data.mjs";
import { setupDb, teardownDb } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIVE = "https://rempireshop.com";
const STAGING = "https://rempireshop.diipsolutions.eu";

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as MinProduct[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;

/* The fixtures, picked for what they exercise — all of them real catalogue ids. */
const SHAMPOO = "system-4-bio-botanical-shampoo"; // 75/250/500 мл at 9/16/25
const SERUM = "system-4-bio-botanical-serum"; // 50/150/500 мл
const LONG = "sim-sensitive-system-4-oil-cure-scalp-treatment-o"; // 49 characters, three sizes
const NIGHT_RIDER = "night-rider"; // 30/100 г
const TOUCHABLE = "touchable"; // ONE named size, 250 мл
const GATSBY = "mandom-gatsby-moving-rubber"; // no sizes at all
const PRORASO = "proraso-wood-spice-beard-balm-100ml"; // no sizes
const BUTTERFLY = "dead-head-butterfly"; // the shop's own brand, no sizes
const TEE = "oversized-t-shirt-unisex"; // merch, «white / S» … «yellow / XXL»

/* ---------- reading the XML --------------------------------------------- */

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

type Ship = { country: string; service: string; price: string };
type Parsed = { fields: Record<string, string[]>; shipping: Ship[] };

function items(xml: string): Parsed[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const body = m[1];
    const shipping: Ship[] = [...body.matchAll(/<g:shipping>([\s\S]*?)<\/g:shipping>/g)].map((s) => ({
      country: /<g:country>([^<]*)</.exec(s[1])![1],
      service: unxml(/<g:service>([^<]*)</.exec(s[1])![1]),
      price: /<g:price>([^<]*)</.exec(s[1])![1],
    }));
    const rest = body.replace(/<g:shipping>[\s\S]*?<\/g:shipping>/g, "");
    const fields: Record<string, string[]> = {};
    for (const f of rest.matchAll(/<g:([a-z_]+)>([^<]*)<\/g:\1>/g)) (fields[f[1]] ??= []).push(unxml(f[2]));
    return { fields, shipping };
  });
}
const one = (it: Parsed, key: string) => it.fields[key]?.[0];
const productOf = (it: Parsed) => decodeURIComponent(/\/p\/([^/?]+)\/(\?size=[^/]*)?$/.exec(one(it, "link") ?? "")![1]);
const byProduct = (list: Parsed[], id: string) => list.filter((it) => productOf(it) === id);
const euros = (price: string) => Number(price.replace(/ EUR$/, ""));

/** Every tag closed in order, nothing left open — the XML parses. */
function assertWellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) expect(stack.pop(), `closing </${m[2]}>`).toBe(m[2]);
    else stack.push(m[2]);
  }
  expect(stack).toEqual([]);
  // text is escaped: no bare ampersand, no stray angle bracket inside a value
  expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
}

async function fetchFeed(file: string): Promise<Response> {
  return GET(new Request(`${LIVE}/feed/${file}`), { params: Promise.resolve({ file }) });
}
async function feed(lang: "en" | "et" | "ru"): Promise<{ xml: string; list: Parsed[] }> {
  const res = await fetchFeed(`google-${lang}.xml`);
  expect(res.status).toBe(200);
  const xml = await res.text();
  return { xml, list: items(xml) };
}

/** What the checkout charges for one of this size — or its refusal code. */
async function checkout(id: string, variant: string | null): Promise<number | string> {
  try {
    const { lines } = await priceItems([{ id, variant, qty: 1 }], "RU");
    return lines[0].price;
  } catch (err) {
    if (err instanceof OrderError) return err.code;
    throw err;
  }
}

/* ---------- the rig ----------------------------------------------------- */

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
    "truncate custom_products, product_overrides, stock_levels, stock_moves, settings, stock_alerts restart identity cascade",
  );
  resetShippingRulesCache();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------- the generated half ------------------------------------------ */

describe("src/data/catalogue.feed.json", () => {
  it("is exactly what tools/pack-feed.mjs makes of the storefront's own files", () => {
    const committed = readFileSync(new URL("../src/data/catalogue.feed.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const fresh = serialiseFeedData(buildFeedData(ROOT));
    // run `node tools/pack-feed.mjs` if this fails — catalogue2.js or content*.js moved without it
    expect(committed === fresh).toBe(true);
  });

  it("covers every catalogue product, with photos and all three texts", () => {
    const data = buildFeedData(ROOT) as Record<string, { img: string[]; d: Record<string, string> }>;
    expect(Object.keys(data).sort()).toEqual(CATALOGUE.map((p) => p.id).sort());
    for (const [id, row] of Object.entries(data)) {
      expect(row.img.length, id).toBeGreaterThan(0);
      for (const lang of ["EN", "RU", "ET"]) {
        expect(row.d[lang], `${id} ${lang}`).toBeTruthy();
        expect(row.d[lang]).not.toMatch(/<[a-z/]/i); // plain text, no markup left
        expect(row.d[lang].length).toBeLessThanOrEqual(5000);
      }
    }
  });
});

/* ---------- the route --------------------------------------------------- */

describe("GET /feed/<file>", () => {
  it("answers the three feeds as RSS 2.0 with the g: namespace, cached for an hour", async () => {
    for (const lang of ["en", "et", "ru"] as const) {
      const res = await fetchFeed(`google-${lang}.xml`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=3600");
      const xml = await res.text();
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n')).toBe(true);
      expect(xml.endsWith("</channel>\n</rss>\n")).toBe(true);
      expect(xml).toMatch(/<channel>\n {2}<title>REMPIRE<\/title>\n {2}<link>https:\/\/rempireshop\.com\/shop2\/[^<]*<\/link>\n {2}<description>[^<]+<\/description>/);
      assertWellFormed(xml);
    }
  });

  it("is a 404 for any other name — the old static google-shopping.xml included", async () => {
    for (const file of ["google-shopping.xml", "google-de.xml", "google-en.xml/", "GOOGLE-EN.XML", "constructor", "__proto__", "", "../google-en.xml"]) {
      const res = await fetchFeed(file);
      expect(res.status, file).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    }
    expect(feedLangOf("toString")).toBeNull();
  });

  it("answers 503 rather than a feed without the owner's switches when the database fails", async () => {
    await exec("alter table product_overrides rename to product_overrides_away");
    try {
      const res = await fetchFeed("google-en.xml");
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
    } finally {
      await exec("alter table product_overrides_away rename to product_overrides");
    }
  });

  it("with no database configured at all, serves the catalogue files as they are", async () => {
    const driver = process.env.DB_DRIVER;
    const url = process.env.DATABASE_URL;
    delete process.env.DB_DRIVER;
    delete process.env.DATABASE_URL;
    try {
      const res = await fetchFeed("google-en.xml");
      expect(res.status).toBe(200);
      expect(items(await res.text()).length).toBe(
        CATALOGUE.reduce((n, p) => n + (VARIANTS[p.id]?.sizes.length ?? 1), 0),
      );
    } finally {
      process.env.DB_DRIVER = driver;
      if (url !== undefined) process.env.DATABASE_URL = url;
    }
  });
});

/* ---------- every item, every feed --------------------------------------- */

describe("the items", () => {
  it("carry every attribute Merchant Center requires, in all three languages", async () => {
    const segs = { en: "/shop2/en/p/", et: "/shop2/et/p/", ru: "/shop2/p/" };
    for (const lang of ["en", "et", "ru"] as const) {
      const { list } = await feed(lang);
      // the whole catalogue: one item per size, one for a product without sizes
      expect(list.length).toBe(CATALOGUE.reduce((n, p) => n + (VARIANTS[p.id]?.sizes.length ?? 1), 0));
      const ids = new Set<string>();
      for (const it of list) {
        const id = one(it, "id")!;
        expect(id, "id").toBeTruthy();
        expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
        expect(ids.has(id), `duplicate ${id}`).toBe(false);
        ids.add(id);
        const title = one(it, "title")!;
        expect(title.length, id).toBeGreaterThan(3);
        expect(title.length, id).toBeLessThanOrEqual(150);
        const desc = one(it, "description")!;
        expect(desc.length, id).toBeGreaterThan(10);
        expect(desc.length, id).toBeLessThanOrEqual(5000);
        expect(one(it, "link"), id).toMatch(new RegExp("^https://rempireshop\\.com" + segs[lang] + "[^/?]+/(\\?size=[a-z0-9-]+)?$"));
        expect(one(it, "image_link"), id).toMatch(/^https:\/\/rempireshop\.com\/shop\/img\/[^?]+\.webp(\?v=\d+)?$/);
        for (const extra of it.fields.additional_image_link ?? []) expect(extra).toMatch(/^https:\/\//);
        expect((it.fields.additional_image_link ?? []).length).toBeLessThanOrEqual(10);
        expect(["in_stock", "out_of_stock"]).toContain(one(it, "availability"));
        expect(one(it, "price"), id).toMatch(/^\d+\.\d{2} EUR$/);
        expect(euros(one(it, "price")!)).toBeGreaterThan(0);
        expect(one(it, "brand"), id).toBeTruthy();
        expect(one(it, "condition")).toBe("new");
        expect(it.fields.tax).toBeUndefined();
        expect(it.fields.sale_price).toBeUndefined();
        expect(it.shipping.length, id).toBeGreaterThan(0);
      }
    }
  });

  it("speak the feed's language: translated type tails and sizes, the language's own texts", async () => {
    const en = byProduct((await feed("en")).list, SHAMPOO);
    const et = byProduct((await feed("et")).list, SHAMPOO);
    const ru = byProduct((await feed("ru")).list, SHAMPOO);
    expect(en.map((it) => one(it, "title"))).toEqual([
      "System 4 Bio Botanical Shampoo — shampoo, 75 ml",
      "System 4 Bio Botanical Shampoo — shampoo, 250 ml",
      "System 4 Bio Botanical Shampoo — shampoo, 500 ml",
    ]);
    expect(one(et[0], "title")).toBe("System 4 Bio Botanical Shampoo — šampoon, 75 ml");
    expect(one(ru[0], "title")).toBe("System 4 Bio Botanical Shampoo — шампунь, 75 мл");
    expect(one(en[0], "product_type")).toBe("Hair care");
    expect(one(et[0], "product_type")).toBe("Juuksehooldus");
    expect(one(ru[0], "product_type")).toBe("Уход за волосами");
    expect(one(en[0], "description")).toMatch(/^Shampoo for thinning hair\./);
    expect(one(ru[0], "description")).toMatch(/^Шампунь для редеющих волос\./);
    expect(one(et[0], "description")).not.toMatch(/[а-яё]/i);
    // no Russian type tail survives into an English or Estonian title
    for (const lang of ["en", "et"] as const) {
      const odd = (await feed(lang)).list.map((it) => one(it, "title")!).filter((t) => / — [^—]*[а-яё]/i.test(t));
      expect(odd).toEqual([]);
    }
  });

  it("uses the owner's own description for the language he wrote one in", async () => {
    await setDescriptionOverride(GATSBY, { EN: "My own words.\n\nSecond paragraph." });
    const en = byProduct((await feed("en")).list, GATSBY)[0];
    expect(one(en, "description")).toBe("My own words. Second paragraph.");
    const et = byProduct((await feed("et")).list, GATSBY)[0];
    expect(one(et, "description")).not.toBe("My own words. Second paragraph.");
    expect(one(et, "description")!.length).toBeGreaterThan(20);
  });
});

/* ---------- prices and stock, against the checkout ------------------------ */

describe("prices and availability", () => {
  it("are the checkout's own, size by size, with the owner's overrides in play", async () => {
    // «Цена» on a product with a ladder: every size keeps its premium over the base
    await upsertOverride(SHAMPOO, { price: 10 });
    // his own ladder replaces the file's outright
    await upsertOverride(SERUM, { sizes: [{ size: "100 мл", price: 12.5 }, { size: "300 мл", price: 30 }] });
    // «нет в наличии» on a product without sizes
    await upsertOverride(GATSBY, { stock: "out" });
    // one size counted to zero: that size is refused at the checkout, its sibling is not
    await setQty(NIGHT_RIDER, "100 г", 0, { reason: "adjust" });
    await setQty(NIGHT_RIDER, "30 г", 7, { reason: "adjust" });

    const { list } = await feed("ru");
    const shampoo = byProduct(list, SHAMPOO);
    expect(shampoo.map((it) => [one(it, "size"), one(it, "price")])).toEqual([
      ["75 мл", "10.00 EUR"],
      ["250 мл", "17.00 EUR"],
      ["500 мл", "26.00 EUR"],
    ]);
    const serum = byProduct(list, SERUM);
    expect(serum.map((it) => [one(it, "size"), one(it, "price")])).toEqual([
      ["100 мл", "12.50 EUR"],
      ["300 мл", "30.00 EUR"],
    ]);
    expect(byProduct(list, GATSBY).map((it) => one(it, "availability"))).toEqual(["out_of_stock"]);
    expect(byProduct(list, NIGHT_RIDER).map((it) => [one(it, "size"), one(it, "availability")])).toEqual([
      ["30 г", "in_stock"],
      ["100 г", "out_of_stock"],
    ]);

    /* …and the same answers from priceItems() itself, over these and the
       first forty untouched non-merch products: the price it charges for an
       item the feed says is in stock, its refusal for one the feed says is
       not. The RU feed prints the size label exactly as an order line
       carries it. */
    const sample = new Set([SHAMPOO, SERUM, GATSBY, NIGHT_RIDER, TOUCHABLE, LONG,
      ...CATALOGUE.filter((p) => p.c !== "merch").slice(0, 40).map((p) => p.id)]);
    let checked = 0;
    for (const it of list) {
      const id = productOf(it);
      if (!sample.has(id)) continue;
      const label = one(it, "size") ?? null;
      const answer = await checkout(id, label);
      if (one(it, "availability") === "out_of_stock") expect(answer, `${id} ${label}`).toBe("out_of_stock");
      else expect(answer, `${id} ${label}`).toBe(euros(one(it, "price")!));
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("without overrides are the catalogue files' own", async () => {
    const { list } = await feed("ru");
    for (const p of CATALOGUE) {
      const mine = byProduct(list, p.id);
      const ladder = VARIANTS[p.id];
      if (ladder) {
        expect(mine.map((it) => euros(one(it, "price")!)), p.id).toEqual(ladder.prices);
      } else {
        expect(mine.map((it) => euros(one(it, "price")!)), p.id).toEqual([p.p]);
      }
      const want = p.s === "out" ? "out_of_stock" : "in_stock";
      for (const it of mine) expect(one(it, "availability"), p.id).toBe(want);
    }
  });

  it("leave hidden products and switched-off custom products out entirely", async () => {
    await upsertOverride(PRORASO, { hidden: true });
    const photo = { url: "https://img.rempireshop.com/products/c-x/1.webp", thumb: "https://img.rempireshop.com/products/c-x/1-t.webp", alt: "" };
    const shown = await createCustomProduct({
      brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", subcat: "ba",
      sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9], gallery: [photo],
      description: { RU: "Бальзам для бороды.", EN: "A beard balm." },
    });
    const off = await createCustomProduct({ brand: "Davines", name: "Old Shampoo", cat: "hair", sizes: [], prices: [12], gallery: [photo] });
    await setCustomProductActive(off.id, false);
    const photoless = await createCustomProduct({ brand: "Davines", name: "No Photo Yet", cat: "hair", sizes: [], prices: [12] });
    const hiddenCustom = await createCustomProduct({ brand: "Davines", name: "Hidden One", cat: "hair", sizes: [], prices: [12], gallery: [photo] });
    await upsertOverride(hiddenCustom.id, { hidden: true });

    for (const lang of ["en", "et", "ru"] as const) {
      const { xml, list } = await feed(lang);
      expect(byProduct(list, PRORASO)).toEqual([]);
      expect(xml).not.toContain(`/p/${PRORASO}/`);
      expect(byProduct(list, off.id)).toEqual([]);
      expect(byProduct(list, hiddenCustom.id)).toEqual([]);
      // a product with no photo Merchant Center can read is left out, not sent to be disapproved
      expect(byProduct(list, photoless.id)).toEqual([]);
      const custom = byProduct(list, shown.id);
      expect(custom.map((it) => one(it, "price"))).toEqual(["14.90 EUR", "24.90 EUR"]);
      expect(custom.map((it) => one(it, "image_link"))).toEqual([photo.url, photo.url]);
      expect(new Set(custom.map((it) => one(it, "item_group_id"))).size).toBe(1);
    }
    const en = byProduct((await feed("en")).list, shown.id);
    expect(one(en[0], "description")).toBe("A beard balm.");
    expect(one(en[0], "title")).toBe("Proraso Beard Balm — balm for beard, 100 ml");
  });
});

/* ---------- shipping ---------------------------------------------------- */

describe("shipping", () => {
  const cheapest = (rules: ShippingRules, country: string, method: "parcel" | "courier", subtotal: number) => {
    const carriers = offeredCarriers(country, method);
    return Math.min(...(carriers.length ? carriers : [undefined]).map(
      (carrier) => quoteFromRules(rules, { country, method, carrier, subtotal }).price,
    ));
  };

  it("is quoteFromRules() over the stored rules, per item, threshold and switched-off countries included", async () => {
    await setSetting("shipping_rules", {
      freeFrom: 59,
      freeFromByCountry: { EU: 200 },
      methods: { courier: { EE: 12.34 } },
      countriesOff: ["CH", "CY", "GB", "IS", "LI", "MT", "NO", "DE"],
      pickupOff: ["FI"],
    });
    resetShippingRulesCache();
    const rules = (await loadShippingRules())!;
    expect(rules.methods.courier.EE).toBe(12.34);

    const { list } = await feed("en");
    const cheap = byProduct(list, GATSBY)[0]; // 15 €
    const dear = list.find((it) => euros(one(it, "price")!) >= 59 && euros(one(it, "price")!) < 200)!;
    expect(dear).toBeTruthy();

    for (const it of [cheap, dear]) {
      const price = euros(one(it, "price")!);
      const got = (country: string, service: string) =>
        it.shipping.find((s) => s.country === country && s.service === service)?.price;
      // Estonia: the owner's courier cell, the cheapest carrier's locker — or nothing, from 59 €
      expect(got("EE", "Courier")).toBe(`${cheapest(rules, "EE", "courier", price).toFixed(2)} EUR`);
      expect(got("EE", "Parcel locker")).toBe(`${cheapest(rules, "EE", "parcel", price).toFixed(2)} EUR`);
      expect(got("LV", "Parcel locker")).toBe(`${cheapest(rules, "LV", "parcel", price).toFixed(2)} EUR`);
      expect(got("PL", "Courier")).toBe(`${cheapest(rules, "PL", "courier", price).toFixed(2)} EUR`);
      // Finland's lockers are switched off: a courier, no locker
      expect(got("FI", "Parcel locker")).toBeUndefined();
      expect(got("FI", "Courier")).toBe(`${cheapest(rules, "FI", "courier", price).toFixed(2)} EUR`);
      // Germany is switched off, and so are the seven Montonio cannot reach
      for (const off of ["DE", "CH", "GB", "NO"]) expect(it.shipping.some((s) => s.country === off), off).toBe(false);
    }
    expect(cheap.shipping.find((s) => s.country === "EE" && s.service === "Courier")!.price).toBe("12.34 EUR");
    // 59 € and up ships free in the home countries, not in the rest of Europe below 200 €
    expect(dear.shipping.filter((s) => ["EE", "LV", "LT", "FI"].includes(s.country)).every((s) => s.price === "0.00 EUR")).toBe(true);
    expect(dear.shipping.find((s) => s.country === "PL" && s.service === "Courier")!.price).not.toBe("0.00 EUR");
  });

  it("names every country the checkout offers and no other", () => {
    const countries = sellCountries(DEFAULT_SHIPPING_RULES);
    expect(countries.slice(0, 4)).toEqual(["EE", "LV", "LT", "FI"]);
    expect(countries).toHaveLength(25);
    for (const off of DEFAULT_SHIPPING_RULES.countriesOff ?? []) expect(countries).not.toContain(off);
    const options = shippingFor(15, DEFAULT_SHIPPING_RULES);
    expect(new Set(options.map((o) => o.country))).toEqual(new Set(countries));
    // a courier everywhere; a locker wherever the checkout has one (not Greece)
    for (const c of countries) expect(options.some((o) => o.country === c && o.service === "courier"), c).toBe(true);
    expect(options.some((o) => o.country === "GR" && o.service === "parcel")).toBe(false);
    expect(shippingFor(250, DEFAULT_SHIPPING_RULES).every((o) => o.price === 0)).toBe(true);
  });
});

/* ---------- links ------------------------------------------------------- */

describe("links", () => {
  for (const base of [STAGING, "http://localhost:3300", undefined, "https://rempireshop-web.vercel.app"]) {
    it(`point at the live shop when PUBLIC_BASE_URL is ${base ?? "unset"}`, async () => {
      if (base === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = base;
      for (const lang of ["en", "et", "ru"] as const) {
        const { xml } = await feed(lang);
        const urls = [...xml.matchAll(/https?:\/\/[^<\s"]+/g)].map((m) => m[0]).filter((u) => !u.startsWith("http://base.google.com/"));
        expect(urls.length).toBeGreaterThan(300);
        for (const u of urls) expect(u.startsWith(LIVE + "/"), u).toBe(true);
        expect(xml).not.toMatch(/localhost|diipsolutions|vercel\.app|127\.0\.0\.1/);
      }
    });
  }

  it("follow PUBLIC_BASE_URL when it is the live domain itself", () => {
    expect(feedBase("https://www.rempireshop.com/")).toBe("https://www.rempireshop.com");
    expect(feedBase(LIVE)).toBe(LIVE);
    expect(feedBase(STAGING)).toBe(LIVE);
    expect(feedBase(undefined)).toBe(LIVE);
  });
});

/* ---------- variants, ids, identifiers ----------------------------------- */

describe("variants and identifiers", () => {
  it("group a product's sizes under one item_group_id, each with its own id and size", async () => {
    const { list } = await feed("en");
    for (const [id, ladder] of Object.entries(VARIANTS)) {
      const mine = byProduct(list, id);
      expect(mine.length, id).toBe(ladder.sizes.length);
      if (ladder.sizes.length === 1) {
        expect(mine[0].fields.item_group_id, id).toBeUndefined();
        continue;
      }
      const groups = new Set(mine.map((it) => one(it, "item_group_id")));
      expect(groups.size, id).toBe(1);
      const group = [...groups][0]!;
      expect(group.length).toBeLessThanOrEqual(MAX_ID);
      expect(new Set(mine.map((it) => one(it, "id"))).size, id).toBe(ladder.sizes.length);
      for (const it of mine) {
        expect(one(it, "id")!.startsWith(group + "_"), one(it, "id")).toBe(true);
        expect(it.fields.size ?? it.fields.color, one(it, "id")).toBeTruthy();
      }
    }
    // a product with no sizes is one item, on its own id
    const gatsby = byProduct(list, GATSBY);
    expect(gatsby).toHaveLength(1);
    expect(one(gatsby[0], "id")).toBe(GATSBY);
    expect(gatsby[0].fields.item_group_id).toBeUndefined();
    // a one-size product is one item too, its size named
    const touchable = byProduct(list, TOUCHABLE);
    expect(touchable.map((it) => [one(it, "id"), one(it, "title"), one(it, "size")])).toEqual([
      [TOUCHABLE, "Kevin.Murphy Touchable, 250 ml", "250 ml"],
    ]);
    // the long id: shortened, hashed, the size still readable on the end
    const long = byProduct(list, LONG).map((it) => one(it, "id")!);
    expect(long).toEqual([idStem(LONG, 6) + "_75ml", idStem(LONG, 6) + "_150ml", idStem(LONG, 6) + "_500ml"]);
    expect(long.every((i) => i.length <= MAX_ID)).toBe(true);
    // unit prices for a volume, apparel attributes for a T-shirt
    expect(one(byProduct(list, SHAMPOO)[1], "unit_pricing_measure")).toBe("250ml");
    const tee = byProduct(list, TEE);
    expect(one(tee[0], "color")).toBe("white");
    expect(one(tee[0], "size")).toBe("S");
    expect(one(tee[0], "gender")).toBe("unisex");
    expect(one(tee[0], "age_group")).toBe("adult");
    expect(one(tee[0], "google_product_category")).toBe("Apparel & Accessories > Clothing");
  });

  it("send a barcode Renat bound as g:gtin, and identifier_exists=no only for the shop's own brand", async () => {
    await setLevel(SHAMPOO, "250 мл", { ean: "8032248150157" }); // not a real product's code — just a valid EAN-13
    await setLevel(GATSBY, "", { ean: "4902806423112" });
    await setLevel(SERUM, "50 мл", { ean: "RMP-0001" }); // the shop's own internal label, not a GTIN
    const { list } = await feed("en");
    const shampoo = byProduct(list, SHAMPOO);
    expect(shampoo.map((it) => one(it, "gtin") ?? null)).toEqual([null, "8032248150157", null]);
    expect(one(byProduct(list, GATSBY)[0], "gtin")).toBe("4902806423112");
    expect(byProduct(list, SERUM)[0].fields.gtin).toBeUndefined();
    // no GTIN and a manufacturer's brand: nothing claimed either way
    expect(byProduct(list, SERUM)[0].fields.identifier_exists).toBeUndefined();
    // the shop's own goods have no manufacturer barcode to find
    expect(one(byProduct(list, BUTTERFLY)[0], "identifier_exists")).toBe("no");
    for (const it of list) if (one(it, "brand") !== "Rempire") expect(it.fields.identifier_exists, one(it, "id")).toBeUndefined();
  });
});

describe("the small rules", () => {
  it("validGtin(): lengths, check digits and the restricted ranges", () => {
    expect(validGtin("4006381333931")).toBe("4006381333931"); // EAN-13
    expect(validGtin("4006381333932")).toBeNull(); // wrong check digit
    expect(validGtin("036000291452")).toBe("036000291452"); // UPC-A
    expect(validGtin("96385074")).toBe("96385074"); // EAN-8
    expect(validGtin("10036000291459")).toBe("10036000291459"); // GTIN-14
    expect(validGtin("2012345678903")).toBeNull(); // in-store range
    expect(validGtin("0000000000000")).toBeNull();
    expect(validGtin("RMP-0001")).toBeNull();
    expect(validGtin("12345")).toBeNull();
    expect(validGtin(null)).toBeNull();
  });

  it("ids: at most 50 characters, stable, one stem per product", () => {
    expect(merchantId(idStem(SHAMPOO, 7), "250ml")).toBe("system-4-bio-botanical-shampoo_250ml");
    const long = "a".repeat(70);
    const stem = idStem(long);
    expect(stem.length).toBe(MAX_ID);
    expect(idStem(long)).toBe(stem);
    expect(idStem("a".repeat(69) + "b")).not.toBe(stem);
    expect(merchantId(idStem(long, 12), "yellow-xxl").length).toBeLessThanOrEqual(MAX_ID);
    expect(merchantId("x".repeat(45), "a-very-long-size-label").length).toBeLessThanOrEqual(MAX_ID);
    expect(sizeSlug("250 мл")).toBe("250ml");
    expect(sizeSlug("7,5 мл")).toBe("7-5ml");
    expect(sizeSlug("white / S")).toBe("white-s");
    expect(apparelOf("yellow / XXL")).toEqual({ color: "yellow", size: "XXL" });
    expect(apparelOf("white-1")).toEqual({ color: "white" });
    expect(apparelOf("S-M")).toEqual({ size: "S-M" });
    expect(apparelOf("250 мл")).toBeNull();
  });

  it("keeps characters XML cannot carry out of the feed, and escapes the rest", () => {
    const bad = String.fromCharCode(1) + String.fromCharCode(0xfffe);
    const row = {
      id: "c-test-bad-chars", brand: "Davines & Co", name: "Odd" + bad + " <Name>", cat: "hair", subcat: "",
      sizes: [], prices: [12], description: { EN: "Text" + bad + " & more" }, seo: null,
      gallery: [{ url: "https://img.rempireshop.com/products/c-test/1.webp", thumb: "", alt: "" }],
      active: true, createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z",
    };
    const { xml } = buildFeed({
      overrides: {}, descriptions: {}, custom: [row as never], eans: {}, rules: DEFAULT_SHIPPING_RULES,
      lang: "EN", base: LIVE,
    });
    expect(xml).not.toContain(String.fromCharCode(1));
    expect(xml).not.toContain(String.fromCharCode(0xfffe));
    expect(xml).toContain("<g:title>Davines &amp; Co Odd &lt;Name&gt;</g:title>");
    expect(xml).toContain("<g:description>Text &amp; more</g:description>");
    assertWellFormed(xml);
  });

  it("buildFeed() is pure: the same input, the same feed", () => {
    const input = { overrides: {}, descriptions: {}, custom: [], eans: {}, rules: DEFAULT_SHIPPING_RULES };
    const now = new Date("2026-09-23T12:00:00Z");
    const a = buildFeed({ ...input, lang: "EN", base: LIVE, now });
    const b = buildFeed({ ...input, lang: "EN", base: LIVE, now });
    expect(a.xml).toBe(b.xml);
    expect(a.stats.items).toBe(CATALOGUE.reduce((n, p) => n + (VARIANTS[p.id]?.sizes.length ?? 1), 0));
    expect(a.stats.skippedNoImage).toEqual([]);
  });
});

/* ---------- each size opens on itself ---------------------------------------- */

/** A function of public/shop2/app.js by name, braces balanced — the storefront side of the link. */
function appFunction(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}()`);
}

describe("a size's link opens the page on that size", () => {
  const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  const shop = new Function(
    "safeDecode",
    `${appFunction(app, "sizeSlug")}\n${appFunction(app, "sizeFromQuery")}\nreturn { sizeSlug, sizeFromQuery };`,
  )((s: string) => decodeURIComponent(s)) as {
    sizeSlug: (l: string) => string;
    sizeFromQuery: (p: { sizes?: string[] }, q: string) => number | null;
  };

  it("slugs every size label exactly as the feed does", () => {
    const labels = Object.values(VARIANTS).flatMap((v) => v.sizes);
    expect(labels.length).toBeGreaterThan(50);
    for (const l of labels) expect(shop.sizeSlug(l), l).toBe(sizeSlug(l));
  });

  it("finds the size each feed link names, on every product with sizes", async () => {
    const { list } = await feed("ru");
    let checked = 0;
    for (const it of list) {
      const link = one(it, "link")!;
      const q = link.match(/\?size=.*$/);
      if (!q) continue;
      const id = decodeURIComponent(link.match(/\/p\/([^/?]+)\//)![1]);
      const sizes = VARIANTS[id]?.sizes ?? [];
      const at = shop.sizeFromQuery({ sizes }, q[0]);
      expect(at, link).not.toBeNull();
      expect(one(it, "id"), link).toMatch(new RegExp("_" + q[0].slice(6).replace(/-/g, "\\-") + "$"));
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("leaves the page as it was for an address with no size or an unknown one", () => {
    expect(shop.sizeFromQuery({ sizes: ["100 мл", "250 мл"] }, "")).toBeNull();
    expect(shop.sizeFromQuery({ sizes: ["100 мл", "250 мл"] }, "?size=999ml")).toBeNull();
    expect(shop.sizeFromQuery({ sizes: ["100 мл", "250 мл"] }, "?size=250ml")).toBe(1);
    expect(shop.sizeFromQuery({ sizes: ["", ""] }, "?size=v2")).toBe(1);
  });
});
