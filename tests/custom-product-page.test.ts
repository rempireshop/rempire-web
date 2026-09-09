/**
 * A product the owner created in the panel, everywhere the catalogue file
 * used to be the only source (db/migrations/131_custom_products.sql):
 *
 *   · its page at request time — src/lib/product-page.ts behind
 *     src/app/shop2/{,et/,en/}p/[id]/route.ts — carries the head the
 *     prerender writes for a catalogue product (title, description,
 *     canonical, hreflang, OpenGraph, Product JSON-LD with an offer), from
 *     the row's RU/ET/EN fields with the Russian fallback; hidden → 404 and
 *     noindex; a catalogue id → the shell;
 *   · the sitemap the app serves (src/app/sitemap-custom.xml/route.ts)
 *     lists the active rows in three languages and leaves the hidden out;
 *   · «Сообщить о наличии» takes a custom id and the back-in-stock letter
 *     names the product (src/lib/customers.ts, src/lib/flows.ts);
 *   · «Аналитика» and «Обзор» name it instead of printing a bare `c-…` id
 *     (src/lib/analytics.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAnalyticsSummary, getOverviewSummary } from "@/lib/analytics";
import { createCustomProduct, setCustomProductActive } from "@/lib/custom-products";
import { addStockAlert, cartSnapshot, productsForAlerts } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { runBackInStock, sweepBackInStock } from "@/lib/flows";
import { createOrder, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const LIVE = "https://rempireshop.com";
const NOW = new Date("2026-06-15T12:00:00Z");

/** Every letter Resend was asked to send since the last reset. */
const sent: Array<{ subject: string; to: string[]; text: string; html: string }> = [];
function mockResend() {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { subject: string; to: string[]; text?: string; html?: string };
    sent.push({ subject: body.subject, to: body.to, text: body.text ?? "", html: body.html ?? "" });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = LIVE;
  await setupDb();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
});
afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  await teardownDb();
});
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  sent.length = 0;
  mockResend();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // posts too: the app's sitemap now names the posts the build did not write (tests/blog-page.test.ts)
  await exec(
    "truncate custom_products, product_overrides, stock_alerts, orders, events, settings, carts, customers, admin_audit, posts restart identity cascade",
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- fixtures ------------------------------------------------------ */

const BALM = {
  brand: "Proraso",
  name: "Beard Balm — бальзам для бороды",
  cat: "beard",
  subcat: "ba",
  sizes: ["100 мл", "250 мл"],
  prices: [14.9, 24.9],
  description: { RU: "Бальзам для бороды.\n\nСмягчает и укладывает.", ET: "Habemepalsam." },
  seo: {
    RU: { title: "Proraso бальзам для бороды — купить", desc: "Бальзам Proraso в Rempire." },
    EN: { title: "Proraso beard balm — buy in Tallinn" },
  },
  gallery: [{ url: "https://cdn.example.com/p/balm.webp", thumb: "https://cdn.example.com/p/balm-t.webp", alt: "" }],
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string) => new Request(LIVE + path);

async function pageFor(seg: "" | "et" | "en", id: string): Promise<Response> {
  const mod = seg === "et"
    ? await import("@/app/shop2/et/p/[id]/route")
    : seg === "en"
      ? await import("@/app/shop2/en/p/[id]/route")
      : await import("@/app/shop2/p/[id]/route");
  return mod.GET(req(`/shop2${seg ? "/" + seg : ""}/p/${id}/`), ctx(id));
}

const title = (html: string) => (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "";
const meta = (html: string, key: string) =>
  (html.match(new RegExp(`<meta (?:name|property)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)"`)) || [])[1] ?? "";
const link = (html: string, attrs: string) => (html.match(new RegExp(`<link ${attrs}[^>]*href="([^"]*)"`)) || [])[1] ?? "";
function ldBlocks(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json"([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({
    attrs: m[1],
    ...(JSON.parse(m[2]) as Record<string, unknown>),
  }));
}

