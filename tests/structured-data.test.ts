/**
 * The structured data a product page carries — and the shop-wide policy the
 * Organization block carries — held to Google's product snippet / merchant
 * listing requirements and to the Merchant Center feed it must agree with.
 *
 *   · one Offer per size, each with the feed's own price, availability, item
 *     id (sku) and `?size=` link (src/lib/merchant-feed.ts feedOffers());
 *   · `shippingDetails` per offer from shippingFor() — the very call the
 *     feed's g:shipping entries come from — with the feed's handling and
 *     transit days;
 *   · `hasMerchantReturnPolicy` with only what the returns policy says
 *     (public/shop/legal.{ru,et,en}.js «returns»), for the countries the feed
 *     sells to;
 *   · a gtin only for a barcode with a valid check digit;
 *   · breadcrumbs on the new addresses;
 *   · the Organization's shipping service, map and opening hours.
 *
 * Everything is parsed back out of the JSON the page would carry (ldJson()),
 * not inspected as objects, so what is checked is what Google reads.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  breadcrumbLD,
  langByCode,
  langPath,
  ldJson,
  openingHoursLD,
  productSpec,
  RETURN_POLICY,
  returnPolicyLD,
  shippingDetailsLD,
  shippingServiceLD,
  STORE_GEO,
  STORE_MAP_URL,
  STORE_SAME_AS,
} from "@/lib/seo-head.mjs";
import {
  feedOffers,
  HANDLING_DAYS,
  sellCountries,
  shippingFor,
  shippingTerms,
  transitFor,
  validGtin,
} from "@/lib/merchant-feed";
import { DEFAULT_SHIPPING_RULES, quoteFromRules } from "@/lib/shipping";

type Json = Record<string, unknown>;
type Offer = Json & {
  price: string; priceCurrency: string; availability: string; url: string; sku?: string;
  shippingDetails?: Array<Json & {
    shippingRate: { value: number; currency: string };
    shippingDestination: Array<{ "@type": string; addressCountry: string }>;
    deliveryTime?: { handlingTime: Json; transitTime: Json };
  }>;
  hasMerchantReturnPolicy?: Json;
};

const BASE = "https://rempireshop.com";
const RULES = DEFAULT_SHIPPING_RULES;
const SHAMPOO = "system-4-bio-botanical-shampoo"; // 75 / 250 / 500 мл at 9 / 16 / 25 €

/** The page's JSON-LD as Google would read it: through the same serialiser, back through JSON.parse. */
const roundTrip = (o: unknown) => JSON.parse(ldJson(o)) as Json;

