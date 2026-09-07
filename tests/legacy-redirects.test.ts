/**
 * src/lib/legacy-redirects.ts — the old Shopify addresses → the new shop.
 *
 * Two fixtures, both real: `docs/redirect-map.csv` (1 638 rows, the whole
 * Shopify URL space as it was exported) and the URLs Search Console recorded
 * impressions for in the week of 29.08–05.09.2026, which are the ones that
 * actually cost something if they break (docs/audit/2026-09-07-seo.md).
 *
 * Pure functions, no database, no network — the middleware that calls this is
 * eight lines and is covered end to end by e2e/seo.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { legacyTarget, slugify } from "@/lib/legacy-redirects";

const ROOT = path.join(__dirname, "..");
const IDS = new Set((catalogueMin as Array<{ id: string }>).map((p) => p.id));
const BRANDS = new Set((catalogueMin as Array<{ b: string }>).map((p) => slugify(p.b)));

/** The map, as `old path (no origin) → the row's own suggestion`. */
function mapRows(): Array<{ old: string; neu: string; kind: string }> {
  const lines = readFileSync(path.join(ROOT, "docs", "redirect-map.csv"), "utf8").trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === "," && !quoted) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    return {
      old: cells[0].replace(/^https:\/\/rempireshop\.com/, "") || "/",
      neu: cells[1] || "",
      kind: cells[2] || "",
    };
  });
}

/* Every /shop2/ path this file can produce has to be one the shop really
   serves. The shapes are fixed (docs/seo.md, "URL scheme"), so they are
   checked structurally rather than against 813 files on disk — the prerender's
   own checker does that half. */
const CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch", "all"];
function assertServable(target: string, from: string) {
  const [pathname] = target.split("?");
  const m = /^\/shop2(?:\/(et|en))?\/(.*)$/.exec(pathname);
  expect(m, from + " → " + target + " is not a /shop2/ path").toBeTruthy();
  const rest = "/" + (m as RegExpExecArray)[2];
  if (rest === "/") return;
  let ok = false;
  let mm: RegExpExecArray | null;
  if ((mm = /^\/p\/([^/]+)\/$/.exec(rest))) ok = IDS.has(decodeURIComponent(mm[1]));
  else if ((mm = /^\/c\/([^/]+)\/$/.exec(rest))) ok = CATS.includes(mm[1]);
  else if ((mm = /^\/b\/([^/]+)\/$/.exec(rest))) ok = BRANDS.has(mm[1]);
  else if ((mm = /^\/info\/([^/]+)\/$/.exec(rest))) ok = ["shipping", "returns", "terms", "privacy", "contact"].includes(mm[1]);
  else ok = ["/blog/", "/brands/", "/search/", "/account/", "/sets/", "/gift/"].includes(rest);
  expect(ok, from + " → " + target + " is not a page the shop serves").toBe(true);
}

