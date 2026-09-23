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
import { createCustomProduct, setCustomProductActive } from "@/lib/custom-products";
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
/** What the ASSISTANT writes — the id and nothing else. src/lib/ai-prompts.ts
    asks the model for exactly this («no href, no other attribute, no text of
    your own») and src/lib/blog-cards.ts inserts the same for a card the model
    left out, so it is the shape most of the shop's articles will be born in.
    Until 18.09.2026 it reached the page as an EMPTY ANCHOR: no name, no
    price, no link — nothing a crawler or a reader without JS could see. */
const bareMarker = (id: string) => `<p><a data-product="${id}"></a></p>`;

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

      /* The assistant's marker is stored exactly as it is written, which is
         what lets an article published before 18.09.2026 come right at the
         next render with nothing migrated: the id is the whole card, and the
         href, the words and the price are the renderer's. */
      it("stores the assistant's bare marker as the bare id it is", () => {
        expect(clean(bareMarker(SHAMPOO))).toBe(`<p><a data-product="${SHAMPOO}"></a></p>`);
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

/* ---------- the assistant's bare marker, 18.09.2026 --------------------- */

describe("fillBlogCardPrices: the assistant's bare marker comes out the same card", () => {
  const priceOf = (id: string) => (id === SHAMPOO ? "от 14,50 €" : "");
  const nameOf = (id: string) => (id === SHAMPOO ? "System 4 Bio Botanical Shampoo — шампунь" : "");
  const fill = (html: string, seg = "") => fillBlogCardPrices(renderPostBody(html), priceOf, { seg, nameOf });

  it("is named as a card at all — it was invisible to blogCardIds() before", () => {
    expect(blogCardIds(renderPostBody(bareMarker(SHAMPOO)))).toEqual([SHAMPOO]);
  });

  it("gets the link, the name and the price the «Товар» button would have written", () => {
    expect(fill(bareMarker(SHAMPOO))).toBe(
      `<p><a data-product="${SHAMPOO}" data-price="live" href="/shop2/p/${SHAMPOO}/">` +
      "System 4 Bio Botanical Shampoo — шампунь — от 14,50 €</a></p>",
    );
  });

  it("links to the product page of the language the article is read in", () => {
    expect(fill(bareMarker(SHAMPOO), "et")).toContain(`href="/shop2/et/p/${SHAMPOO}/"`);
    expect(fill(bareMarker(SHAMPOO), "en")).toContain(`href="/shop2/en/p/${SHAMPOO}/"`);
  });

  /* The «Товар» button bakes the right language into the href when the card
     is inserted, so a card standing in the Estonian text keeps its own. */
  it("never rewrites an href a marker already carries", () => {
    expect(fill(liveMarker(SHAMPOO), "et")).toContain(`href="/shop2/p/${SHAMPOO}/"`);
    expect(fill(liveMarker(SHAMPOO), "et")).not.toContain("/et/p/");
  });

  /* A hidden product is not priced, and an unpriced bare marker stays the
     empty anchor it was — which is the right answer: its /p/ address answers
     404 noindex, and no link beats a dead one in a published article. */
  it("stays an empty anchor — not a dead link — when the product cannot be priced", () => {
    const stored = renderPostBody(bareMarker(SHAMPOO));
    expect(fillBlogCardPrices(stored, () => "", { seg: "", nameOf })).toBe(stored);
    expect(fillBlogCardPrices(stored, () => "", { seg: "", nameOf })).not.toContain("href");
  });

  it("escapes a name out of the catalogue, and leaves stored words alone", () => {
    const amp = fillBlogCardPrices(renderPostBody(bareMarker(SHAMPOO)), priceOf, {
      seg: "", nameOf: () => "Proraso & Co",
    });
    expect(amp).toContain("Proraso &amp; Co — от 14,50 €");
    // the words in a stored marker have been escaped once already
    expect(fill(liveMarker(SHAMPOO, "Proraso &amp; Co"))).toContain("Proraso &amp; Co — от 14,50 €");
  });

  it("gives the price alone when the caller offers no name", () => {
    expect(fillBlogCardPrices(renderPostBody(bareMarker(SHAMPOO)), priceOf))
      .toContain(`href="/shop2/p/${SHAMPOO}/">от 14,50 €</a>`);
  });

  it("still leaves a marker of the old shape byte for byte", () => {
    const stored = renderPostBody(oldMarker(SHAMPOO));
    expect(fillBlogCardPrices(stored, priceOf, { seg: "et", nameOf })).toBe(stored);
  });

  it("works on a body the build's own sanitiser wrote", () => {
    expect(fillBlogCardPrices(exportRenderPostBody(bareMarker(SHAMPOO)), priceOf, { seg: "", nameOf }))
      .toContain(`href="/shop2/p/${SHAMPOO}/"`);
  });
});

/* ---------- a product that is not for sale, 18.09.2026 ------------------ */

/**
 * The gap the bare marker's change did not close, and it predates it.
 *
 * The «Товар» button STORES its href in the body, so a card the caller could
 * not price kept that link while losing only its figure. For a hidden product
 * the link goes to `/shop2/p/<id>/`, which the middleware answers 404 noindex
 * (docs/seo.md) — a dead link sitting in a published article that a crawler
 * keeps coming back to.
 *
 * `opts.offSale(id)` is how the caller says «not for sale», as against «I
 * could not price it»: only it knows whether the owner hid the product,
 * whether the id is the catalogue's, and whether the query it asked came
 * back. Both callers do, and neither guesses — src/lib/blog-page.ts through
 * shelfProducts(), tools/prerender-shop2.mjs through blogOffSale().
 */
describe("fillBlogCardPrices: a card for a product that is not for sale loses its link", () => {
  const noPrice = () => "";
  const nameOf = (id: string) => (id === SHAMPOO ? "System 4 Bio Botanical Shampoo — шампунь" : "");
  const offSale = (id: string) => id === SHAMPOO;

  it("takes the href off the «Товар» button's card and keeps the words", () => {
    expect(fillBlogCardPrices(renderPostBody(liveMarker(SHAMPOO)), noPrice, { seg: "", nameOf, offSale }))
      .toBe(`<p><a data-product="${SHAMPOO}" data-price="live">Bio Botanical Shampoo</a></p>`);
  });

  /* The words stay because a card may stand inside a sentence, and taking one
     out of a sentence would leave a hole in it. */
  it("leaves that same card alone when the caller only failed to price it", () => {
    const stored = renderPostBody(liveMarker(SHAMPOO));
    expect(fillBlogCardPrices(stored, noPrice, { seg: "", nameOf })).toBe(stored);
    expect(fillBlogCardPrices(stored, noPrice, { seg: "", nameOf, offSale: () => false })).toBe(stored);
  });

  it("never takes the link off a product it could price", () => {
    expect(fillBlogCardPrices(renderPostBody(liveMarker(SHAMPOO)), () => "от 14,50 €", { seg: "", nameOf, offSale }))
      .toContain(`href="/shop2/p/${SHAMPOO}/"`);
  });

  /* The assistant's marker has no href to take, and gets none: that is the
     answer it has had for a hidden product since 18.09.2026, and this rule is
     the «Товар» button's card catching up with it. */
  it("leaves the assistant's bare marker exactly as it is", () => {
    const stored = renderPostBody(bareMarker(SHAMPOO));
    expect(fillBlogCardPrices(stored, noPrice, { seg: "", nameOf, offSale })).toBe(stored);
  });

  /* The branch that carries every article published before 17.09.2026. It is
     frozen, and «the product is off sale» does not unfreeze it. */
  it("still does not touch a marker of the old shape, off sale or not", () => {
    const stored = renderPostBody(oldMarker(SHAMPOO));
    expect(fillBlogCardPrices(stored, noPrice, { seg: "", nameOf, offSale })).toBe(stored);
  });

  /* Whatever the href brought with it goes with it: an absolute one is
     sanitised into `target`/`rel` as well, and those mean nothing without it. */
  it("drops target and rel with the href rather than leaving them behind", () => {
    const external = renderPostBody(
      `<p><a data-product="${SHAMPOO}" data-price="live" href="https://example.com/">Имя</a></p>`,
    );
    expect(external).toContain('target="_blank"');
    expect(fillBlogCardPrices(external, noPrice, { seg: "", nameOf, offSale }))
      .toBe(`<p><a data-product="${SHAMPOO}" data-price="live">Имя</a></p>`);
  });

  it("works on a body the build's own sanitiser wrote", () => {
    expect(fillBlogCardPrices(exportRenderPostBody(liveMarker(SHAMPOO)), noPrice, { seg: "", nameOf, offSale }))
      .not.toContain("href");
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

  /* A product the owner has switched off loses BOTH: no figure, rather than
     quoting something withdrawn, and no link, because the address that href
     points at answers 404 noindex (src/middleware.ts). Until 18.09.2026 the
     card lost only the price and went on linking — the «Товар» button stores
     its href in the body, so leaving the marker alone left the link standing. */
  it("takes the price AND the link off a product that has left the shop", async () => {
    await upsertOverride(SHAMPOO, { hidden: true });
    const post = await publish({ RU: liveMarker(SHAMPOO), ET: "", EN: "" });
    const body = articleBody(await postPage("", post.slug));
    expect(body).toContain("Bio Botanical Shampoo");
    expect(body).not.toContain("€");
    expect(body).not.toContain(`href="/shop2/p/${SHAMPOO}/"`);
    expect(body).toContain(`<a data-product="${SHAMPOO}" data-price="live">`);
  });

  /* And the same article in Estonian, where the href the button stored is the
     Russian one either way — the link goes whichever language is being read. */
  it("takes it off in every language the article is read in", async () => {
    await upsertOverride(SHAMPOO, { hidden: true });
    const post = await publish({ RU: liveMarker(SHAMPOO), ET: liveMarker(SHAMPOO), EN: "" });
    expect(articleBody(await postPage("et", post.slug))).not.toContain("href=\"/shop2/p/");
  });

  /* One of the owner's OWN products, switched off: src/lib/product-page.ts
     answers its address 404 for exactly that, so it is off sale in the same
     sense a hidden catalogue product is, and its card loses the link too. */
  it("takes the link off one of the owner's own products he has switched off", async () => {
    const wax = await createCustomProduct({
      brand: "Acme", name: "Gone", cat: "styling", sizes: ["50 мл"], prices: [9],
    });
    await setCustomProductActive(wax.id, false);
    const post = await publish({ RU: liveMarker(wax.id, "Acme Gone"), ET: "", EN: "" });
    const body = articleBody(await postPage("", post.slug));
    expect(body).toContain("Acme Gone");
    expect(body).not.toContain(`href="/shop2/p/${wax.id}/"`);
  });

  /* An article the assistant wrote, served: the card it put in the text is a
     real link with the product's name on it, in the reader's language — and
     not the empty anchor it was until 18.09.2026. */
  it("turns the assistant's bare marker into a real link with name and price", async () => {
    await repriced(21.4);
    const post = await publish({ RU: bareMarker(SHAMPOO), ET: bareMarker(SHAMPOO), EN: "" });

    const ru = articleBody(await postPage("", post.slug));
    expect(ru).toContain(`href="/shop2/p/${SHAMPOO}/"`);
    expect(ru).toContain("System 4 Bio Botanical Shampoo — шампунь — 21,40 €");

    const et = articleBody(await postPage("et", post.slug));
    expect(et).toContain(`href="/shop2/et/p/${SHAMPOO}/"`);
    // …and the name in Estonian, as the prerendered page writes it — not «— шампунь»
    expect(et).toContain("System 4 Bio Botanical Shampoo — šampoon — 21,40 €");
    expect(et).not.toMatch(/[а-яё]/i);
  });

  /* The card a crawler follows must never be a 404: a hidden product's /p/
     address answers 404 noindex, so its card stays the anchor with no href. */
  it("leaves the assistant's marker unlinked for a product that has left the shop", async () => {
    await upsertOverride(SHAMPOO, { hidden: true });
    const post = await publish({ RU: bareMarker(SHAMPOO), ET: "", EN: "" });
    const body = articleBody(await postPage("", post.slug));
    expect(body).toContain(`data-product="${SHAMPOO}"`);
    expect(body).not.toContain(`href="/shop2/p/${SHAMPOO}/"`);
  });

  /* …and the stored body is untouched by any of it, so #blogpost still
     carries what the panel saved and app.js still rebuilds its own cards. */
  it("stores the bare marker unchanged while serving it filled in", async () => {
    await repriced(21.4);
    const post = await publish({ RU: bareMarker(SHAMPOO), ET: "", EN: "" });
    const html = await postPage("", post.slug);
    expect(String(blogpostJson(html).bodyHtml)).toBe(`<p><a data-product="${SHAMPOO}"></a></p>`);
    expect(articleBody(html)).toContain("21,40 €");
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