async function setFlows(patch: Record<string, unknown>): Promise<void> {
  await query(
    `insert into settings (key, value) values ('flows', $1::jsonb) on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(patch)],
  );
}

/* ---------- the page ------------------------------------------------------ */

describe("a custom product's page at request time", () => {
  it("ET: the head the prerender writes, from the row — Russian pair as the fallback, Estonian text where there is one", async () => {
    const p = await createCustomProduct(BALM);
    const res = await pageFor("et", p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();

    expect(html).toMatch(/^<!doctype html>\n<html lang="et">/);
    // the owner wrote no Estonian pair: the Russian one serves the Estonian page, fitted the way app.js fits it
    expect(title(html)).toBe("Proraso бальзам для бороды — купить — REMPIRE");
    expect(meta(html, "description")).toBe("Бальзам Proraso в Rempire.");
    expect(meta(html, "robots")).toBe("index, follow, max-image-preview:large");
    expect(link(html, 'rel="canonical"')).toBe(`${LIVE}/shop2/et/p/${p.id}/`);
    expect(link(html, 'rel="alternate" hreflang="ru"')).toBe(`${LIVE}/shop2/p/${p.id}/`);
    expect(link(html, 'rel="alternate" hreflang="et"')).toBe(`${LIVE}/shop2/et/p/${p.id}/`);
    expect(link(html, 'rel="alternate" hreflang="en"')).toBe(`${LIVE}/shop2/en/p/${p.id}/`);
    expect(link(html, 'rel="alternate" hreflang="x-default"')).toBe(`${LIVE}/shop2/p/${p.id}/`);
    expect(meta(html, "og:type")).toBe("product");
    expect(meta(html, "og:locale")).toBe("et_EE");
    expect(meta(html, "og:url")).toBe(`${LIVE}/shop2/et/p/${p.id}/`);
    expect(meta(html, "og:title")).toBe(title(html));
    // uploads are WebP, which no link scraper reads: the card is the shop's
    // own 1 200×630 PNG drawn from the row at request time (tests/og-card.test.ts)
    expect(meta(html, "og:image")).toBe(`${LIVE}/shop2/og/${p.id}.png?v=${Date.parse(p.updatedAt).toString(36)}`);
    expect(meta(html, "twitter:image")).toBe(meta(html, "og:image"));
    expect(meta(html, "og:image:type")).toBe("image/png");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");

    const ld = ldBlocks(html);
    const product = ld.find((o) => o["@type"] === "Product") as Record<string, unknown> & { offers: Record<string, unknown>; brand: { name: string } };
    expect(product).toBeTruthy();
    expect(product.attrs).toContain('id="ldjson"');
    expect(product.name).toBe("Proraso Beard Balm — бальзам для бороды");
    expect(product.brand.name).toBe("Proraso");
    expect(product.sku).toBe(p.id);
    expect(product.category).toBe("Habemehooldus");
    expect(product.description).toBe("Habemepalsam.");
    expect(product.image).toEqual(["https://cdn.example.com/p/balm.webp"]);
    expect(product.url).toBe(`${LIVE}/shop2/et/p/${p.id}/`);
    expect(product.offers).toMatchObject({
      "@type": "Offer", priceCurrency: "EUR", price: "14.9",
      availability: "https://schema.org/InStock", url: `${LIVE}/shop2/et/p/${p.id}/`,
    });
    const crumbs = ld.find((o) => o["@type"] === "BreadcrumbList") as Record<string, unknown> & { itemListElement: Array<{ name: string }> };
    expect(crumbs.attrs).toContain('data-seo="ldjson-page"');
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(["Avaleht", "Habemehooldus", "Proraso Beard Balm — бальзам для бороды"]);

    // the screen itself, for a crawler that reads the body: brand, h1, «from» price, sizes, the Estonian description
    expect(html).toContain('<div id="prerender">');
    expect(html).toContain('<h1 class="pdp__title">Beard Balm — бальзам для бороды</h1>');
    expect(html).toContain("alates 14,90 €");
    expect(html).toContain("<li>100 мл · <span class=\"num\">14,90 €</span></li>");
    expect(html).toContain("<li>250 мл · <span class=\"num\">24,90 €</span></li>");
    expect(html).toContain('<div class="acc__rich"><p>Habemepalsam.</p></div>');
    expect(html).toContain(`href="/shop2/et/b/proraso/"`);
    // the shell's own assets travel unchanged
    expect(html).toContain('<script src="/shop2/app.min.js?v=');
    expect(html).toContain("<!-- seo:end -->");
  });

  it("EN: the owner's English title, the Russian description as the fallback for the meta, the Russian text in the JSON-LD", async () => {
    const p = await createCustomProduct(BALM);
    const html = await (await pageFor("en", p.id)).text();
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(title(html)).toBe("Proraso beard balm — buy in Tallinn — REMPIRE");
    expect(meta(html, "description")).toBe("Бальзам Proraso в Rempire.");
    expect(meta(html, "og:locale")).toBe("en_US");
    expect(link(html, 'rel="canonical"')).toBe(`${LIVE}/shop2/en/p/${p.id}/`);
    const product = ldBlocks(html).find((o) => o["@type"] === "Product") as Record<string, unknown>;
    expect(product.category).toBe("Beard care");
    expect(product.description).toBe("Бальзам для бороды. Смягчает и укладывает.");
    expect(html).toContain("from 14,90 €");
    expect(html).toContain("<p>Бальзам для бороды.</p><p>Смягчает и укладывает.</p>");
  });

  it("RU with no pair builds the title from the product; a stock override reaches the offer and the chip; an override price reaches both", async () => {
    const p = await createCustomProduct({ ...BALM, seo: null });
    let html = await (await pageFor("", p.id)).text();
    expect(html).toMatch(/^<!doctype html>\n<html lang="ru">/);
    /* The title ladder's middle rung and the description's tail, both added
       07.09.2026 (src/lib/seo-head.mjs fitTitle()/descFrom(),
       docs/audit/2026-09-07-seo.md): the full sentence «… — купить в Rempire ·
       от 14,90 €» is 62 characters, so the price rides on the short form
       instead of «— REMPIRE», and a description cut from the product's own
       text ends on what a shopper is deciding about. */
    expect(title(html)).toBe("Proraso Beard Balm — бальзам для бороды · от 14,90 €");
    expect(meta(html, "description")).toBe(
      "Бальзам для бороды. Смягчает и укладывает · от 14,90 € · в наличии · доставка по Эстонии и Балтии",
    );
    expect(link(html, 'rel="canonical"')).toBe(`${LIVE}/shop2/p/${p.id}/`);
    expect(html).toContain('<span class="chip chip--ok">В наличии</span>');

    await upsertOverride(p.id, { stock: "out", price: 12 });
    html = await (await pageFor("", p.id)).text();
    const product = ldBlocks(html).find((o) => o["@type"] === "Product") as { offers: Record<string, unknown> };
    expect(product.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(product.offers.price).toBe("12");
    expect(html).toContain('<span class="chip chip--out">нет в наличии</span>');
    expect(html).toContain("от 12 €");
  });

  it("a product with no text at all still has a description, built from price, section and stock", async () => {
    const p = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    const html = await (await pageFor("et", p.id)).text();
    expect(title(html)).toBe("Acme Wax — osta Rempire'ist · 9 €");
    expect(meta(html, "description")).toBe("9 € · Viimistlus · Laos. Rempire'i pood, Tallinn — tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.");
    const product = ldBlocks(html).find((o) => o["@type"] === "Product") as Record<string, unknown>;
    // no photo yet: the JSON-LD points at the shop's card rather than at an SVG placeholder Google cannot read
    expect(product.image).toEqual([`${LIVE}/brand/og-default.png`]);
    expect(html).not.toContain('class="acc__rich"');
  });

  it("a staging base writes noindex and its own absolute URLs — the one switch docs/seo.md describes", async () => {
    process.env.PUBLIC_BASE_URL = "https://rempireshop.diipsolutions.eu";
    const p = await createCustomProduct(BALM);
    const html = await (await pageFor("et", p.id)).text();
    expect(meta(html, "robots")).toBe("noindex, nofollow");
    expect(link(html, 'rel="canonical"')).toBe(`https://rempireshop.diipsolutions.eu/shop2/et/p/${p.id}/`);
    expect(meta(html, "og:image")).toMatch(new RegExp(`^https://rempireshop\\.diipsolutions\\.eu/shop2/og/${p.id}\\.png\\?v=[0-9a-z]+$`));
  });

  it("hidden → 404 with the noindex shell; unknown `c-…` → 404; a catalogue id → the shell, 200", async () => {
    const p = await createCustomProduct(BALM);
    await setCustomProductActive(p.id, false);
    for (const seg of ["", "et", "en"] as const) {
      const res = await pageFor(seg, p.id);
      expect(res.status, seg || "ru").toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain('<div id="app">');
      expect(html).not.toContain(p.id);
    }
    const missing = await pageFor("et", "c-no-such-product");
    expect(missing.status).toBe(404);

    const catalogue = await pageFor("", "system-4-bio-botanical-shampoo");
    expect(catalogue.status).toBe(200);
    const shell = await catalogue.text();
    expect(shell).toContain("<!-- seo:start -->");
    expect(shell).toContain('<div id="app">');
    // the shell is the Russian home page, untouched: its own title, no Product block
    expect(title(shell)).toBe("REMPIRE — магазин косметики в Таллинне");
    expect(shell).not.toContain('id="ldjson"');
  });
});