describe("the shapes Shopify served", () => {
  it("sends a product handle that is a catalogue id straight to its page", () => {
    expect(legacyTarget("/products/system-4-bio-botanical-shampoo")).toEqual({
      path: "/shop2/p/system-4-bio-botanical-shampoo/",
      reason: "product",
    });
  });

  it("keeps the language the searcher picked", () => {
    /* Russian is the shop's default and has no prefix — going to /shop2/ru/…
       would only be 301ed again by next.config.ts. */
    expect(legacyTarget("/ru/products/system-4-bio-botanical-serum")?.path)
      .toBe("/shop2/p/system-4-bio-botanical-serum/");
    expect(legacyTarget("/et/products/system-4-bio-botanical-serum")?.path)
      .toBe("/shop2/et/p/system-4-bio-botanical-serum/");
    /* The three regional English storefronts collapse onto the one the shop has. */
    for (const prefix of ["en-lv", "en-lt", "en-fi", "en"]) {
      expect(legacyTarget(`/${prefix}/products/xerjoff-1861-naxos-eau-de-parfum-100ml`)?.path)
        .toBe("/shop2/en/p/xerjoff-1861-naxos-eau-de-parfum-100ml/");
    }
  });

  it("answers a bare language prefix with that language's home page", () => {
    expect(legacyTarget("/ru")).toEqual({ path: "/shop2/", reason: "home" });
    expect(legacyTarget("/et")).toEqual({ path: "/shop2/et/", reason: "home" });
    expect(legacyTarget("/en-fi/")).toEqual({ path: "/shop2/en/", reason: "home" });
  });

  it("decodes a handle Shopify escaped — «barberism%C2%AE» is one product, not a 404", () => {
    expect(legacyTarget("/products/captain-fawcett-barberism%C2%AE-beard-oil")?.path)
      .toBe("/shop2/p/captain-fawcett-barberism-beard-oil/");
    expect(legacyTarget("/ru/products/captain-fawcett-barberism%C2%AE-beard-oil")?.path)
      .toBe("/shop2/p/captain-fawcett-barberism-beard-oil/");
  });

  it("sends a discontinued product to the nearest thing the shop still sells", () => {
    /* «kevin murphy blow dry ever thicken» still earns a click at position 3.8
       and EVER.THICKEN is gone; EVER.SMOOTH is the line's survivor. */
    expect(legacyTarget("/products/blow-dry-ever-thicken")).toEqual({
      path: "/shop2/p/blow-dry-ever-smooth/",
      reason: "product-alias",
    });
    /* An unknown handle that names a brand we carry goes to that brand. */
    expect(legacyTarget("/products/lumin-skin-something-we-never-had")).toEqual({
      path: "/shop2/b/lumin-skin/",
      reason: "product-brand",
    });
    /* And one that names nothing goes to the whole catalogue, never a 404. */
    expect(legacyTarget("/products/montblanc-explorer-shower-gel-150ml")).toEqual({
      path: "/shop2/c/all/",
      reason: "product-unknown",
    });
  });

  it("maps a collection to a brand page or to a section", () => {
    expect(legacyTarget("/collections/system-4")).toEqual({ path: "/shop2/b/system-4/", reason: "collection-brand" });
    expect(legacyTarget("/collections/cbd-daily-haircare")?.path).toBe("/shop2/b/cbd-daily/");
    expect(legacyTarget("/et/collections/habemeolid")?.path).toBe("/shop2/et/c/beard/");
    expect(legacyTarget("/collections/korean-cosmetics")?.path).toBe("/shop2/c/face/");
    expect(legacyTarget("/collections/vse-tovary")?.path).toBe("/shop2/c/all/");
    expect(legacyTarget("/collections/top-brands")?.path).toBe("/shop2/brands/");
    expect(legacyTarget("/collections")?.path).toBe("/shop2/c/all/");
    expect(legacyTarget("/collections/a-collection-nobody-remembers")).toEqual({
      path: "/shop2/c/all/",
      reason: "collection-unknown",
    });
  });

  it("reads Shopify's other product URL, /collections/<x>/products/<handle>", () => {
    expect(legacyTarget("/collections/system-4/products/system-4-bio-botanical-shampoo")?.path)
      .toBe("/shop2/p/system-4-bio-botanical-shampoo/");
    expect(legacyTarget("/et/collections/kevin-murphy/products/night-rider")?.path)
      .toBe("/shop2/et/p/night-rider/");
  });

  it("maps the policy and page URLs onto the five info pages", () => {
    expect(legacyTarget("/policies/refund-policy")?.path).toBe("/shop2/info/returns/");
    expect(legacyTarget("/policies/shipping-policy")?.path).toBe("/shop2/info/shipping/");
    expect(legacyTarget("/policies/contact-information")?.path).toBe("/shop2/info/contact/");
    expect(legacyTarget("/pages/right-to-return")?.path).toBe("/shop2/info/returns/");
    expect(legacyTarget("/et/pages/contact")?.path).toBe("/shop2/et/info/contact/");
    expect(legacyTarget("/pages/something-else")).toEqual({ path: "/shop2/info/contact/", reason: "info-unknown" });
  });

  it("sends the old blog to the new one", () => {
    expect(legacyTarget("/blogs/news")?.path).toBe("/shop2/blog/");
    expect(legacyTarget("/et/blogs/news/the-ultimate-guide-on-how-to-moisturize-your-skin-for-a-healthy-glow")?.path)
      .toBe("/shop2/et/blog/");
  });

  it("keeps the shopper's own words on /search and drops everything else", () => {
    expect(legacyTarget("/search", "?q=gatsby%20wax")?.path).toBe("/shop2/search/?q=gatsby%20wax");
    expect(legacyTarget("/et/search", "?q=vaha&type=product")?.path).toBe("/shop2/et/search/?q=vaha");
    expect(legacyTarget("/search")?.path).toBe("/shop2/search/");
  });

  it("leaves everything that is not a Shopify shape alone", () => {
    for (const p of ["/", "/shop2/", "/shop2/p/night-rider/", "/api/overrides/", "/sitemap.xml", "/robots.txt", "/favicon.ico"]) {
      expect(legacyTarget(p), p).toBeNull();
    }
  });
});

