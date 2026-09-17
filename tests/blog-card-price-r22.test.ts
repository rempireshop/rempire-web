/**
 * A price inside an article stops being a number somebody typed in September —
 * Dim, 17.09.2026.
 *
 * Until now the «Товар» button wrote the price into `posts.body` as literal
 * text: «Bio Botanical Shampoo — от 12,90 €». The shop rebuilt that card from
 * the live catalogue, so a shopper with JS never saw the stale figure — but
 * Google, the first paint of the page and every reader without scripts got the
 * price as it stood on the day the article was written, for ever.
 *
 * The marker now stores NO price and says so — `data-price="live"` — and each
 * of the three renderers fills today's in as it writes the page. Nothing is
 * migrated: every article published before today keeps its price as text, and
 * every renderer goes on reading that shape. **Both shapes are permanent.**
 * Half of this file is about the old one, on purpose — a test that fails is
 * the only thing that stops somebody "tidying away" the branch that carries
 * two years of published articles.
 *
 * The four places the shape is understood, and all four are here:
 *
 *   1. src/lib/blog.ts sanitizeHtml()        — what may be stored;
 *   2. tools/lib/blog-export.mjs             — its hand-kept twin, which the
 *                                              prerenderer sanitises with;
 *   3. src/lib/seo-head.mjs                  — the fill, shared by the
 *                                              request-time page and the build;
 *   4. public/shop2/app.js                   — the editor that writes the
 *                                              marker, and the storefront,
 *                                              which has rebuilt the card from
 *                                              the catalogue all along.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishPost, renderPostBody, sanitizeHtml, upsertPost } from "@/lib/blog";
import { createCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { upsertOverride } from "@/lib/orders";
import { blogCardIds, fillBlogCardPrices } from "@/lib/seo-head.mjs";
import {
  renderPostBody as exportRenderPostBody,
  sanitizeHtml as exportSanitizeHtml,
} from "../tools/lib/blog-export.mjs";
import { setupDb, teardownDb } from "./helpers";

const SHAMPOO = "system-4-bio-botanical-shampoo";

/** What «Товар» wrote until 17.09.2026 — the words AND the price, as text. */
const oldMarker = (id: string, words = "Bio Botanical Shampoo — от 12,90 €") =>
  `<p><a data-product="${id}" href="/shop2/p/${id}/">${words}</a></p>`;
/** …and what it writes now: the words, and a marker where the price was. */
const liveMarker = (id: string, words = "Bio Botanical Shampoo") =>
  `<p><a data-product="${id}" data-price="live" href="/shop2/p/${id}/">${words}</a></p>`;

/* ---------- 1 + 2: what may be stored, in both sanitisers ---------------- */

describe("sanitizeHtml: the marker may say that its price is not its own", () => {
  /* Run against BOTH copies — src/lib/blog.ts is the real one, and
     tools/lib/blog-export.mjs is the hand-kept twin the build sanitises with.
     A drift here is not cosmetic: the prerenderer matches on this attribute,
     so a twin that drops it prerenders every new card with no price at all. */
  for (const [where, clean] of [["src/lib/blog.ts", sanitizeHtml], ["tools/lib/blog-export.mjs", exportSanitizeHtml]] as const) {
    describe(where, () => {
      it("keeps data-price=\"live\" on a product marker", () => {
        const out = clean(liveMarker(SHAMPOO));
        expect(out).toContain(`data-product="${SHAMPOO}"`);
        expect(out).toContain('data-price="live"');
        expect(out).toContain("Bio Botanical Shampoo");
      });

      it("writes the attributes in the one order the renderers match on", () => {
        expect(clean(liveMarker(SHAMPOO))).toContain(
          `<a data-product="${SHAMPOO}" data-price="live" href="/shop2/p/${SHAMPOO}/">`,
        );
      });

      it("leaves a marker of the old shape exactly as it is", () => {
        const out = clean(oldMarker(SHAMPOO));
        expect(out).toContain("Bio Botanical Shampoo — от 12,90 €");
        expect(out).not.toContain("data-price");
      });

      it("is a closed list of one word, and means nothing without a product", () => {
        for (const v of ["yes", "lively", "1", "живая", "javascript:alert(1)"]) {
          const out = clean(`<p><a data-product="${SHAMPOO}" data-price="${v}" href="/x/">x</a></p>`);
          expect(out, v).not.toContain("data-price");
        }
        // an ordinary link may not carry it: it is not an attribute for links
        expect(clean('<p><a data-price="live" href="https://example.com/">сайт</a></p>')).not.toContain("data-price");
      });
    });
  }

  it("LIVE is case-insensitive on the way in and normalised on the way out", () => {
    expect(sanitizeHtml(`<a data-product="${SHAMPOO}" data-price="LIVE" href="/x/">x</a>`))
      .toContain('data-price="live"');
  });
});

