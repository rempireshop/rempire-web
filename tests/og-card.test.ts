/**
 * The link-preview card drawn at request time (src/lib/og-card.ts, served by
 * src/app/shop2/og/[file]/route.ts): a custom product's WebP upload decoded
 * and fitted on a white 1 200×630 PNG with its brand, name and price drawn
 * as glyph outlines — no font on the machine is asked for — cached by an
 * ETag that moves with the row; a blog post's card per language; 404 for a
 * hidden product, a draft and anything that is not a card.
 */
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishPost, upsertPost } from "@/lib/blog";
import { createCustomProduct, setCustomProductActive, updateCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { drawCard, ogFonts, priceLine, resetCardCache, textPaths, textWidth, wrapText } from "@/lib/og-card";
import { setupDb, teardownDb } from "./helpers";

const LIVE = "https://rempireshop.com";
const ctx = (file: string) => ({ params: Promise.resolve({ file }) });
const req = (file: string, headers: Record<string, string> = {}) => new Request(`${LIVE}/shop2/og/${file}`, { headers });

/** A small opaque WebP, as POST /api/admin/upload would have stored it. */
const webp = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).webp().toBuffer();

const BALM = {
  brand: "Proraso",
  name: "Beard Balm Cypress & Vetyver — бальзам для бороды с ароматом кипариса и ветивера, для ежедневного ухода",
  cat: "beard",
  sizes: ["100 мл", "250 мл"],
  prices: [14.9, 24.9],
  gallery: [{ url: "https://cdn.example.com/products/c-balm/1-balm.webp", thumb: "https://cdn.example.com/products/c-balm/1-balm-thumb.webp", alt: "" }],
};

/** Every URL fetched since the last reset; the answer is `body` with `status`. */
const fetched: string[] = [];
function stubFetch(status: number, body: Buffer | null) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    fetched.push(String(url));
    return new Response(body ? new Uint8Array(body) : null, { status, headers: { "content-type": "image/webp" } });
  }));
}

async function route() {
  return (await import("@/app/shop2/og/[file]/route")).GET;
}

async function pngOf(res: Response): Promise<{ width?: number; height?: number; format?: string }> {
  expect(res.headers.get("content-type")).toBe("image/png");
  const buf = Buffer.from(await res.arrayBuffer());
  expect(Number(res.headers.get("content-length"))).toBe(buf.length);
  return sharp(buf).metadata();
}

describe("text as outlines — no font needed at raster time", () => {
  it("the committed fonts carry Cyrillic, the Estonian letters and the euro sign", () => {
    const { display, body } = ogFonts();
    for (const ch of ["Б", "ж", "õ", "ä", "ü", "€", "—"]) {
      expect(body.hasGlyphForCodePoint(ch.codePointAt(0) as number), `Golos lacks ${ch}`).toBe(true);
      expect(display.hasGlyphForCodePoint(ch.codePointAt(0) as number), `Oswald lacks ${ch}`).toBe(true);
    }
  });

  it("writes glyphs as <path>s and measures them", () => {
    const { body } = ogFonts();
    const svg = textPaths(body, "Бальзам 14,90 €", 40, 10, 50);
    expect(svg).toMatch(/^<path d="M[^"]+" transform="translate\(10 50\) scale\(0\.04\d* -0\.04\d*\)"\/>/);
    expect((svg.match(/<path /g) || []).length).toBe(13); // fifteen characters, the two spaces have no outline
    expect(textWidth(body, "Бальзам", 40)).toBeGreaterThan(100);
    expect(textWidth(body, "Бальзам", 20)).toBeCloseTo(textWidth(body, "Бальзам", 40) / 2, 5);
    expect(textWidth(body, "AB", 40, 6)).toBeCloseTo(textWidth(body, "AB", 40) + 6, 5);
  });

  it("wraps at words, keeps to the line count and ends an overflow with an ellipsis", () => {
    const { body } = ogFonts();
    const lines = wrapText(body, BALM.name, 44, 504, 3);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(textWidth(body, l, 44)).toBeLessThanOrEqual(504);
    expect(lines[0]).toBe("Beard Balm Cypress &");
    expect(lines[2]).toMatch(/…$/);
    expect(wrapText(body, "Wax", 44, 504, 3)).toEqual(["Wax"]);
    expect(wrapText(body, "", 44, 504, 3)).toEqual([]);
    // one word wider than the box is cut, not run off the card
    const long = wrapText(body, "Ш".repeat(60), 44, 504, 3);
    expect(long).toHaveLength(1);
    expect(long[0]).toMatch(/…$/);
    expect(textWidth(body, long[0], 44)).toBeLessThanOrEqual(504);
  });

  it("prints one price, or the range when the sizes differ", () => {
    expect(priceLine([14.9])).toBe("14,90 €");
    expect(priceLine([9, 9])).toBe("9 €");
    expect(priceLine([24.9, 14.9])).toBe("14,90 – 24,90 €");
    expect(priceLine([])).toBe("");
  });

  it("draws a 1 200×630 card with and without a picture", async () => {
    const photo = await webp(640, 480);
    const withPhoto = await sharp(await drawCard({ eyebrow: "Proraso", title: "Wax", foot: "9 €", photo, fit: "inside" })).metadata();
    expect([withPhoto.width, withPhoto.height, withPhoto.format]).toEqual([1200, 630, "png"]);
    const bare = await sharp(await drawCard({ eyebrow: "Proraso", title: "Wax", foot: "", photo: null, fit: "inside" })).metadata();
    expect([bare.width, bare.height]).toEqual([1200, 630]);
    // a buffer that is not a picture: the mark stands in, the card is still drawn
    const broken = await sharp(await drawCard({ eyebrow: "x", title: "y", foot: "", photo: Buffer.from("not an image"), fit: "cover" })).metadata();
    expect([broken.width, broken.height]).toEqual([1200, 630]);
  });
});

