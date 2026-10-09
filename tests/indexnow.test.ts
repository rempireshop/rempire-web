/**
 * IndexNow — the key file, the request, the production-only switch, the CLI's
 * sitemap reader, and the admin routes that tell the engines a page changed
 * (src/lib/indexnow.mjs, src/lib/indexnow-ping.ts, tools/indexnow-submit.mjs).
 * Every POST here goes to a mocked fetch; nothing leaves the machine.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import {
  blogPostUrls,
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_MAX_URLS,
  indexNowBodies,
  indexNowEnabled,
  postIndexNow,
  productUrls,
  setUrls,
  sitemapLocs,
} from "@/lib/indexnow.mjs";
import { indexNowSettled, resetIndexNowMemory, submitIndexNow } from "@/lib/indexnow-ping";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const LIVE = "https://rempireshop.com";
type Call = { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] } };

/** A fetch that records every IndexNow POST and answers the rest (a letter, a push) with an empty 200. */
function mockFetch(status = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url) === INDEXNOW_ENDPOINT) calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(status === 200 ? "" : "nope", { status: String(url) === INDEXNOW_ENDPOINT ? status : 200 });
  });
  return calls;
}

describe("the key", () => {
  it("is a 32-character hex string, served as the whole content of public/<key>.txt", () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
    const file = fileURLToPath(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(INDEXNOW_KEY);
    expect(INDEXNOW_KEY_LOCATION).toBe(`${LIVE}/${INDEXNOW_KEY}.txt`);
  });
});

describe("the addresses a change touches", () => {
  it("a product in all three languages, on Shopify's addresses", () => {
    expect(productUrls("c-proraso-balm")).toEqual([
      `${LIVE}/products/c-proraso-balm`, `${LIVE}/ru/products/c-proraso-balm`, `${LIVE}/et/products/c-proraso-balm`,
    ]);
  });
  it("an article and the blog listing; a set and the sets landing", () => {
    expect(blogPostUrls("beard-oil")).toEqual([
      `${LIVE}/blogs/news/beard-oil`, `${LIVE}/ru/blogs/news/beard-oil`, `${LIVE}/et/blogs/news/beard-oil`,
      `${LIVE}/blogs/news`, `${LIVE}/ru/blogs/news`, `${LIVE}/et/blogs/news`,
    ]);
    expect(setUrls("shave")).toEqual([
      `${LIVE}/collections/sets/shave`, `${LIVE}/ru/collections/sets/shave`, `${LIVE}/et/collections/sets/shave`,
      `${LIVE}/collections/sets`, `${LIVE}/ru/collections/sets`, `${LIVE}/et/collections/sets`,
    ]);
  });
});

describe("the request", () => {
  it("names only rempireshop.com, once each, in batches the protocol accepts", () => {
    const bodies = indexNowBodies([
      `${LIVE}/products/a`, `${LIVE}/products/a`, "https://www.rempireshop.com/products/b",
      "https://rempireshop.diipsolutions.eu/products/c", "http://rempireshop.com/products/d", "not a url", `${LIVE}/ru`,
    ]);
    expect(bodies).toEqual([{
      host: "rempireshop.com", key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: [`${LIVE}/products/a`, `${LIVE}/ru`],
    }]);
    const many = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, i) => `${LIVE}/products/p${i}`);
    expect(indexNowBodies(many).map((b) => b.urlList.length)).toEqual([INDEXNOW_MAX_URLS, 5]);
  });

  it("POSTs JSON to api.indexnow.org and reports each batch's status", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fake = async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("", { status: 202 });
    };
    const results = await postIndexNow(productUrls("x"), { fetch: fake });
    expect(results).toEqual([{ status: 202, count: 3 }]);
    expect(seen[0].url).toBe("https://api.indexnow.org/indexnow");
    expect(seen[0].init.method).toBe("POST");
    expect((seen[0].init.headers as Record<string, string>)["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(String(seen[0].init.body)).urlList).toEqual(productUrls("x"));
  });

  it("is switched on for the production shop only", () => {
    const prod = { NODE_ENV: "production" };
    expect(indexNowEnabled({ ...prod, PUBLIC_BASE_URL: LIVE })).toBe(true);
    expect(indexNowEnabled({ ...prod, PUBLIC_BASE_URL: LIVE, VERCEL_ENV: "production" })).toBe(true);
    expect(indexNowEnabled({ ...prod, PUBLIC_BASE_URL: LIVE, VERCEL_ENV: "preview" })).toBe(false);
    expect(indexNowEnabled({ ...prod, PUBLIC_BASE_URL: "https://rempireshop.diipsolutions.eu" })).toBe(false);
    expect(indexNowEnabled({ ...prod, PUBLIC_BASE_URL: "http://localhost:3300" })).toBe(false);
    expect(indexNowEnabled(prod)).toBe(false);
    // `next dev` and the test suite carry the live base URL all the time — and send nothing
    expect(indexNowEnabled({ NODE_ENV: "development", PUBLIC_BASE_URL: LIVE })).toBe(false);
    expect(indexNowEnabled({ NODE_ENV: "test", PUBLIC_BASE_URL: LIVE })).toBe(false);
    expect(indexNowEnabled({})).toBe(false);
  });
});

