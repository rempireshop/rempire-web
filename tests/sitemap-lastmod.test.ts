/**
 * A sitemap's `lastmod` is the day of a real edit, or nothing (09.10.2026).
 *
 * Before: src/app/sitemap-products.xml/route.ts wrote today on every product
 * the owner had never edited — 477 of 660 rows said «changed today», every
 * day — and tools/prerender-shop2.mjs stamped the build's day on every row of
 * the static sitemap and of the index, at every deploy. Google uses the field
 * only while it keeps proving true; a date that is always today teaches it to
 * ignore the rows where it is.
 *
 * After: a catalogue product carries its override's day, a custom product its
 * own, an article its last edit (else its publication), the blog listing the
 * newest article; everything else carries none. Every case here is written
 * from fixed stamps — no clock — so the expected value never depends on the
 * day the suite runs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { newestPostDay, postDay, sitemapDay, sitemapUrlEntry } from "@/lib/seo-head.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const LIVE = "https://rempireshop.com";
const CATALOGUE = catalogueMin as Array<{ id: string }>;

/* The three readers the two routes ask, answered from fixed rows. */
const fixtures = vi.hoisted(() => ({
  overrides: {} as Record<string, { updatedAt?: string | null; hidden?: boolean; stock?: string | null }>,
  custom: [] as Array<{ id: string; updatedAt: string }>,
  posts: [] as Array<{ slug: string; updatedAt?: string | null; publishedAt?: string | null }>,
}));
vi.mock("@/lib/orders", () => ({ getOverrides: async () => fixtures.overrides }));
vi.mock("@/lib/custom-products", () => ({ listCustomSitemapRows: async () => fixtures.custom }));
vi.mock("@/lib/blog", () => ({ listPublished: async () => ({ posts: fixtures.posts }) }));
vi.mock("@/lib/blog-page", () => ({
  postsNotPrerendered: (posts: Array<{ slug: string }>, slugs: string[]) => posts.filter((p) => !slugs.includes(p.slug)),
}));

const rows = (xml: string) => xml.split("<url>").slice(1);
const locOf = (row: string) => (/<loc>([^<]+)<\/loc>/.exec(row) || [])[1];
const dayOf = (row: string) => (/<lastmod>([^<]*)<\/lastmod>/.exec(row) || [])[1];

describe("sitemapUrlEntry()", () => {
  it("writes the element only for a day it was given", () => {
    expect(sitemapUrlEntry(LIVE, "/gift/", "ru", "0.6", "2026-09-30")).toContain("    <lastmod>2026-09-30</lastmod>\n");
    for (const none of ["", undefined, null]) {
      const row = sitemapUrlEntry(LIVE, "/gift/", "ru", "0.6", none);
      expect(row).not.toContain("lastmod");
      // the rest of the row is untouched: loc, the cluster, the priority
      expect(locOf(row)).toMatch(/^https:\/\/rempireshop\.com\/ru\/\S+$/);
      expect((row.match(/<xhtml:link/g) || []).length).toBe(4);
      expect(row).toContain("<priority>0.6</priority>");
    }
  });
});