/** What Google lists as required (or as needed for the merchant listing) on a Product and its offers. */
function productProblems(ld: Json): string[] {
  const out: string[] = [];
  if (ld["@context"] !== "https://schema.org") out.push("no @context");
  if (ld["@type"] !== "Product") out.push("not a Product");
  if (!ld.name) out.push("no name");
  if (!Array.isArray(ld.image) || !(ld.image as unknown[]).length) out.push("no image");
  // Search Console «Invalid string length in field "sku"» (10.10.2026): at most 50
  if (ld.sku !== undefined && !(typeof ld.sku === "string" && ld.sku.length >= 1 && ld.sku.length <= 50)) out.push("sku " + ld.sku);
  const offers = (Array.isArray(ld.offers) ? ld.offers : [ld.offers]) as Offer[];
  if (!offers.length || !offers[0]) out.push("no offers");
  offers.forEach((o, i) => {
    const at = `offer ${i}: `;
    if (o["@type"] !== "Offer") out.push(at + "not an Offer");
    if (!(Number(o.price) > 0) || !/^\d+(\.\d{1,2})?$/.test(String(o.price))) out.push(at + "price " + o.price);
    if (o.priceCurrency !== "EUR") out.push(at + "currency " + o.priceCurrency);
    if (o.sku !== undefined && !(o.sku.length >= 1 && o.sku.length <= 50)) out.push(at + "sku " + o.sku);
    if (!/^https:\/\/schema\.org\/(InStock|OutOfStock)$/.test(o.availability)) out.push(at + "availability " + o.availability);
    if (o.itemCondition !== "https://schema.org/NewCondition") out.push(at + "itemCondition");
    if (!/^https:\/\//.test(o.url)) out.push(at + "url " + o.url);
    for (const d of o.shippingDetails ?? []) {
      if (d["@type"] !== "OfferShippingDetails") out.push(at + "shipping type");
      if (d.shippingRate?.currency !== "EUR" || !(d.shippingRate.value >= 0)) out.push(at + "shippingRate");
      if (!d.shippingDestination?.length || d.shippingDestination.some((r) => r["@type"] !== "DefinedRegion" || !/^[A-Z]{2}$/.test(r.addressCountry))) {
        out.push(at + "shippingDestination");
      }
      if (d.deliveryTime) {
        for (const k of ["handlingTime", "transitTime"] as const) {
          const q = d.deliveryTime[k] as Json;
          if (q["@type"] !== "QuantitativeValue" || q.unitCode !== "DAY" || !(Number(q.maxValue) >= Number(q.minValue))) out.push(at + k);
        }
      }
    }
    const r = o.hasMerchantReturnPolicy as Json | undefined;
    if (r) {
      if (r["@type"] !== "MerchantReturnPolicy") out.push(at + "return type");
      if (!Array.isArray(r.applicableCountry) || !(r.applicableCountry as unknown[]).length || (r.applicableCountry as unknown[]).length > 50) out.push(at + "applicableCountry");
      if (r.returnPolicyCategory === "https://schema.org/MerchantReturnFiniteReturnWindow" && !(Number(r.merchantReturnDays) > 0)) out.push(at + "merchantReturnDays");
    }
  });
  return out;
}

function shampooCommerce(eans: Record<string, string> = {}) {
  const items = feedOffers({ overrides: {}, descriptions: {}, custom: [] })
    .filter((o) => o.productId === SHAMPOO)
    .map((o) => ({ ...o, gtin: validGtin(eans[o.label ?? ""]) }));
  return {
    offers: items,
    shipping: (price: number) => shippingFor(price, RULES),
    handling: HANDLING_DAYS,
    returnCountries: sellCountries(RULES),
  };
}

function shampooSpec(code: "RU" | "ET" | "EN", commerce?: ReturnType<typeof shampooCommerce>) {
  return productSpec({
    base: BASE, lang: langByCode(code), id: SHAMPOO, cat: "hair", catName: "Hair care",
    brand: "System 4", name: "Bio Botanical Shampoo", price: 9, priceFrom: true, stock: "in",
    seoTitle: "", seoDesc: "", body: "<p>Shampoo.</p>", image: BASE + "/og.png", imageUrls: [BASE + "/shop/img/x.webp"],
    commerce,
  }) as unknown as { jsonld: Json[] };
}

describe("Product JSON-LD: one Offer per size, the feed's", () => {
  it("is valid for a product snippet and a merchant listing, in all three languages", () => {
    for (const code of ["RU", "ET", "EN"] as const) {
      const ld = roundTrip(shampooSpec(code, shampooCommerce()).jsonld[0]);
      expect(productProblems(ld), code).toEqual([]);
    }
  });

  it("carries each size at the feed's price, with the feed's item id and ?size= link", () => {
    const ld = roundTrip(shampooSpec("EN", shampooCommerce()).jsonld[0]);
    const offers = ld.offers as Offer[];
    const feed = feedOffers({ overrides: {}, descriptions: {}, custom: [] }).filter((o) => o.productId === SHAMPOO);
    expect(offers.map((o) => [o.price, o.sku, o.url])).toEqual(
      feed.map((f) => [String(f.price), f.id, `${BASE}/products/${SHAMPOO}?size=${f.slug}`]),
    );
    expect(offers.map((o) => o.price)).toEqual(["9", "16", "25"]);
    expect(ld.url).toBe(`${BASE}/products/${SHAMPOO}`);
    // Russian page: the Russian address, the same ids
    const ru = roundTrip(shampooSpec("RU", shampooCommerce()).jsonld[0]).offers as Offer[];
    expect(ru[1].url).toBe(`${BASE}/ru/products/${SHAMPOO}?size=250ml`);
    expect(ru.map((o) => o.sku)).toEqual(offers.map((o) => o.sku));
  });

  it("says OutOfStock for a size the feed says is gone, InStock for the rest", () => {
    const commerce = shampooCommerce();
    commerce.offers[1] = { ...commerce.offers[1], available: false };
    const offers = roundTrip(shampooSpec("EN", commerce).jsonld[0]).offers as Offer[];
    expect(offers.map((o) => o.availability.replace("https://schema.org/", ""))).toEqual(["InStock", "OutOfStock", "InStock"]);
  });

  it("names the product by its Merchant Center id, never by an id over 50 characters", () => {
    const all = feedOffers({ overrides: {}, descriptions: {}, custom: [] });
    const byProduct = new Map<string, typeof all>();
    for (const o of all) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), o]);
    const long = [...byProduct.keys()].filter((id) => id.length > 50);
    expect(long.length).toBeGreaterThan(0);
    for (const [id, items] of byProduct) {
      const ld = roundTrip(productSpec({
        base: BASE, lang: langByCode("EN"), id, cat: "hair", catName: "Hair care",
        brand: "B", name: "N", price: items[0].price, priceFrom: items.length > 1, stock: "in",
        seoTitle: "", seoDesc: "", body: "", image: BASE + "/og.png", imageUrls: [BASE + "/x.webp"],
        commerce: { offers: items, shipping: (p: number) => shippingFor(p, RULES), handling: HANDLING_DAYS, returnCountries: sellCountries(RULES) },
      }).jsonld[0] as Json);
      expect(productProblems(ld), id).toEqual([]);
      // the feed's g:item_group_id for several sizes, its g:id for one
      expect(ld.sku, id).toBe(items.length > 1 ? items[0].stem : items[0].id);
      // one size and an id that fits: the id itself (several sizes may cut a
      // 49-character id to leave room for «_250ml» — the group id then)
      if (items.length === 1 && id.length <= 50) expect(ld.sku, id).toBe(id);
    }
    // no feed items: the id when it fits, no sku when it does not
    const bare = (id: string) => roundTrip(productSpec({
      base: BASE, lang: langByCode("EN"), id, cat: "hair", catName: "Hair care", brand: "B", name: "N",
      price: 9, priceFrom: false, stock: "in", seoTitle: "", seoDesc: "", body: "", image: BASE + "/og.png", imageUrls: [BASE + "/x.webp"],
    }).jsonld[0] as Json);
    expect(bare(SHAMPOO).sku).toBe(SHAMPOO);
    expect(bare(long[0]).sku).toBeUndefined();
  });

  it("keeps the single Offer it always had when the page has no feed items", () => {
    const ld = roundTrip(shampooSpec("EN").jsonld[0]);
    expect(Array.isArray(ld.offers)).toBe(false);
    expect(ld.offers).toMatchObject({ "@type": "Offer", price: "9", priceCurrency: "EUR", availability: "https://schema.org/InStock" });
    expect(productProblems(ld)).toEqual([]);
  });
});