describe("the sitemap the CLI reads", () => {
  it("takes the child sitemaps of an index and the <loc> of each <url>, never the alternates", () => {
    const index = '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      `  <sitemap><loc>${LIVE}/sitemap-1.xml</loc></sitemap>\n  <sitemap>\n    <loc>${LIVE}/sitemap-products.xml</loc>\n  </sitemap>\n</sitemapindex>`;
    expect(sitemapLocs(index)).toEqual({ sitemaps: [`${LIVE}/sitemap-1.xml`, `${LIVE}/sitemap-products.xml`], urls: [] });
    const set = '<urlset>\n  <url>\n    <loc>https://rempireshop.com/search?q=a&amp;b=1</loc>\n' +
      '    <xhtml:link rel="alternate" hreflang="ru" href="https://rempireshop.com/ru"/>\n  </url>\n' +
      "  <url><loc>https://rempireshop.com/et</loc></url>\n</urlset>";
    expect(sitemapLocs(set)).toEqual({ sitemaps: [], urls: ["https://rempireshop.com/search?q=a&b=1", "https://rempireshop.com/et"] });
  });

  it("the CLI exists, defaults to the production sitemap and has a dry run", () => {
    const src = readFileSync(fileURLToPath(new URL("../tools/indexnow-submit.mjs", import.meta.url)), "utf8");
    expect(src).toContain('args.includes("--dry-run")');
    expect(src).toContain('LIVE_ORIGIN + "/sitemap.xml"');
    expect(src).toContain("INDEXNOW_KEY_LOCATION");
  });
});