describe("the day of a stamp", () => {
  it("keeps an ISO string's own day, as the routes always sliced it", () => {
    expect(sitemapDay("2026-09-30T23:59:59.000Z")).toBe("2026-09-30");
    expect(sitemapDay("2026-09-30")).toBe("2026-09-30");
    expect(sitemapDay(new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-01");
  });

  it("says nothing for no stamp, or for something that is not a date", () => {
    for (const bad of [null, undefined, "", "yesterday", "2026-13-45", new Date("nope"), "Fri Oct 09 2026"]) {
      expect(sitemapDay(bad), String(bad)).toBe("");
    }
  });

  it("an article: its last edit, else its publication — and the listing the newest of them", () => {
    expect(postDay({ updatedAt: "2026-09-20T08:00:00Z", publishedAt: "2026-09-01T08:00:00Z" })).toBe("2026-09-20");
    expect(postDay({ updatedAt: null, publishedAt: "2026-09-01T08:00:00Z" })).toBe("2026-09-01");
    expect(postDay({})).toBe("");
    expect(newestPostDay([
      { updatedAt: "2026-08-02T00:00:00Z" }, { publishedAt: "2026-09-14T00:00:00Z" }, {},
    ])).toBe("2026-09-14");
    expect(newestPostDay([])).toBe("");
    expect(newestPostDay([{}])).toBe("");
  });
});

describe("GET /sitemap-products.xml", () => {
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = LIVE;
    fixtures.overrides = {};
  });

  it("dates no product nobody has edited", async () => {
    const { GET } = await import("@/app/sitemap-products.xml/route");
    const xml = await (await GET()).text();
    expect(rows(xml)).toHaveLength(CATALOGUE.length * 3);
    expect(xml).not.toContain("<lastmod>");
  });

  it("dates an edited product by the owner's edit, in all three languages, and nothing else", async () => {
    const [a, b] = CATALOGUE;
    fixtures.overrides = {
      [a.id]: { updatedAt: "2026-09-30T10:00:00.000Z" },
      // an override row with no stamp (an old row, a stock word folded in) is no date either
      [b.id]: { stock: "low", updatedAt: null },
    };
    const { GET } = await import("@/app/sitemap-products.xml/route");
    const dated = rows(await (await GET()).text()).filter((r) => dayOf(r) !== undefined);
    expect(dated.map(locOf).sort()).toEqual([
      `${LIVE}/et/products/${a.id}`, `${LIVE}/products/${a.id}`, `${LIVE}/ru/products/${a.id}`,
    ]);
    expect(dated.map(dayOf)).toEqual(["2026-09-30", "2026-09-30", "2026-09-30"]);
  });
});

describe("GET /sitemap-custom.xml", () => {
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = LIVE;
    fixtures.custom = [];
    fixtures.posts = [];
  });

  it("a custom product its own edit; an article its own day; the listing the newest; an undated article none", async () => {
    fixtures.custom = [{ id: "c-acme-balm", updatedAt: "2026-09-12T09:00:00.000Z" }];
    fixtures.posts = [
      { slug: "zima", updatedAt: "2026-09-20T08:00:00.000Z", publishedAt: "2026-09-01T08:00:00.000Z" },
      { slug: "leto", updatedAt: null, publishedAt: "2026-08-15T08:00:00.000Z" },
      { slug: "bez-daty", updatedAt: null, publishedAt: null },
    ];
    const { GET } = await import("@/app/sitemap-custom.xml/route");
    const all = rows(await (await GET()).text());
    const ru = Object.fromEntries(all.filter((r) => locOf(r).startsWith(`${LIVE}/ru/`)).map((r) => [locOf(r), dayOf(r)]));
    expect(ru).toEqual({
      [`${LIVE}/ru/products/c-acme-balm`]: "2026-09-12",
      [`${LIVE}/ru/blogs/news`]: "2026-09-20",
      [`${LIVE}/ru/blogs/news/zima`]: "2026-09-20",
      [`${LIVE}/ru/blogs/news/leto`]: "2026-08-15",
      [`${LIVE}/ru/blogs/news/bez-daty`]: undefined,
    });
    expect(all).toHaveLength(15);
  });
});

describe("the static sitemap the build writes", () => {
  const PRERENDER = read("../tools/prerender-shop2.mjs");
  /* the code between the sitemap and robots headings, without its comments —
     which quote the very words checked for */
  const sitemapPart = PRERENDER.slice(PRERENDER.indexOf("/* ---------- sitemap"), PRERENDER.indexOf("/* ---------- robots"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never stamps the run's own day — on a row or on the index", () => {
    expect(sitemapPart).toContain("sitemapindex");
    expect(sitemapPart).not.toMatch(/new Date\(\)/);
    expect(sitemapPart).not.toMatch(/\btoday\b/);
    expect(sitemapPart).not.toContain("<lastmod>");
  });

  it("dates the blog rows only, from the articles themselves", () => {
    expect(sitemapPart).toContain('urlEntry("/blog/", lang.seg, "0.7", BLOG_DAY)');
    expect(sitemapPart).toContain('lang.seg, "0.6", postDay(post))');
    expect(sitemapPart).toContain("const BLOG_DAY = newestPostDay(BLOG_POSTS);");
    // every other row takes the default: no date
    const calls = sitemapPart.match(/urlEntry\([^\n]*\);?/g) || [];
    const dated = calls.filter((c) => /BLOG_DAY|postDay/.test(c));
    expect(dated).toHaveLength(2);
  });

  it("the build's own checker fails a row that dates anything but the blog", () => {
    const check = read("../tools/check-prerender.mjs");
    expect(check).toContain("a page with no day of its own");
    expect(check).toContain("sitemapindex dates its rows");
  });
});
