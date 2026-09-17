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
 * There were two sanitisers when this was written. src/lib/blog.ts was the
 * real one and had handled
 * `data-fig` since the presets were built. tools/lib/blog-export.mjs is its
 * hand-kept twin, the one tools/prerender-shop2.mjs sanitises with, and it
 * handled `data-fig` nowhere at all: `openTag()` read attributes for <a> and
 * <img> only, so every <figure> came back bare. The owner's choice therefore
 * survived on the API and on the request-time page, and was silently stripped
 * from every prerendered article — the page Google reads, the page a reader
 * without scripts reads, and the first paint everybody else sees before the
 * fetch lands. Three pictures chosen «слева», «маленькая» and «во всю ширину»
 * came out of the build as three identical full-width pictures.
 *
 * So the first half of this file is that bug, run against BOTH sanitisers.
 *
 * The second half is the reason it was possible. `data-fig` is the second
 * attribute to go missing from the twin this way — `data-price` was the first,
 * three commits ago, and was noticed by accident. Nothing compared the two
 * renderers to each other, so «keep them in sync by hand» had no way to fail
 * out loud. CORPUS below is that comparison: a body of every shape either
 * renderer knows about, put through both, byte for byte. It did not make the
 * duplication safe — a body shape nobody thought to add was still invisible
 * to it — but it turned the drift that had actually happened twice into a red
 * test instead of a quietly wrong page.
 *
 * Then the duplication went. Both renderers moved into src/lib/blog-html.mjs
 * the same day, and the two imports below now resolve to that one module, so
 * every assertion here compares it with itself. That is worth keeping rather
 * than deleting, and worth being honest about:
 *
 *   · What it still guards is the PIPELINE, end to end — `@/lib/blog` really
 *     re-exports the renderer, `tools/lib/blog-export.mjs` really re-exports
 *     the same one, `renderPostBody()` really picks the right door per body,
 *     and a preset really survives sanitising followed by the price fill the
 *     build does after it. Re-introduce a copy on either path — or break a
 *     re-export — and these go red.
 *   · What it can no longer guard is the class it was written for. An
 *     attribute added on one side only has no second side to be absent from.
 *     The extraction is what closed that, not this file; a test can only
 *     compare the shapes somebody thought to list, which is exactly why one
 *     implementation was the real fix.
 *
 * So do not read a green run here as proof that two renderers agree. There is
 * one. Read it as proof that the one is wired to both callers.
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

/* ---------- the bug: both sanitisers, the same four words ---------------- */