describe("submitIndexNow() — fire and forget", () => {
  beforeEach(() => {
    resetIndexNowMemory();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_BASE_URL", LIVE);
    vi.stubEnv("VERCEL_ENV", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the list on the live shop, and not again for the same addresses within ten minutes", async () => {
    const calls = mockFetch();
    submitIndexNow(productUrls("a"));
    await indexNowSettled();
    expect(calls.map((c) => c.body.urlList)).toEqual([productUrls("a")]);
    submitIndexNow(productUrls("a"));
    submitIndexNow([...productUrls("a"), ...productUrls("b")]);
    await indexNowSettled();
    expect(calls.map((c) => c.body.urlList)).toEqual([productUrls("a"), productUrls("b")]);
  });

  it("sends nothing from staging, a preview or a local run", async () => {
    const calls = mockFetch();
    vi.stubEnv("PUBLIC_BASE_URL", "https://rempireshop.diipsolutions.eu");
    submitIndexNow(productUrls("a"));
    vi.stubEnv("PUBLIC_BASE_URL", LIVE);
    vi.stubEnv("VERCEL_ENV", "preview");
    submitIndexNow(productUrls("a"));
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    submitIndexNow(productUrls("a"));
    await indexNowSettled();
    expect(calls).toEqual([]);
  });

  it("never throws and never rejects — a network error or a refusal is one warning, and the next save tries again", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(() => submitIndexNow(productUrls("a"))).not.toThrow();
    await indexNowSettled();
    expect(console.warn).toHaveBeenCalledWith("[indexnow] not sent:", "offline");
    const calls = mockFetch(403);
    submitIndexNow(productUrls("a"));
    await indexNowSettled();
    expect(calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith("[indexnow] 403 for 3 address(es)");
  });
});

describe("the admin routes tell IndexNow what changed", () => {
  let admin = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    resetIndexNowMemory();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_BASE_URL", LIVE);
    vi.stubEnv("VERCEL_ENV", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const req = (method: string, path: string, body?: unknown) => new Request(`${LIVE}${path}`, {
    method, headers: { cookie: admin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sent = (calls: Call[]) => calls.flatMap((c) => c.body.urlList).sort();

  it("a catalogue product's price, stock or «Показывать в магазине»", async () => {
    const calls = mockFetch();
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const res = await PUT(req("PUT", "/api/admin/overrides/", { items: [{ id: "touchable", hidden: true }, { id: "other", price: 12 }] }));
    expect(res.status).toBe(200);
    await indexNowSettled();
    expect(sent(calls)).toEqual([...productUrls("touchable"), ...productUrls("other")].sort());
  });

  it("nothing for a request the route refused", async () => {
    const calls = mockFetch();
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const res = await PUT(req("PUT", "/api/admin/overrides/", { id: "x", price: -5 }));
    expect(res.status).toBe(400);
    await indexNowSettled();
    expect(calls).toEqual([]);
  });

  it("an owner's own product: created, edited, taken off sale", async () => {
    const calls = mockFetch();
    const { POST } = await import("@/app/api/admin/products/route");
    const created = await POST(req("POST", "/api/admin/products/", { brand: "Proraso", name: "Balm", cat: "beard", price: 9 }));
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { product: { id: string } }).product.id;
    await indexNowSettled();
    expect(sent(calls)).toEqual(productUrls(id).sort());

    resetIndexNowMemory();
    const one = await import("@/app/api/admin/products/[id]/route");
    const ctx = { params: Promise.resolve({ id }) };
    await one.PUT(req("PUT", `/api/admin/products/${id}/`, { price: 11 }), ctx);
    await indexNowSettled();
    expect(calls).toHaveLength(2);
    resetIndexNowMemory();
    await one.DELETE(req("DELETE", `/api/admin/products/${id}/`), ctx);
    await indexNowSettled();
    expect(calls).toHaveLength(3);
    expect(calls[2].body.urlList).toEqual(productUrls(id));
  });

  it("an article: published, edited while live, unpublished, deleted — never a draft", async () => {
    const calls = mockFetch();
    const { POST, PATCH, DELETE } = await import("@/app/api/admin/blog/route");
    const made = (await (await POST(req("POST", "/api/admin/blog/", { title: { RU: "Масло для бороды" }, body: { RU: "<p>Текст</p>" } }))).json()) as { post: { id: string; slug: string } };
    await PATCH(req("PATCH", "/api/admin/blog/", { id: made.post.id, excerpt: { RU: "черновик" } }));
    await indexNowSettled();
    expect(calls).toEqual([]);

    await PATCH(req("PATCH", "/api/admin/blog/", { id: made.post.id, publish: true }));
    await indexNowSettled();
    expect(sent(calls)).toEqual(blogPostUrls(made.post.slug).sort());

    resetIndexNowMemory();
    await PATCH(req("PATCH", "/api/admin/blog/", { id: made.post.id, excerpt: { RU: "живая" } }));
    await indexNowSettled();
    expect(calls).toHaveLength(2);

    resetIndexNowMemory();
    await DELETE(req("DELETE", `/api/admin/blog/?id=${made.post.id}`));
    await indexNowSettled();
    expect(calls).toHaveLength(3);
    expect(calls[2].body.urlList).toEqual(blogPostUrls(made.post.slug));
  });

  it("is silent on staging, whatever the owner does", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://rempireshop.diipsolutions.eu");
    const calls = mockFetch();
    const { PUT } = await import("@/app/api/admin/overrides/route");
    await PUT(req("PUT", "/api/admin/overrides/", { id: "touchable", price: 10 }));
    await indexNowSettled();
    expect(calls).toEqual([]);
  });
});