describe("Offer.shippingDetails: shippingFor(), the feed's own call", () => {
  it("prices every country the feed sells to at the cheapest delivery the feed lists for that price", () => {
    for (const price of [9, 16, 25, 59, 75, 250]) {
      const details = roundTrip({ d: shippingDetailsLD(shippingFor(price, RULES), HANDLING_DAYS) }).d as NonNullable<Offer["shippingDetails"]>;
      const byCountry = new Map<string, number>();
      for (const d of details) for (const r of d.shippingDestination) {
        expect(byCountry.has(r.addressCountry), `${r.addressCountry} twice at ${price} €`).toBe(false);
        byCountry.set(r.addressCountry, d.shippingRate.value);
      }
      expect([...byCountry.keys()].sort()).toEqual(sellCountries(RULES).slice().sort());
      for (const [country, value] of byCountry) {
        const cheapest = Math.min(...shippingFor(price, RULES).filter((o) => o.country === country).map((o) => o.price));
        expect(value, `${country} at ${price} €`).toBe(cheapest);
      }
    }
  });

  it("is free inside Estonia from the threshold the checkout bills by, and not in Germany until 200 €", () => {
    const rate = (price: number, country: string) => {
      const d = shippingDetailsLD(shippingFor(price, RULES), HANDLING_DAYS) as NonNullable<Offer["shippingDetails"]>;
      return d.find((x) => x.shippingDestination.some((r) => r.addressCountry === country))!.shippingRate.value;
    };
    const eeFree = quoteFromRules(RULES, { country: "EE", method: "parcel", subtotal: 0 }).freeFrom as number;
    expect(eeFree).toBe(59);
    expect(rate(58.99, "EE")).toBeGreaterThan(0);
    expect(rate(59, "EE")).toBe(0);
    expect(rate(59, "DE")).toBeGreaterThan(0);
    expect(rate(200, "DE")).toBe(0);
  });

  it("carries the shop's handling days and the carrier's transit days by zone (EE 1–3, LV/LT/FI 2–5, EU 3–8)", () => {
    const details = shippingDetailsLD(shippingFor(20, RULES), HANDLING_DAYS) as NonNullable<Offer["shippingDetails"]>;
    const days = (country: string) => {
      const d = details.find((x) => x.shippingDestination.some((r) => r.addressCountry === country))!;
      const h = d.deliveryTime!.handlingTime as Json;
      const t = d.deliveryTime!.transitTime as Json;
      return [h.minValue, h.maxValue, t.minValue, t.maxValue];
    };
    expect(days("EE")).toEqual([0, 1, 1, 3]);
    expect(days("LV")).toEqual([0, 1, 2, 5]);
    expect(days("FI")).toEqual([0, 1, 2, 5]);
    expect(days("DE")).toEqual([0, 1, 3, 8]);
    expect(transitFor("DE")).toEqual({ min: 3, max: 8 });
  });
});