/* ---------- 3: the fill both server renderers share ---------------------- */

describe("fillBlogCardPrices: the price is written as the page is written", () => {
  const priceOf = (id: string) => (id === SHAMPOO ? "от 14,50 €" : "");

  it("puts today's price into a live marker, after the words", () => {
    const out = fillBlogCardPrices(renderPostBody(liveMarker(SHAMPOO)), priceOf);
    expect(out).toContain("Bio Botanical Shampoo — от 14,50 €");
  });

  it("does not touch a marker of the old shape, whatever its price says", () => {
    const stored = renderPostBody(oldMarker(SHAMPOO));
    expect(fillBlogCardPrices(stored, priceOf)).toBe(stored);
    expect(fillBlogCardPrices(stored, priceOf)).toContain("от 12,90 €");
  });

  it("leaves a body with no markers at all byte for byte", () => {
    const stored = renderPostBody("<p>Просто текст со <strong>словом</strong>.</p>");
    expect(fillBlogCardPrices(stored, priceOf)).toBe(stored);
  });

  it("leaves the words and adds no price when the product cannot be priced", () => {
    const out = fillBlogCardPrices(renderPostBody(liveMarker("no-such-product")), priceOf);
    expect(out).toContain("Bio Botanical Shampoo");
    expect(out).not.toContain("€");
    expect(out).not.toContain("—");
  });

  it("names every product a body's live markers carry, once each, and none of an old body's", () => {
    const two = renderPostBody(liveMarker(SHAMPOO) + liveMarker("proraso-beard-oil-azur-lime-30ml") + liveMarker(SHAMPOO));
    expect(blogCardIds(two)).toEqual([SHAMPOO, "proraso-beard-oil-azur-lime-30ml"]);
    expect(blogCardIds(renderPostBody(oldMarker(SHAMPOO)))).toEqual([]);
    expect(blogCardIds("")).toEqual([]);
  });

  it("fills several markers in one body, and only the live ones", () => {
    const mixed = renderPostBody(oldMarker(SHAMPOO) + liveMarker(SHAMPOO) + "<p>Хвост.</p>");
    const out = fillBlogCardPrices(mixed, priceOf);
    expect(out).toContain("Bio Botanical Shampoo — от 12,90 €");   // the old one, untouched
    expect(out).toContain("Bio Botanical Shampoo — от 14,50 €");   // the new one, filled
    expect(out).toContain("<p>Хвост.</p>");
  });

  /* The prerenderer sanitises with the twin, so the twin's output has to go
     through the same fill and come out the same. */
  it("works on a body the build's own sanitiser wrote", () => {
    expect(fillBlogCardPrices(exportRenderPostBody(liveMarker(SHAMPOO)), priceOf))
      .toContain("Bio Botanical Shampoo — от 14,50 €");
  });
});

/* ---------- 4: the request-time article -------------------------------- */

const LIVE_BASE = "https://rempireshop.com";

async function postPage(seg: "" | "et" | "en", slug: string): Promise<string> {
  const mod = seg === "et"
    ? await import("@/app/shop2/et/blog/[slug]/route")
    : seg === "en"
      ? await import("@/app/shop2/en/blog/[slug]/route")
      : await import("@/app/shop2/blog/[slug]/route");
  const res = await mod.GET(
    new Request(`${LIVE_BASE}/shop2${seg ? "/" + seg : ""}/blog/${slug}/`),
    { params: Promise.resolve({ slug }) },
  );
  return res.text();
}