/* ---------- the sitemap --------------------------------------------------- */

describe("sitemap-custom.xml", () => {
  it("lists every active custom product in three languages with its hreflang cluster, and not the hidden ones", async () => {
    const a = await createCustomProduct(BALM);
    const b = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    await setCustomProductActive(b.id, false);

    const { GET } = await import("@/app/sitemap-custom.xml/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${LIVE}/shop2/p/${a.id}/`, `${LIVE}/shop2/et/p/${a.id}/`, `${LIVE}/shop2/en/p/${a.id}/`]);
    expect((xml.match(/<xhtml:link/g) || []).length).toBe(12);
    expect(xml).toContain(`<lastmod>${a.updatedAt.slice(0, 10)}</lastmod>`);
    expect(xml).not.toContain(b.id);
  });

  it("is an empty, valid urlset when there is nothing to list", async () => {
    const { GET } = await import("@/app/sitemap-custom.xml/route");
    const xml = await (await GET()).text();
    expect(xml).toMatch(/<urlset [^>]*>\n<\/urlset>\n$/);
  });
});

/* ---------- «Сообщить о наличии» ------------------------------------------ */

describe("stock alerts for a custom product", () => {
  it("takes an active custom id, refuses a hidden one and an id nobody has", async () => {
    const p = await createCustomProduct(BALM);
    expect(await addStockAlert({ email: "shopper@example.com", productId: p.id, lang: "ET" })).toBe(true);
    expect(await query("select * from stock_alerts")).toHaveLength(1);
    expect(await addStockAlert({ email: "shopper@example.com", productId: "c-nobody-has-this" })).toBe(false);
    await setCustomProductActive(p.id, false);
    expect(await addStockAlert({ email: "other@example.com", productId: p.id })).toBe(false);
    expect(await query("select * from stock_alerts")).toHaveLength(1);
  });

  it("resolves the letter's name, brand, price and photo from the row", async () => {
    const p = await createCustomProduct(BALM);
    const known = await productsForAlerts([p.id, "system-4-bio-botanical-shampoo", "c-nobody-has-this"]);
    expect(known.get(p.id)).toEqual({
      id: p.id, brand: "Proraso", name: "Beard Balm — бальзам для бороды", price: 14.9, stock: "in",
      img: "https://cdn.example.com/p/balm.webp",
    });
    expect(known.get("system-4-bio-botanical-shampoo")).toMatchObject({ brand: "System 4", img: null });
    expect(known.has("c-nobody-has-this")).toBe(false);
  });

  it("the sweep waits for the owner's stock switch and then writes one letter that names the product", async () => {
    await setFlows({ backstock: true });
    const p = await createCustomProduct(BALM);
    await addStockAlert({ email: "shopper@example.com", productId: p.id, lang: "ET" });
    await query("insert into product_overrides (product_id, stock) values ($1, 'out')", [p.id]);
    expect((await sweepBackInStock()).sent).toBe(0);

    await query("update product_overrides set stock = 'in' where product_id = $1", [p.id]);
    expect((await sweepBackInStock()).sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["shopper@example.com"]);
    expect(sent[0].text).toContain("Proraso Beard Balm — бальзам для бороды");
    expect(sent[0].text).toContain(`${LIVE}/shop2/et/p/${p.id}/`);
    // once
    expect((await sweepBackInStock()).sent).toBe(0);
  });

  it("fires from the admin's own stock switch on a custom id, like on a catalogue one", async () => {
    await setFlows({ backstock: true });
    const p = await createCustomProduct(BALM);
    await addStockAlert({ email: "shopper@example.com", productId: p.id, lang: "RU" });
    await upsertOverride(p.id, { stock: "out" });
    expect(sent).toHaveLength(0);
    await upsertOverride(p.id, { stock: "in" });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(`${LIVE}/shop2/p/${p.id}/`);
    expect((await runBackInStock(p.id)).sent).toBe(0);
  });

  it("a cart with a custom line is snapshotted from the row — the abandoned-cart letter can name it", async () => {
    const p = await createCustomProduct(BALM);
    const hidden = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    await setCustomProductActive(hidden.id, false);
    const snap = await cartSnapshot([
      { id: p.id, size: 1, qty: 2 },
      { id: hidden.id, qty: 1 },
      { id: "c-nobody-has-this", qty: 1 },
    ]);
    expect(snap.items).toEqual([
      { id: p.id, title: "Beard Balm — бальзам для бороды", brand: "Proraso", variant: "250 мл", size: 1, qty: 2, price: 24.9 },
    ]);
    expect(snap.total).toBe(49.8);
  });
});

/* ---------- analytics ----------------------------------------------------- */

describe("analytics names a custom product", () => {
  const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

  it("top products by revenue and by views, «смотрят, но не покупают», low stock — a name and a brand, never a bare id", async () => {
    const p = await createCustomProduct(BALM);
    const wax = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    const o = await createOrder({ lang: "ru", items: [{ id: p.id, qty: 1 }], customer, shipping: { method: "parcel", country: "EE" } });
    const at = new Date(NOW.getTime() - 86_400_000).toISOString();
    await query("update orders set status = 'paid', created_at = $2, updated_at = $2 where id = $1", [o.id, at]);
    for (const [sid, productId] of [["s1", p.id], ["s2", wax.id], ["s3", wax.id]]) {
      await query(
        "insert into events (at, sid, type, path, product_id) values ($1, $2, 'product', $3, $4)",
        [at, sid, `/shop2/p/${productId}/`, productId],
      );
    }
    await query("insert into product_overrides (product_id, stock) values ($1, 'low')", [wax.id]);

    const s = await getAnalyticsSummary("7d", NOW);
    expect(s.topProductsByRevenue[0]).toMatchObject({ id: p.id, name: "Beard Balm — бальзам для бороды", brand: "Proraso" });
    expect(s.topProductsByViews.map((r) => [r.id, r.name, r.brand, r.views])).toEqual([
      [wax.id, "Wax", "Acme", 2],
      [p.id, "Beard Balm — бальзам для бороды", "Proraso", 1],
    ]);
    // the balm was bought, the wax only looked at
    expect(s.viewedNotBought.map((r) => [r.id, r.name, r.brand])).toEqual([[wax.id, "Wax", "Acme"]]);
    expect(s.lowStock).toEqual([{ id: wax.id, name: "Wax", brand: "Acme", stock: "low" }]);
    expect(s.brandRevenue[0].brand).toBe("Proraso");
    for (const list of [s.topProductsByRevenue, s.topProductsByViews, s.viewedNotBought, s.lowStock]) {
      for (const row of list) expect(row.name, row.id).not.toMatch(/^c-/);
    }
  });

  it("«Обзор» counts a custom product among «Заканчиваются» and drops an id nobody has", async () => {
    const wax = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    await query("insert into product_overrides (product_id, stock) values ($1, 'out'), ('c-gone-for-good', 'out')", [wax.id]);
    const ov = await getOverviewSummary(NOW);
    expect(ov.lowStock).toEqual({ total: 1, out: 1, low: 0, items: [{ id: wax.id, name: "Wax", brand: "Acme", stock: "out" }] });
  });
});