describe("GET /shop2/og/<file>.png", () => {
  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = LIVE;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    process.env.PUBLIC_BASE_URL = LIVE;
    fetched.length = 0;
    resetCardCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await exec("truncate custom_products, posts restart identity cascade");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a custom product: its WebP photo decoded onto a 1 200×630 PNG, an ETag, a 304 on the second ask, one fetch", async () => {
    const p = await createCustomProduct(BALM);
    stubFetch(200, await webp(900, 900));
    const GET = await route();
    const res = await GET(req(`${p.id}.png`), ctx(`${p.id}.png`));
    expect(res.status).toBe(200);
    const meta = await pngOf(res);
    expect([meta.width, meta.height, meta.format]).toEqual([1200, 630, "png"]);
    expect(fetched).toEqual([BALM.gallery[0].url]);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"og-[0-9a-f]{20}"$/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");

    const again = await GET(req(`${p.id}.png`, { "if-none-match": etag as string }), ctx(`${p.id}.png`));
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    // …and a plain second ask is served from the drawn copy, no second download
    const third = await GET(req(`${p.id}.png`), ctx(`${p.id}.png`));
    expect(third.status).toBe(200);
    expect(fetched).toHaveLength(1);
  });

  it("no photo yet, or a photo the bucket will not give: still a card, still 200", async () => {
    const bare = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    stubFetch(500, null);
    const GET = await route();
    const res = await GET(req(`${bare.id}.png`), ctx(`${bare.id}.png`));
    expect(res.status).toBe(200);
    expect([(await pngOf(res)).width, fetched.length]).toEqual([1200, 0]);

    const p = await createCustomProduct(BALM);
    const broken = await GET(req(`${p.id}.png`), ctx(`${p.id}.png`));
    expect(broken.status).toBe(200);
    expect((await pngOf(broken)).height).toBe(630);
    expect(fetched).toEqual([BALM.gallery[0].url]);
  });

  it("an edit is a new card: the ETag moves with updated_at, and the page's og:image carries the same stamp", async () => {
    const p = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    stubFetch(500, null);
    const GET = await route();
    const first = (await GET(req(`${p.id}.png`), ctx(`${p.id}.png`))).headers.get("etag");
    await new Promise((r) => setTimeout(r, 5));
    const edited = await updateCustomProduct(p.id, { name: "Matte Wax" });
    const second = (await GET(req(`${p.id}.png`), ctx(`${p.id}.png`))).headers.get("etag");
    expect(second).not.toBe(first);

    const { GET: page } = await import("@/app/shop2/et/p/[id]/route");
    const html = await (await page(new Request(`${LIVE}/shop2/et/p/${p.id}/`), { params: Promise.resolve({ id: p.id }) })).text();
    const stamp = Date.parse(edited!.updatedAt).toString(36);
    expect(html).toContain(`<meta property="og:image" content="${LIVE}/shop2/og/${p.id}.png?v=${stamp}" data-seo="og:image">`);
    expect(html).toContain(`<meta name="twitter:image" content="${LIVE}/shop2/og/${p.id}.png?v=${stamp}" data-seo="twitter:image">`);
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
  });

  it("hidden → 404 and no-store; an id nobody has, a catalogue id, another extension → 404", async () => {
    const p = await createCustomProduct(BALM);
    await setCustomProductActive(p.id, false);
    stubFetch(200, await webp(100, 100));
    const GET = await route();
    const hidden = await GET(req(`${p.id}.png`), ctx(`${p.id}.png`));
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("cache-control")).toBe("no-store");
    for (const file of ["c-nobody-has-this.png", "system-4-bio-botanical-shampoo.png", `${p.id}.jpg`, "c-x.png/../x", ""]) {
      expect((await GET(req(file), ctx(file))).status, file).toBe(404);
    }
    expect(fetched).toHaveLength(0);
  });

  it("a blog post: the cover read off this disk, one card per language, 404 while it is a draft", async () => {
    const post = await upsertPost({
      title: { RU: "Как ухаживать за бородой зимой", ET: "Kuidas hooldada habet talvel" },
      coverUrl: "/shop/img/night-rider-0.webp",
    });
    stubFetch(500, null);
    const GET = await route();
    const draft = await GET(req(`blog-${post.slug}.png`), ctx(`blog-${post.slug}.png`));
    expect(draft.status).toBe(404);

    await publishPost(post.id);
    const ru = await GET(req(`blog-${post.slug}.png`), ctx(`blog-${post.slug}.png`));
    expect(ru.status).toBe(200);
    expect([(await pngOf(ru)).width, (await sharp(Buffer.from(await (await GET(req(`blog-${post.slug}.png`), ctx(`blog-${post.slug}.png`))).arrayBuffer())).metadata()).height]).toEqual([1200, 630]);
    const et = await GET(req(`blog-${post.slug}.et.png`), ctx(`blog-${post.slug}.et.png`));
    expect(et.status).toBe(200);
    expect(et.headers.get("etag")).not.toBe(ru.headers.get("etag"));
    // the cover is a catalogue photo under public/ — read off disk, never fetched
    expect(fetched).toHaveLength(0);
    expect((await GET(req("blog-no-such-post.png"), ctx("blog-no-such-post.png"))).status).toBe(404);
  });
});