/** The article itself, without the #blogpost snapshot that follows it. */
function articleBody(html: string): string {
  return (html.match(/<div class="acc__rich blog__body">([\s\S]*?)<\/div>/) || [])[1] ?? "";
}
function blogpostJson(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/json" id="blogpost">([\s\S]*?)<\/script>/);
  return m ? (JSON.parse(m[1]) as { post: Record<string, unknown> }).post : {};
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = LIVE_BASE;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE_BASE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec("truncate posts, custom_products, product_overrides restart identity cascade");
});
afterEach(() => vi.restoreAllMocks());

async function publish(body: Record<string, string>, products: string[] = []) {
  const draft = await upsertPost({
    title: { RU: "Зимний уход", ET: "Talvine hooldus", EN: "Winter care" },
    excerpt: { RU: "Три привычки.", ET: "Kolm harjumust.", EN: "Three habits." },
    body,
    coverUrl: "/shop/img/night-rider-0.webp",
    tags: [],
    products,
  });
  return (await publishPost(draft.id))!;
}

describe("the article as it is served: the price is the shop's, not the article's", () => {
  /* «Показывать в магазине», the price and the size ladder all live in
     product_overrides — the panel's answer, not the file the build shipped.
     A ladder of one rung is exactly how the owner reprices a product he sells
     in one size, and it is what every figure below comes from. */
  const repriced = (price: number) => upsertOverride(SHAMPOO, { sizes: [{ size: "250 мл", price }] });

  it("prints the owner's price today, not the one the article was written with", async () => {
    // the owner has since repriced the shampoo in the panel
    await repriced(21.4);
    const post = await publish({ RU: liveMarker(SHAMPOO), ET: "", EN: "" });

    const body = articleBody(await postPage("", post.slug));
    expect(body).toContain("Bio Botanical Shampoo — 21,40 €");
    expect(body).toContain(`data-product="${SHAMPOO}"`);
  });

  it("says «от …» in the language the article is read in", async () => {
    const post = await publish({
      RU: liveMarker(SHAMPOO, "Шампунь"),
      ET: liveMarker(SHAMPOO, "Šampoon"),
      EN: liveMarker(SHAMPOO, "Shampoo"),
    });
    // a ladder of two sizes is what makes the shop say «от»
    await upsertOverride(SHAMPOO, { sizes: [{ size: "250 мл", price: 14.5 }, { size: "500 мл", price: 24 }] });

    expect(articleBody(await postPage("", post.slug))).toContain("Шампунь — от 14,50 €");
    expect(articleBody(await postPage("et", post.slug))).toContain("Šampoon — alates 14,50 €");
    expect(articleBody(await postPage("en", post.slug))).toContain("Shampoo — from 14,50 €");
  });

  /* The whole point of «not migrated»: an article written in September keeps
     the figure it was written with, and the page still renders. */
  it("leaves an article of the old shape exactly as it was published", async () => {
    const post = await publish({ RU: oldMarker(SHAMPOO), ET: "", EN: "" });
    await repriced(99);
    const body = articleBody(await postPage("", post.slug));
    expect(body).toContain("Bio Botanical Shampoo — от 12,90 €");
    expect(body).not.toContain("99");
  });

  /* #blogpost is the shape /api/blog/<slug>/ answers, and app.js builds its
     own cards out of it — a price written in there would be a figure nobody
     reads and one more thing to keep in step. */
  it("keeps the stored body in the snapshot the shop hydrates from", async () => {
    await repriced(21.4);
    const post = await publish({ RU: liveMarker(SHAMPOO), ET: "", EN: "" });
    const html = await postPage("", post.slug);

    expect(articleBody(html)).toContain("21,40 €");
    expect(String(blogpostJson(html).bodyHtml)).toContain('data-price="live"');
    expect(String(blogpostJson(html).bodyHtml)).not.toContain("21,40");
  });

  it("prices a card for one of the owner's own products too", async () => {
    const wax = await createCustomProduct({
      brand: "Acme", name: "Wax", cat: "styling", sizes: ["50 мл", "100 мл"], prices: [9, 15],
    });
    const post = await publish({ RU: liveMarker(wax.id, "Acme Wax"), ET: "", EN: "" });
    expect(articleBody(await postPage("", post.slug))).toContain("Acme Wax — от 9 €");
  });

  /* A product the owner has switched off is not priced — the card keeps its
     words and shows no figure, rather than quoting something withdrawn. */
  it("shows no price for a product that has left the shop", async () => {
    await upsertOverride(SHAMPOO, { hidden: true });
    const post = await publish({ RU: liveMarker(SHAMPOO), ET: "", EN: "" });
    const body = articleBody(await postPage("", post.slug));
    expect(body).toContain("Bio Botanical Shampoo");
    expect(body).not.toContain("€");
  });

  /* «Товары из статьи» is the shelf UNDER the article and was fixed in its own
     right earlier; the cards inside the text now ride on the same lookup, so
     this pins that the shelf did not change while they were being added. */
  it("still draws the shelf under the article, at the owner's price", async () => {
    await repriced(21.4);
    const post = await publish({ RU: liveMarker(SHAMPOO), ET: "", EN: "" }, [SHAMPOO, "no-such-product"]);
    const html = await postPage("", post.slug);
    expect(html).toContain("Товары из статьи");
    expect(html).toContain('<span class="pre__pr num">21,40 €</span>');
  });
});