describe("docs/redirect-map.csv — all 1 638 rows", () => {
  const rows = mapRows();

  /* 1 639, not the 1 638 docs/seo.md says: the file ends without a newline,
     so `wc -l` counts one line fewer than it holds. */
  it("has the rows the audit counted", () => {
    expect(rows.length).toBe(1639);
  });

  /* The two rows that are not a Shopify storefront shape and are deliberately
     not this file's business: the site root, which next.config.ts's
     `redirects()` owns, and a stray `/agents.md` that was never a page. */
  const NOT_OURS = ["/", "/agents.md"];

  it("resolves every row to a page the shop serves", () => {
    for (const row of rows) {
      const hit = legacyTarget(row.old);
      if (NOT_OURS.includes(row.old)) {
        expect(hit, row.old + " is not ours to redirect").toBeNull();
        continue;
      }
      expect(hit, row.old + " has no target").toBeTruthy();
      assertServable((hit as { path: string }).path, row.old);
    }
  });

  it("beats the map on the rows the map gave up on", () => {
    /* 1 447 of the 1 638 rows say «/shop/» — the home page — including every
       /ru/products/… and /et/products/… row, which is the traffic worth
       keeping. Those must resolve to something better than a home page here. */
    const gaveUp = rows.filter((r) => r.neu === "/shop/" && /\/products\/[^/]+$/.test(r.old));
    expect(gaveUp.length).toBeGreaterThan(600);
    let real = 0;
    for (const row of gaveUp) {
      const hit = legacyTarget(row.old);
      if (hit && /\/p\/[^/]+\/$/.test(hit.path)) real++;
    }
    /* Better than nine in ten of them land on the product's own page. */
    expect(real / gaveUp.length).toBeGreaterThan(0.9);
  });

  it("never sends a language-prefixed URL to another language", () => {
    for (const row of rows) {
      const hit = legacyTarget(row.old);
      if (!hit) continue;
      const want = /^\/et\//.test(row.old) || row.old === "/et" ? "/shop2/et/"
        : /^\/en-(lv|lt|fi)\//.test(row.old) || /^\/en-(lv|lt|fi)$/.test(row.old) ? "/shop2/en/"
        : "/shop2/";
      expect(hit.path.startsWith(want), row.old + " → " + hit.path).toBe(true);
    }
  });
});

