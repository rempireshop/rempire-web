/**
 * A picture in a letter may now carry a link, and a picture on its own line
 * may not vanish.
 *
 * Renat asked for «+ photo» in «Маркетинг → Рассылка» on 20.09.2026 and sent
 * the letter he had in mind: an Aromatic 89 campaign built entirely out of
 * banners, each one clicking through to its own page. The picture already
 * went out at the letter's full width — what did not survive was the link
 * round it. `<a>` is INLINE in this renderer, and `inlineHtml()`'s anchor
 * branch keeps the anchor's WORDS; an `<img>` contributes none, so a linked
 * banner reached the letter as an empty line. Not a broken image: nothing at
 * all, which is why it could sit there unnoticed.
 *
 * The same guard swallowed a plain `<p><img></p>`: no words and no anchor, so
 * flushParagraph() returned before the picture was ever looked at.
 *
 * What is pinned here is the whole path the owner's editor actually produces
 * — `<figure><a href><img></a></figure>` — plus the two shapes that come back
 * from a paste or an older draft, and the plain-text half, which has to quote
 * where the banner GOES rather than the .jpg it is made of.
 */
import { describe, expect, it } from "vitest";
/* Straight from the module: `@/emails` re-exports the transactional letters,
   and a campaign is not one of those. */
import { renderNewsletter } from "@/emails/newsletter";

const IMG = "https://cdn.example.com/banner.jpg";
const TO = "https://rempireshop.com/shop2/c/hair/";

function letter(body: string) {
  return renderNewsletter({ subject: "Тема", body }, "ru");
}

/** The `<img>` tag the renderer emitted, if it emitted one. */
function imgTag(html: string): string {
  const m = /<img[^>]*banner\.jpg[^>]*>/.exec(html);
  return m ? m[0] : "";
}

describe("a banner that clicks through", () => {
  it("survives as a linked image — the editor's own shape", () => {
    const { html } = letter(`<figure data-fig="full"><a href="${TO}"><img src="${IMG}" alt="Скидки"></a></figure>`);
    expect(imgTag(html), "the picture was dropped").toContain(IMG);
    /* …and it is INSIDE the anchor, not merely somewhere in the same letter */
    expect(html).toMatch(new RegExp(`<a[^>]+href="${TO.replace(/[/.]/g, "\\$&")}"[^>]*>\\s*<img[^>]*banner\\.jpg`));
  });

  it("keeps the full width it had before the link existed", () => {
    const { html } = letter(`<figure><a href="${TO}"><img src="${IMG}" alt=""></a></figure>`);
    expect(imgTag(html)).toContain('width="504"');
    expect(imgTag(html)).toContain("max-width:504px");
  });

  it("gives the anchor its own block, so Outlook draws no underline stripe", () => {
    const { html } = letter(`<figure><a href="${TO}"><img src="${IMG}" alt=""></a></figure>`);
    const a = /<a[^>]+href="[^"]*hair[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    expect(a).toContain("display:block");
    expect(a).toContain("text-decoration:none");
  });

  it("works from a paragraph too — what a paste leaves behind", () => {
    const { html } = letter(`<p><a href="${TO}"><img src="${IMG}" alt="Скидки"></a></p>`);
    expect(imgTag(html)).toContain(IMG);
    expect(html).toContain(TO);
  });

  it("the plain text quotes where the banner goes, not the file", () => {
    const { text } = letter(`<figure><a href="${TO}"><img src="${IMG}" alt="Скидки"></a></figure>`);
    expect(text).toContain(`Скидки: ${TO}`);
    expect(text, "the .jpg is not what a text-only reader wants").not.toContain(IMG);
  });
});

describe("a picture with no link is still a picture", () => {
  it("a bare figure renders, unlinked", () => {
    const { html } = letter(`<figure><img src="${IMG}" alt="Новинки"></figure>`);
    expect(imgTag(html)).toContain(IMG);
    expect(html).not.toMatch(/<a[^>]*>\s*<img[^>]*banner\.jpg/);
  });

  it("a bare <p><img></p> is no longer swallowed by the empty-paragraph guard", () => {
    const { html, text } = letter(`<p><img src="${IMG}" alt="Новинки"></p>`);
    expect(imgTag(html), "the empty-paragraph guard ate it").toContain(IMG);
    expect(text).toContain(`Новинки: ${IMG}`);
  });

  it("a nameless picture still gets alt text — a screen reader reads something", () => {
    const { html } = letter(`<figure><img src="${IMG}" alt=""></figure>`);
    expect(imgTag(html)).toMatch(/alt="[^"]+"/);
  });
});

describe("a line that is not only a picture stays a line", () => {
  it("words beside the image keep the paragraph", () => {
    const { html } = letter(`<p>Смотрите <a href="${TO}"><img src="${IMG}" alt=""></a> здесь</p>`);
    expect(html).toContain("Смотрите");
    expect(html).toContain("здесь");
  });

  it("an ordinary text link is untouched", () => {
    const { html, text } = letter(`<p><a href="${TO}">Весь уход за волосами</a></p>`);
    expect(html).toContain("Весь уход за волосами");
    expect(html).toContain(TO);
    expect(text).toContain(`Весь уход за волосами (${TO})`);
  });
});