/* ---------- 4: the editor, and the build's wiring ----------------------- */

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const appSrc = readFileSync(APP_JS, "utf8");

function slice(name: string): string {
  const start = appSrc.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = appSrc.indexOf("{", start); i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}" && --depth === 0) return appSrc.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** blogProductLinkHTML() — what «Товар» drops into the body — for one language. */
function marker(lang: "RU" | "ET" | "EN"): string {
  const body = `
    var SEG_OF_LANG = { RU: "", ET: "/et", EN: "/en" };
    function productsById() { return [{ id: "${SHAMPOO}", brand: "System 4", name: "Bio Botanical Shampoo", price: 12.9, priceFrom: true }]; }
    function blogProductName(p, L) { return p.brand + " " + p.name + " (" + L + ")"; }
    function blogProductPrice() { throw new Error("the editor must not write a price into the body"); }
    ${slice("esc")}
    ${slice("blogProductLinkHTML")}
    return blogProductLinkHTML("${SHAMPOO}", LANG);
  `;
  return (new Function("LANG", body) as (l: string) => string)(lang);
}

describe("the «Товар» button no longer writes a price into the article", () => {
  it("writes the words, the language's product page, and the live-price marker", () => {
    expect(marker("RU")).toBe(
      `<a data-product="${SHAMPOO}" data-price="live" href="/shop2/p/${SHAMPOO}/">System 4 Bio Botanical Shampoo (RU)</a>`,
    );
    expect(marker("ET")).toContain('href="/shop2/et/p/');
    expect(marker("EN")).toContain('href="/shop2/en/p/');
  });

  it("writes no money at all — blogProductPrice() throws if it is reached", () => {
    for (const L of ["RU", "ET", "EN"] as const) {
      expect(marker(L)).not.toContain("€");
      expect(marker(L)).not.toContain("12,90");
    }
  });

  /* …and what it writes survives being stored, and then reads as a price. */
  it("round-trips: the button, the sanitiser, and the price filled in at render", () => {
    const stored = renderPostBody(`<p>${marker("RU")}</p>`);
    expect(stored).toContain('data-price="live"');
    expect(blogCardIds(stored)).toEqual([SHAMPOO]);
    expect(fillBlogCardPrices(stored, () => "от 14,50 €")).toContain(
      "System 4 Bio Botanical Shampoo (RU) — от 14,50 €",
    );
  });
});

describe("the build writes the filled body, not the stored one", () => {
  const prerender = readFileSync(fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)), "utf8");

  it("tools/prerender-shop2.mjs fills the article before it writes it", () => {
    expect(prerender).toContain("fillBlogCardPrices");
    expect(prerender).toContain('<div class="acc__rich blog__body">\' + bodyShown +');
    // …and the snapshot keeps the stored body, exactly as the request-time page does
    expect(prerender).toContain("blogJsonScript(\"blogpost\"");
  });
});