describe("hasMerchantReturnPolicy: only what the returns policy says", () => {
  const legal = (lang: "ru" | "et" | "en") => {
    const src = readFileSync(fileURLToPath(new URL(`../public/shop/legal.${lang}.js`, import.meta.url)), "utf8");
    const name = "LEGAL_" + lang.toUpperCase();
    const all = new Function(src + "\nreturn " + name + ";")() as Record<string, { html: string }>;
    return all.returns.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  };

  it("is still the text the policy encodes — 30 days from receipt, sent back to the shop in Tallinn, no label from the shop", () => {
    expect(RETURN_POLICY.days).toBe(30);
    const en = legal("en");
    expect(en).toContain("We operate a 30-day returns policy: you may ask to return an item within 30 days of receiving it.");
    expect(en).toContain("Please note that returns have to be sent to: {{address}}");
    expect(en).toContain("The shop does not issue a return label");
    expect(en).toContain("the money goes back automatically to the payment method you originally used");
    expect(en).toContain("in the condition you received it in — unworn or unused, with its tags on, and in its original packaging");
    expect(legal("ru")).toContain("У нас действует 30-дневная политика возврата");
    expect(legal("et")).toContain("Meil kehtib 30-päevane tagastuspoliitika");
  });

  it("says returns are free, in all three languages — the markup's returnFees (Dim, 10.10.2026)", () => {
    expect(legal("en")).toContain("Returns are free: we refund what you paid to post the parcel back, together with the price of the item");
    expect(legal("et")).toContain("Tagastamine on tasuta: hüvitame paki tagasisaatmise postikulu koos kauba hinnaga");
    expect(legal("ru")).toContain("Возврат бесплатный: стоимость обратной пересылки мы возмещаем вместе с ценой товара");
  });

  it("excludes OPENED cosmetics only — an unopened bottle is returnable, so the policy applies to every product", () => {
    expect(legal("en")).toContain("personal-hygiene goods (such as opened cosmetics)");
    expect(legal("en")).toContain("Sealed cosmetics that have been opened cannot be returned once unsealed, for reasons of hygiene.");
    expect(legal("ru")).toContain("средства личной гигиены (например, вскрытая косметика)");
  });

  it("is a finite 30-day window by mail to Estonia, for the countries the feed sells to, with nothing the text does not say", () => {
    const countries = sellCountries(RULES);
    const r = roundTrip(returnPolicyLD(countries, BASE + "/policies/refund-policy"));
    expect(r).toEqual({
      "@type": "MerchantReturnPolicy",
      applicableCountry: countries,
      returnPolicyCountry: "EE",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 30,
      returnMethod: "https://schema.org/ReturnByMail",
      returnLabelSource: "https://schema.org/ReturnLabelCustomerResponsibility",
      returnFees: "https://schema.org/FreeReturn",
      itemCondition: "https://schema.org/NewCondition",
      refundType: "https://schema.org/FullRefund",
      merchantReturnLink: BASE + "/policies/refund-policy",
    });
  });

  it("rides every offer, linked to the refund policy in the page's language", () => {
    const offers = roundTrip(shampooSpec("ET", shampooCommerce()).jsonld[0]).offers as Offer[];
    for (const o of offers) {
      expect(o.hasMerchantReturnPolicy).toMatchObject({ merchantReturnDays: 30, merchantReturnLink: BASE + "/et/policies/refund-policy" });
    }
  });
});

describe("gtin: a barcode with a valid check digit, or nothing", () => {
  it("puts a valid EAN-13 on the offer of its size, and drops one whose check digit is wrong", () => {
    const ld = roundTrip(shampooSpec("EN", shampooCommerce({ "250 мл": "4006381333931", "500 мл": "4006381333932" })).jsonld[0]);
    const offers = ld.offers as Offer[];
    expect(offers[1].gtin13).toBe("4006381333931");
    expect(offers[2]).not.toHaveProperty("gtin13");
    expect(offers[0]).not.toHaveProperty("gtin13");
  });

  it("puts it on the Product itself when the product is sold in one size", () => {
    const commerce = shampooCommerce({ "75 мл": "4006381333931" });
    commerce.offers = commerce.offers.slice(0, 1).map((o) => ({ ...o, slug: "" }));
    const ld = roundTrip(shampooSpec("EN", commerce).jsonld[0]);
    expect(ld.gtin13).toBe("4006381333931");
    expect(Array.isArray(ld.offers)).toBe(false);
    expect((ld.offers as Offer).url).toBe(`${BASE}/products/${SHAMPOO}`);
  });
});

