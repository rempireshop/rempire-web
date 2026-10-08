/**
 * Shopify's addresses (since 08.10.2026, src/lib/shop-paths.mjs) for the pages
 * only the database knows — an owner's own product (`c-…`) and an article
 * published after the build — answered at request time in all three
 * languages; the screens behind a basket or a login, which must not claim to
 * be the home page; and the two kinds of old address that used to take two
 * hops (a Shopify Atom feed of an unmapped collection, a collection path
 * deeper than a handle).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishPost, upsertPost } from "@/lib/blog";
import { createCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { legacyTarget } from "@/lib/legacy-redirects";
import { notFoundPageResponse } from "@/lib/notfound-page";
import { setupDb, teardownDb } from "./helpers";

const LIVE = "https://rempireshop.com";
const LANGS = [
  { prefix: "", seg: "", html: "en" },
  { prefix: "/ru", seg: "ru", html: "ru" },
  { prefix: "/et", seg: "et", html: "et" },
] as const;

const canonical = (html: string) => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] ?? "";
const alt = (html: string, tag: string) => (html.match(new RegExp(`<link rel="alternate" hreflang="${tag}" href="([^"]*)"`)) || [])[1] ?? "";

async function productRoute(seg: string) {
  return seg === "ru" ? import("@/app/ru/products/[id]/route") : seg === "et" ? import("@/app/et/products/[id]/route") : import("@/app/products/[id]/route");
}
async function postRoute(seg: string) {
  return seg === "ru" ? import("@/app/ru/blogs/news/[slug]/route") : seg === "et" ? import("@/app/et/blogs/news/[slug]/route") : import("@/app/blogs/news/[slug]/route");
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec("truncate posts, custom_products restart identity cascade");
});
afterEach(() => vi.restoreAllMocks());

describe("pages only the database knows, at Shopify's addresses", () => {
  it("an owner's own product answers at /products/<id>, /ru/products/<id> and /et/products/<id>", async () => {
    const p = await createCustomProduct({ brand: "Acme", name: "Beard Balm", cat: "beard", price: 12 });
    expect(legacyTarget(`/products/${p.id}`), "the middleware must let a c-… id through").toBeNull();
    expect(legacyTarget(`/ru/products/${p.id}`)).toBeNull();
    for (const l of LANGS) {
      const mod = await productRoute(l.seg);
      const res = await mod.GET(new Request(`${LIVE}${l.prefix}/products/${p.id}`), { params: Promise.resolve({ id: p.id }) });
      expect(res.status, l.html).toBe(200);
      const html = await res.text();
      expect(html, l.html).toMatch(new RegExp(`<html lang="${l.html}"`));
      expect(canonical(html), l.html).toBe(`${LIVE}${l.prefix}/products/${p.id}`);
      expect(alt(html, "ru")).toBe(`${LIVE}/ru/products/${p.id}`);
      expect(alt(html, "x-default")).toBe(`${LIVE}/products/${p.id}`);
    }
  });

  it("an article published after the build answers at /blogs/news/<slug> in all three languages", async () => {
    const row = await upsertPost({ title: { RU: "Борода зимой", ET: "Habe talvel", EN: "A beard in winter" }, body: { RU: "Текст.", ET: "Tekst.", EN: "Text." } });
    const post = (await publishPost(row.id))!;
    expect(legacyTarget(`/blogs/news/${post.slug}`)).toBeNull();
    for (const l of LANGS) {
      const mod = await postRoute(l.seg);
      const res = await mod.GET(new Request(`${LIVE}${l.prefix}/blogs/news/${post.slug}`), { params: Promise.resolve({ slug: post.slug }) });
      expect(res.status, l.html).toBe(200);
      const html = await res.text();
      expect(canonical(html), l.html).toBe(`${LIVE}${l.prefix}/blogs/news/${post.slug}`);
      expect(alt(html, "et")).toBe(`${LIVE}/et/blogs/news/${post.slug}`);
    }
  });
});

describe("a screen behind a basket or a login is not the home page", () => {
  for (const path of ["/search", "/ru/account", "/et/checkout", "/ru/checkout/done", "/cart", "/admin", "/admin/scan"]) {
    it(`${path}: 200, noindex, and no canonical pointing at «/»`, async () => {
      const res = await notFoundPageResponse(path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/<meta name="robots" content="noindex, nofollow" data-served="[^"]*">/);
      expect(canonical(html), "the home page's canonical is still on it").toBe("");
      expect(html).not.toMatch(/<link rel="alternate" hreflang=/);
      expect(html).not.toMatch(/<meta property="og:url"/);
    });
  }
  it("a page that is a page keeps its head", async () => {
    const html = await (await notFoundPageResponse("/collections/brands")).text();
    expect(canonical(html)).not.toBe("");
  });
});

describe("old addresses that used to take two hops — one now", () => {
  it("a Shopify Atom feed of an unmapped collection goes straight to «Все товары»", () => {
    for (const [from, to] of [
      ["/collections/haircare.atom", "/collections/all-products"],
      ["/ru/collections/skincare.atom", "/ru/collections/vse-tovary"],
      ["/et/collections/best-sellers.atom", "/et/collections/koik-tooted"],
      ["/en-fi/collections/fall-deals.atom", "/collections/all-products"],
      ["/et/collections/viimistlus.atom", "/et/collections/viimistlus"],
      ["/collections/kevin-murphy.atom", "/collections/kevin-murphy"],
      // a published subcollection since 09.10.2026 — its feed lands on it
      ["/ru/collections/shampuni-dlya-volos.atom", "/ru/collections/shampuni-dlya-volos"],
      ["/ru/collections/maski-dlya-volos.atom", "/ru/collections/uhod-za-volosami"],
      ["/et/blogs/news.atom", "/et/blogs/news"],
    ]) {
      const hit = legacyTarget(from);
      expect(hit?.path, from).toBe(to);
      expect(legacyTarget(to), `${from} → ${to} moves again`).toBeNull();
    }
  });
  it("a collection path deeper than a handle that nobody knows goes straight to «Все товары»", () => {
    expect(legacyTarget("/ru/collections/collections/all")?.path).toBe("/ru/collections/vse-tovary");
    expect(legacyTarget("/collections/nobody/knows")?.path).toBe("/collections/all-products");
    expect(legacyTarget("/collections/hair-care/some-tag")?.path).toBe("/collections/hair-care");
  });
});
