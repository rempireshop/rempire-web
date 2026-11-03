/**
 * The picture sizes the owner chooses were being thrown away by the build —
 * Dim, 17.09.2026.
 *
 * Renat asked to be able to make a photo in an article smaller and to move it
 * beside the text; the editor got four buttons for it, and each writes one
 * word onto the picture's own <figure>: `data-fig="full" | "half-left" |
 * "half-right" | "small"`. Every rule that makes those four mean anything
 * (`.blog__body figure[data-fig…]` in public/shop2/styles.css) hangs off that
 * attribute and nothing else, so a <figure> that arrives without it renders
 * full column width — which is what a picture did before the presets existed.
 *
 * When this was written there were two sanitisers: src/lib/blog.ts (the API
 * and the request-time page) and its hand-kept twin tools/lib/blog-export.mjs
 * (the build), which dropped `data-fig` — so every prerendered article lost
 * the owner's choice. The cure was one implementation: both now re-export
 * src/lib/blog-html.mjs. What is left to guard is therefore the presets
 * themselves, the build's own sanitise-then-fill-prices order, and the wiring:
 * both callers must still hand out the very same functions.
 *
 * 03.11.2026 (test cleanup, Dim's decision u1): the 47-body corpus that
 * compared the module with itself, byte for byte, was removed with the loop
 * that ran every preset test twice against the same function.
 */
import { describe, expect, it } from "vitest";
import { markdownToHtml, renderPostBody, sanitizeHtml } from "@/lib/blog";
import { fillBlogCardPrices } from "@/lib/seo-head.mjs";
import {
  markdownToHtml as exportMarkdownToHtml,
  renderPostBody as exportRenderPostBody,
  sanitizeHtml as exportSanitizeHtml,
} from "../tools/lib/blog-export.mjs";

const PIC = "/shop/img/night-rider-0.webp";
const fig = (v: string | null, alt = "Паста") =>
  `<figure${v === null ? "" : ` data-fig="${v}"`}><img src="${PIC}" alt="${alt}"></figure>`;

describe("a picture keeps the size and the side the owner chose", () => {
  it("keeps each of the four presets, written exactly as the CSS matches it", () => {
    for (const v of ["full", "half-left", "half-right", "small"]) {
      expect(sanitizeHtml(fig(v)), v).toBe(
        `<figure data-fig="${v}"><img src="${PIC}" alt="Паста" loading="lazy"></figure>`,
      );
    }
  });

  it("is a closed list of four words — anything else leaves the figure bare", () => {
    for (const v of ["", "huge", "left", "half left", "1", "<script>alert(1)</script>", "слева"]) {
      expect(sanitizeHtml(fig(v)), v).toBe(`<figure><img src="${PIC}" alt="Паста" loading="lazy"></figure>`);
    }
  });

  it("reads a preset that only differs in case or spacing as the preset", () => {
    expect(sanitizeHtml(fig(" HALF-LEFT "))).toContain('<figure data-fig="half-left">');
  });

  /* Every article written before the presets existed carries a bare
     <figure>, and has to come back bare rather than acquiring a default. */
  it("leaves an older article's bare figure bare", () => {
    expect(sanitizeHtml(fig(null))).toBe(`<figure><img src="${PIC}" alt="Паста" loading="lazy"></figure>`);
  });

  it("lets no other attribute in on the back of the preset", () => {
    const out = sanitizeHtml(
      `<figure class="x" style="width:9px" onclick="alert(1)" data-fig="small"><img src="${PIC}" alt=""></figure>`,
    );
    expect(out).toBe(`<figure data-fig="small"><img src="${PIC}" alt="" loading="lazy"></figure>`);
  });

  it("keeps three different presets apart in one article", () => {
    const body = "<p>Начало.</p>" + fig("half-left") + fig("small") + fig(null) + "<p>Конец.</p>";
    const out = sanitizeHtml(body);
    expect(out).toContain('<figure data-fig="half-left">');
    expect(out).toContain('<figure data-fig="small">');
    expect((out.match(/<figure>/g) || []).length).toBe(1); // only the old one is bare
  });

  /* What the build actually writes into the page is the sanitised body with
     today's prices filled in (bodyShown in blogPostPage(), tools/prerender-
     shop2.mjs). The preset has to be there at the end of that pipeline, not
     merely at the start of it. */
  it("survives the build's own pipeline — sanitise, then fill the card prices", () => {
    const body =
      fig("half-right") +
      '<p><a data-product="night-rider" data-price="live" href="/shop2/p/night-rider/">Night.Rider</a></p>';
    const shown = fillBlogCardPrices(exportRenderPostBody(body), () => "14,50 €");
    expect(shown).toContain('<figure data-fig="half-right">');
    expect(shown).toContain("Night.Rider — 14,50 €");
  });
});

describe("the build and the shop render with one implementation", () => {
  /* A copy coming back on either path — the drift this file was written
     about — fails here, before any article can look different on the
     prerendered page and the live one. */
  it("hands out the very same functions to both callers", () => {
    expect(exportSanitizeHtml).toBe(sanitizeHtml);
    expect(exportRenderPostBody).toBe(renderPostBody);
    expect(exportMarkdownToHtml).toBe(markdownToHtml);
  });
});