describe("a picture keeps the size and the side the owner chose", () => {
  /* src/lib/blog.ts is what the API and the request-time page render with;
     tools/lib/blog-export.mjs is what the build renders with. The preset has
     to survive both, or the static page disagrees with the live one about
     what the article looks like. */
  for (const [where, clean] of [
    ["src/lib/blog.ts", sanitizeHtml],
    ["tools/lib/blog-export.mjs", exportSanitizeHtml],
  ] as const) {
    describe(where, () => {
      it("keeps each of the four presets, written exactly as the CSS matches it", () => {
        for (const v of ["full", "half-left", "half-right", "small"]) {
          expect(clean(fig(v)), v).toBe(
            `<figure data-fig="${v}"><img src="${PIC}" alt="Паста" loading="lazy"></figure>`,
          );
        }
      });

      it("is a closed list of four words — anything else leaves the figure bare", () => {
        for (const v of ["", "huge", "left", "half left", "1", "<script>alert(1)</script>", "слева"]) {
          expect(clean(fig(v)), v).toBe(`<figure><img src="${PIC}" alt="Паста" loading="lazy"></figure>`);
        }
      });

      it("reads a preset that only differs in case or spacing as the preset", () => {
        expect(clean(fig(" HALF-LEFT "))).toContain('<figure data-fig="half-left">');
      });

      /* Every article written before the presets existed carries a bare
         <figure>, and has to come back bare rather than acquiring a default. */
      it("leaves an older article's bare figure bare", () => {
        expect(clean(fig(null))).toBe(`<figure><img src="${PIC}" alt="Паста" loading="lazy"></figure>`);
      });

      it("lets no other attribute in on the back of the preset", () => {
        const out = clean(
          `<figure class="x" style="width:9px" onclick="alert(1)" data-fig="small"><img src="${PIC}" alt=""></figure>`,
        );
        expect(out).toBe(`<figure data-fig="small"><img src="${PIC}" alt="" loading="lazy"></figure>`);
      });

      it("keeps three different presets apart in one article", () => {
        const body = "<p>Начало.</p>" + fig("half-left") + fig("small") + fig(null) + "<p>Конец.</p>";
        const out = clean(body);
        expect(out).toContain('<figure data-fig="half-left">');
        expect(out).toContain('<figure data-fig="small">');
        expect((out.match(/<figure>/g) || []).length).toBe(1); // only the old one is bare
      });
    });
  }

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

/* ---------- the drift the bug came out of -------------------------------- */

/**
 * One body per shape the renderer knows about. Add a line here whenever it
 * learns a new tag, attribute or escape — that is the whole maintenance
 * contract of this file. Since the extraction the payoff is smaller and still
 * real: the new shape gets pinned through both call paths and through the
 * build's own sanitise-then-fill-prices order, which is where the last two
 * wrong-looking articles actually surfaced.
 */
const CORPUS: ReadonlyArray<readonly [string, string]> = [
  // — the four presets, and the shape that predates them
  ["figure: full", fig("full")],
  ["figure: half-left", fig("half-left")],
  ["figure: half-right", fig("half-right")],
  ["figure: small", fig("small")],
  ["figure: bare, as before the presets", fig(null)],
  ["figure: a preset nobody offered", fig("enormous")],
  ["figure: case and spacing", fig(" Half-Right ")],
  ["figure: junk attributes alongside", `<figure data-fig="small" class="x" onclick="a()"><img src="${PIC}" alt=""></figure>`],

  // — product markers: the price frozen as text, and the price read today
  ["card: the old shape, price as text", '<p><a data-product="night-rider" href="/shop2/p/night-rider/">Night.Rider — от 12,90 €</a></p>'],
  ["card: the live shape", '<p><a data-product="night-rider" data-price="live" href="/shop2/p/night-rider/">Night.Rider</a></p>'],
  ["card: a product id that is not one", '<p><a data-product="../../etc/passwd" href="/x/">x</a></p>'],
  ["card: data-price without a product", '<p><a data-price="live" href="https://example.com/">сайт</a></p>'],

  // — pictures
  ["img: a picture this shop serves", `<p><img src="${PIC}" alt="Воск"></p>`],
  ["img: an https picture elsewhere", '<p><img src="https://cdn.example.com/a.webp" alt="Б"></p>'],
  ["img: plain http, which the shop is not", '<p><img src="http://example.com/a.png" alt="нет"></p>'],
  ["img: javascript:", '<p><img src="javascript:alert(1)" alt="нет"></p>'],
  ["img: a long alt, and whitespace in it", `<p><img src="${PIC}" alt="  много   слов  ${"я".repeat(200)}"></p>`],

  // — links
  ["a: external", '<p><a href="https://example.com/x">наружу</a></p>'],
  ["a: same-site", '<p><a href="/shop2/blog/">внутрь</a></p>'],
  ["a: mailto", '<p><a href="mailto:info@rempireshop.com">почта</a></p>'],
  ["a: protocol-relative", '<p><a href="//evil.example/x">нет</a></p>'],
  ["a: javascript:", '<p><a href="javascript:alert(1)">нет</a></p>'],
  ["a: no href at all", "<p><a>пусто</a></p>"],

  // — the plain body tags, and the aliases a paste arrives with
  ["blocks: headings, lists, quote", "<h2>Раздел</h2><h3>Под</h3><ul><li>один</li></ul><ol><li>два</li></ol><blockquote><p>цитата</p></blockquote>"],
  ["blocks: emphasis and a break", "<p><strong>жирный</strong> и <em>курсив</em><br>с новой строки</p>"],
  ["blocks: aliases b, i, h1, h4", "<h1>Раз</h1><h4>Два</h4><p><b>ж</b><i>к</i></p>"],
  ["blocks: a self-closing br", "<p>раз<br/>два</p>"],

  // — what a paste from Word drags in
  ["paste: divs and spans unwrap", '<div class="WordSection1"><p class="MsoNormal"><span style="font-family:Calibri"><b>Заголовок</b></span></p></div>'],
  ["paste: script, style, svg go with their contents", '<p>до</p><script>alert(1)</script><style>p{}</style><svg><path/></svg><p>после</p>'],
  ["paste: a comment and a doctype", "<!doctype html><!-- заметка --><p>текст</p>"],
  ["paste: an on… handler", '<p onclick="alert(1)" onmouseover=alert(2)>текст</p>'],

  // — shapes the input, not the function, decides
  ["broken: a close with no open", "<p>раз</p></strong><p>два</p>"],
  ["broken: left open at the end", "<p>раз<strong>два"],
  ["broken: nesting past the depth limit", "<blockquote>".repeat(40) + "дно" + "</blockquote>".repeat(40)],
  ["broken: a bare < in the text", "<p>1 < 2 и 3 > 2</p>"],
  ["broken: a quoted > inside an attribute", `<p><img src="${PIC}" alt="a > b"></p>`],
  ["text: a bare & beside a real entity", "<p>Кофе &amp; чай &nbsp; 5 &lt; 6 & 7</p>"],

  // — markdown: every body written before the visual editor
  ["md: headings, bold, italic", "# Заголовок\n\nОбычный **жирный** и *курсив*."],
  ["md: lists and a quote", "## Раздел\n\n- один\n- два\n\n1. первый\n\n> цитата"],
  ["md: a link and a picture", "[текст](https://example.com/a)\n\n![альт](https://example.com/a.png)"],
  ["md: a url markdown must refuse", "[нет](javascript:alert(1))"],
  ["md: html in a markdown body stays text", "<script>alert(1)</script>\n\nпросто текст"],
  ["md: underscores", "__ж__ и _к_"],

  // — the boundary between the two, and the empty cases
  ["boundary: a body that opens with a figure is html", fig("small") + "<p>текст</p>"],
  ["boundary: a body that opens with text is markdown", "текст\n\n<p>не тег</p>"],
  ["empty: nothing at all", ""],
  ["empty: whitespace", "   \n\n  "],
];

describe("the build's sanitiser and the shop's agree, body for body", () => {
  /* This compared two hand-kept copies when it was written. The twin was
     believed to be unavoidable — a plain .mjs cannot import a TypeScript
     module with no build step — which was true of the premise and wrong of
     the conclusion: the shared half simply moved to plain ESM
     (src/lib/blog-html.mjs), the way src/lib/seo-head.mjs had always been
     written. Both names below now import that one module. A failure here is
     therefore no longer a drift between copies; it means a re-export broke,
     or a copy came back. Either way it is the prerendered article and the
     live article about to show the reader two different pages. */
  for (const [name, body] of CORPUS) {
    it(`renders the same bytes: ${name}`, () => {
      expect(exportRenderPostBody(body)).toBe(renderPostBody(body));
    });
  }

  it("agrees on every body in the corpus at once, as one article", () => {
    const whole = CORPUS.map(([, b]) => b).join("\n\n");
    expect(exportRenderPostBody(whole)).toBe(renderPostBody(whole));
  });

  /* renderPostBody() picks one of the two renderers per body, so a corpus of
     bodies only ever exercises the branch each one happens to take. These two
     pin both branches for every body, whichever way it would have gone. */
  it("agrees tag for tag when every body is forced through the HTML branch", () => {
    for (const [name, body] of CORPUS) {
      expect(exportSanitizeHtml(body), name).toBe(sanitizeHtml(body));
    }
  });

  it("agrees line for line when every body is forced through the markdown branch", () => {
    for (const [name, body] of CORPUS) {
      expect(exportMarkdownToHtml(body), name).toBe(markdownToHtml(body));
    }
  });
});