describe("the URLs Search Console has impressions for", () => {
  /* The 25 addresses that carried the most impressions in 29.08–05.09.2026,
     verbatim from the export, query strings and all. Every one of them has to
     land on a real page — these are the rankings the switch puts at risk. */
  const RANKING: Array<[string, string]> = [
    ["/products/gatsby-moving-rubber-hair-wax-80g?variant=48667959099731&country=AE&currency=EUR&utm_medium=product_sync&utm_source=google", "/shop2/p/gatsby-moving-rubber-hair-wax-80g/"],
    ["/products/gatsby-moving-rubber-grunge-mat-grey-hair-wax", "/shop2/p/gatsby-moving-rubber-grunge-mat-grey-hair-wax/"],
    ["/products/mandom-gatsby-moving-rubber?variant=50333058761043&country=AE&currency=EUR", "/shop2/p/mandom-gatsby-moving-rubber/"],
    ["/products/system-4-bio-botanical-shampoo", "/shop2/p/system-4-bio-botanical-shampoo/"],
    ["/ru/products/system-4-bio-botanical-serum", "/shop2/p/system-4-bio-botanical-serum/"],
    ["/ru/products/system-4-special-shampoo-1", "/shop2/p/system-4-special-shampoo-1/"],
    ["/products/sim-sensitive-system-4-oil-cure-scalp-treatment-o", "/shop2/p/sim-sensitive-system-4-oil-cure-scalp-treatment-o/"],
    ["/products/davines-calming-shampoo?variant=49021602922835&country=AE&currency=EUR", "/shop2/p/davines-calming-shampoo/"],
    ["/products/anti-gravity-spray?variant=46940962783571", "/shop2/p/anti-gravity-spray/"],
    ["/collections/system-4", "/shop2/b/system-4/"],
    ["/collections/lumin-skin", "/shop2/b/lumin-skin/"],
    ["/collections/kevin-murphy", "/shop2/b/kevin-murphy/"],
    ["/et/collections/habemeolid", "/shop2/et/c/beard/"],
    ["/et", "/shop2/et/"],
    ["/ru", "/shop2/"],
    ["/et/products/hair-resort-spray", "/shop2/et/p/hair-resort-spray/"],
    ["/products/night-rider", "/shop2/p/night-rider/"],
    ["/products/oversized-t-shirt-unisex-with-print", "/shop2/p/oversized-t-shirt-unisex-with-print/"],
    ["/et/products/maxi-wash", "/shop2/et/p/maxi-wash/"],
    ["/products/touchable?variant=46826646143315&country=AE&currency=EUR", "/shop2/p/touchable/"],
    ["/ru/products/sim-sensitive-system-4-chitosan-hair-repair-r", "/shop2/p/sim-sensitive-system-4-chitosan-hair-repair-r/"],
    ["/products/proraso-wood-spice-beard-balm-100ml", "/shop2/p/proraso-wood-spice-beard-balm-100ml/"],
    ["/en-lv/products/xerjoff-1861-naxos-eau-de-parfum-100ml", "/shop2/en/p/xerjoff-1861-naxos-eau-de-parfum-100ml/"],
    ["/policies/shipping-policy", "/shop2/info/shipping/"],
    ["/et/pages/contact", "/shop2/et/info/contact/"],
  ];

  it.each(RANKING)("%s → %s", (from, want) => {
    const [pathname, search] = from.split("?");
    const hit = legacyTarget(pathname, search ? "?" + search : "");
    expect(hit?.path).toBe(want);
  });

  it("collapses the ?variant=…&utm_… duplicates onto one address", () => {
    /* 121 of the 473 ranking URLs carry Shopify's product-feed query, and 61
       paths are indexed under more than one address because of it. One target
       for all of them is the whole point. */
    const feed = "?variant=48667959099731&country=AE&currency=EUR&utm_medium=product_sync&utm_source=google&utm_content=sag_organic&utm_campaign=sag_organic";
    const plain = legacyTarget("/products/gatsby-moving-rubber-hair-wax-80g")?.path;
    const withQuery = legacyTarget("/products/gatsby-moving-rubber-hair-wax-80g", feed)?.path;
    expect(withQuery).toBe(plain);
    expect(withQuery).not.toContain("?");
    expect(legacyTarget("/collections/system-4", "?page=2")?.path).toBe("/shop2/b/system-4/");
  });

  it("answers the trailing-slash form the same way", () => {
    for (const p of ["/products/night-rider", "/collections/system-4", "/et/pages/contact", "/blogs/news"]) {
      expect(legacyTarget(p + "/")?.path, p).toBe(legacyTarget(p)?.path);
    }
  });
});