describe("BreadcrumbList on the new addresses", () => {
  it("a product: home, its section, the product — the crumb the page prints", () => {
    const crumbs = roundTrip(shampooSpec("RU", shampooCommerce()).jsonld[1]) as Json & { itemListElement: Array<Json> };
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Главная", item: BASE + "/ru" },
      { "@type": "ListItem", position: 2, name: "Hair care", item: BASE + "/ru/collections/uhod-za-volosami" },
      { "@type": "ListItem", position: 3, name: "System 4 Bio Botanical Shampoo" },
    ]);
  });

  it("a brand: home, «Brands» on /collections/brands, the brand — as the prerender's listingPage() builds it", () => {
    const prerender = readFileSync(fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)), "utf8");
    expect(prerender).toContain('...(kind === "b" ? [[t.brands, langPath(seg, "/brands/")]] : [])');
    expect(langPath("", "/brands/")).toBe("/collections/brands");
    expect(langPath("et", "/brands/")).toBe("/et/collections/brands");
    const ld = roundTrip(breadcrumbLD(BASE, [["Home", langPath("", "/")], ["Brands", langPath("", "/brands/")], ["Proraso", null]])) as { itemListElement: Json[] };
    expect(ld.itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, name: "Brands", item: BASE + "/collections/brands" });
  });

  it("a section and an article: the section's own handle, the blog at /blogs/news", () => {
    expect(langPath("et", "/c/hair/")).toBe("/et/collections/juuksehooldus");
    expect(langPath("", "/blog/")).toBe("/blogs/news");
    expect(langPath("ru", "/blog/x/")).toBe("/ru/blogs/news/x");
  });
});

describe("the Organization: where the shop is, how it ships", () => {
  it("is pinned at Mardi 1 with a map link Google can open", () => {
    expect(STORE_GEO).toEqual({ "@type": "GeoCoordinates", latitude: 59.430905, longitude: 24.759414 });
    expect(STORE_MAP_URL).toBe("https://www.google.com/maps/search/?api=1&query=REMPIRE+Mardi+1+Tallinn");
    expect(STORE_SAME_AS).toContain("https://rempire.ee");
  });

  it("states the delivery terms country by country — the feed's prices, the checkout's thresholds", () => {
    const terms = shippingTerms(RULES);
    expect(terms.map((t) => t.country)).toEqual(sellCountries(RULES));
    const service = roundTrip(shippingServiceLD(terms, HANDLING_DAYS)) as Json & { shippingConditions: Array<Json & {
      shippingDestination: { addressCountry: string }; shippingRate: { value: number; currency: string };
      orderValue?: { minValue?: number; maxValue?: number }; transitTime?: { duration: Json };
    }> };
    expect(service["@type"]).toBe("ShippingService");
    expect(service.handlingTime).toEqual({ "@type": "ServicePeriod", duration: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "d" } });
    const ee = service.shippingConditions.filter((c) => c.shippingDestination.addressCountry === "EE");
    expect(ee.map((c) => [c.orderValue, c.shippingRate.value])).toEqual([
      [{ "@type": "MonetaryAmount", minValue: 0, maxValue: 58.99, currency: "EUR" }, terms[0].price],
      [{ "@type": "MonetaryAmount", minValue: 59, currency: "EUR" }, 0],
    ]);
    const de = service.shippingConditions.filter((c) => c.shippingDestination.addressCountry === "DE");
    expect(de[1].orderValue).toMatchObject({ minValue: 200 });
    expect(de[0].transitTime!.duration).toMatchObject({ minValue: 3, maxValue: 8, unitCode: "d" });
    for (const t of terms) {
      expect(t.price).toBe(Math.min(...shippingFor(0, RULES).filter((o) => o.country === t.country).map((o) => o.price)));
    }
  });

  it("names its opening hours only when the shop has them", () => {
    expect(openingHoursLD({ mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "" })).toEqual([]);
    expect(openingHoursLD({ mon: "10:00–19:00", sat: "11:00-16:00", sun: "closed", tue: "по записи" })).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Monday", opens: "10:00", closes: "19:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Saturday", opens: "11:00", closes: "16:00" },
    ]);
  });
});
