/**
 * A shop link pasted from another host (02.11.2026). The Russian Kevin.Murphy
 * shampoo guide held eight links to https://www.claudeusercontent.com/ru/
 * products/… — the text was copied out of a Claude artifact preview — and
 * the Estonian System 4 guide one to the staging host. Each opened a new tab
 * and sent the shopper to a dead page.
 *
 * localShopHref() (src/lib/shop-paths.mjs) says which links those are;
 * localizeShopLinks() (src/lib/blog-html.mjs) rewrites a body; upsertPost()
 * stores the rewritten body whichever door the save came through, and
 * renderPostBody() shows rows saved before this the same way.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec } from "@/lib/db";
import { localizeShopLinks, renderPostBody, upsertPost } from "@/lib/blog";
import { localShopHref } from "@/lib/shop-paths.mjs";
import { productsNow, resetProductCache, shopBody } from "@/lib/mcp/tools";
import { planRepair } from "../tools/repair-blog-links.mjs";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/* Two list items of the real body, exactly as the row held them. */
const PASTED_RU =
  '<ul><li><strong>Сухие, тусклые, «пересушенные»</strong> → <a href="/ru/products/kevin-muprhy-hydrate-me-wash">Hydrate-Me.Wash</a>' +
  ' + <a href="/ru/products/kevin-murphy-hydrate-me-rinse">Hydrate-Me.Rinse</a>, на ночь' +
  ' <a href="https://www.claudeusercontent.com/ru/products/kevin-murphy-night-shift-100ml" target="_blank" rel="noopener noreferrer">Night.Shift</a>.</li>' +
  '<li><strong>Каждый день под фен</strong> → спрей <a href="https://www.claudeusercontent.com/ru/products/blow-dry-ever-smooth" target="_blank" rel="noopener noreferrer">Ever.Smooth</a>.</li></ul>';
const FIXED_RU =
  '<ul><li><strong>Сухие, тусклые, «пересушенные»</strong> → <a href="/ru/products/kevin-muprhy-hydrate-me-wash">Hydrate-Me.Wash</a>' +
  ' + <a href="/ru/products/kevin-murphy-hydrate-me-rinse">Hydrate-Me.Rinse</a>, на ночь' +
  ' <a href="/ru/products/kevin-murphy-night-shift-100ml">Night.Shift</a>.</li>' +
  '<li><strong>Каждый день под фен</strong> → спрей <a href="/ru/products/blow-dry-ever-smooth">Ever.Smooth</a>.</li></ul>';
const PASTED_ET =
  '<p>Kogu sarja leiad lehelt <a href="/et/collections/system-4">System 4</a>, muu juuksehoolduse jaotisest ' +
  '<a href="https://rempireshop.diipsolutions.eu/et/collections/juuksehooldus" target="_blank" rel="noopener noreferrer">„Juuksehooldus“</a>.</p>';

describe("localShopHref — which absolute links are really the shop's", () => {
  it("takes a shop page on Claude's preview host, the staging host and the shop's own", () => {
    expect(localShopHref("https://www.claudeusercontent.com/ru/products/kevin-murphy-night-shift-100ml")).toBe("/ru/products/kevin-murphy-night-shift-100ml");
    expect(localShopHref("https://abc123.claudeusercontent.com/et/collections/juuksehooldus")).toBe("/et/collections/juuksehooldus");
    expect(localShopHref("https://rempireshop.diipsolutions.eu/et/collections/juuksehooldus")).toBe("/et/collections/juuksehooldus");
    expect(localShopHref("https://www.rempireshop.com/blogs/news/aha-bha-toner")).toBe("/blogs/news/aha-bha-toner");
    expect(localShopHref("https://rempireshop.myshopify.com/products/super-goo")).toBe("/products/super-goo");
  });

  it("takes a local server and a Vercel preview, port, query and fragment kept", () => {
    expect(localShopHref("http://localhost:3300/ru/products/free-hold?size=100ml#top")).toBe("/ru/products/free-hold?size=100ml#top");
    expect(localShopHref("http://127.0.0.1:3000/et")).toBe("/et");
    expect(localShopHref("http://[::1]:3300/collections/hair-care")).toBe("/collections/hair-care");
    expect(localShopHref("https://rempire-web-git-fix-dim.vercel.app/ru/collections/vse-tovary")).toBe("/ru/collections/vse-tovary");
    expect(localShopHref("//localhost:3300/products/super-goo")).toBe("/products/super-goo");
    expect(localShopHref("https://www.claudeusercontent.com")).toBe("/");
  });

  it("moves a /shop2/ address to its page on the way", () => {
    expect(localShopHref("http://localhost:3300/shop2/et/p/free-hold/")).toBe("/et/products/free-hold");
  });

  it("on claude.ai, only a page two segments deep — Claude's own home and screens stay Claude's", () => {
    expect(localShopHref("https://claude.ai/ru/products/free-hold")).toBe("/ru/products/free-hold");
    expect(localShopHref("https://claude.ai/collections/hair-care")).toBe("/collections/hair-care");
    expect(localShopHref("https://claude.ai/")).toBeNull();
    expect(localShopHref("https://claude.ai/search")).toBeNull();
    expect(localShopHref("https://claude.ai/ru")).toBeNull();
    expect(localShopHref("https://claude.ai/chat/1234")).toBeNull();
  });

  it("leaves every other host alone, a brand's own Shopify store included", () => {
    expect(localShopHref("https://www.kevinmurphy.com.au/products/night-rider")).toBeNull();
    expect(localShopHref("https://www.tallinnavesi.ee/collections/x")).toBeNull();
    expect(localShopHref("https://rempireshop.com.evil.example/ru/products/x")).toBeNull();
    expect(localShopHref("https://rempireshop.com@evil.example/ru/products/x")).toBeNull();
    expect(localShopHref("https://notrempireshop.com/ru/products/x")).toBeNull();
  });

  it("leaves a non-page path, a relative link and a non-web address alone", () => {
    expect(localShopHref("https://www.claudeusercontent.com/api/blog/x")).toBeNull();
    expect(localShopHref("https://rempireshop.com/shop2/img/logo.png")).toBeNull();
    expect(localShopHref("/ru/products/free-hold")).toBeNull();
    expect(localShopHref("mailto:info@rempireshop.com")).toBeNull();
    expect(localShopHref("")).toBeNull();
  });
});

describe("localizeShopLinks — the stored body", () => {
  it("repairs the Kevin.Murphy guide's links and leaves the rest byte for byte", () => {
    expect(localizeShopLinks(PASTED_RU)).toBe(FIXED_RU);
  });

  it("repairs the System 4 guide's staging link", () => {
    expect(localizeShopLinks(PASTED_ET)).toBe(
      '<p>Kogu sarja leiad lehelt <a href="/et/collections/system-4">System 4</a>, muu juuksehoolduse jaotisest ' +
      '<a href="/et/collections/juuksehooldus">„Juuksehooldus“</a>.</p>',
    );
  });

  it("is idempotent", () => {
    expect(localizeShopLinks(FIXED_RU)).toBe(FIXED_RU);
    expect(localizeShopLinks(localizeShopLinks(PASTED_ET))).toBe(localizeShopLinks(PASTED_ET));
  });

  it("keeps an external link exactly as it was, new tab and all", () => {
    const ext = '<p>По данным <a href="https://www.tallinnavesi.ee/vesi" target="_blank" rel="noopener noreferrer">Tallinna Vesi</a>.</p>';
    expect(localizeShopLinks(ext)).toBe(ext);
  });

  it("drops a new tab a paste gave a link that was relative already", () => {
    expect(localizeShopLinks('<p><a target="_blank" href="/ru/products/free-hold" rel="noopener">Free.Hold</a></p>'))
      .toBe('<p><a href="/ru/products/free-hold">Free.Hold</a></p>');
  });

  it("keeps the product marker's own attributes", () => {
    expect(localizeShopLinks('<p><a data-product="free-hold" data-price="live" href="https://www.claudeusercontent.com/products/free-hold" target="_blank">Free.Hold</a></p>'))
      .toBe('<p><a data-product="free-hold" data-price="live" href="/products/free-hold">Free.Hold</a></p>');
  });

  it("reads quotes, case and line breaks the way a browser paste writes them", () => {
    expect(localizeShopLinks("<p><A\n  HREF='https://www.claudeusercontent.com/ru/products/x' TARGET=_blank>x</A></p>"))
      .toBe('<p><A\n  HREF="/ru/products/x">x</A></p>');
  });

  it("touches only <a>: an <abbr> or a picture on the same host is not a link", () => {
    const html = '<p><abbr title="x">KM</abbr></p><figure><img src="https://img.rempireshop.com/blog/a.webp" alt=""></figure>';
    expect(localizeShopLinks(html)).toBe(html);
  });

  it("does the same for a markdown body", () => {
    expect(localizeShopLinks("Возьмите [Night.Shift](https://www.claudeusercontent.com/ru/products/kevin-murphy-night-shift-100ml) и [бренд](https://kevinmurphy.com.au/products/x)."))
      .toBe("Возьмите [Night.Shift](/ru/products/kevin-murphy-night-shift-100ml) и [бренд](https://kevinmurphy.com.au/products/x).");
  });
});

describe("renderPostBody — a row saved before the repair", () => {
  it("shows the shop link in the same tab, on the shop", () => {
    const html = renderPostBody(PASTED_RU);
    expect(html).not.toContain("claudeusercontent");
    expect(html).not.toContain("_blank");
    expect(html).toContain('<a href="/ru/products/kevin-murphy-night-shift-100ml">Night.Shift</a>');
  });

  it("still opens an external link in a new tab", () => {
    expect(renderPostBody('<p><a href="https://www.tallinnavesi.ee/">Tallinna Vesi</a></p>'))
      .toBe('<p><a href="https://www.tallinnavesi.ee/" target="_blank" rel="noopener noreferrer">Tallinna Vesi</a></p>');
  });
});

describe("tools/repair-blog-links.mjs — the rows saved before this", () => {
  it("plans exactly the changed links, and nothing for a clean article", () => {
    const plan = planRepair([
      { id: "a", slug: "kak-vybrat-shampun-kevin-murphy-pod-svoi-volosy", status: "published", body: { RU: PASTED_RU, ET: "<p>puhas</p>", EN: "" } },
      { id: "b", slug: "system-4-shampoo-guide", status: "published", body: { RU: "<p>чисто</p>", ET: PASTED_ET, EN: "<p>clean</p>" } },
      { id: "c", slug: "aha-bha-toner", status: "published", body: { RU: FIXED_RU } },
    ]);
    expect(plan.map((p) => p.slug)).toEqual(["kak-vybrat-shampun-kevin-murphy-pod-svoi-volosy", "system-4-shampoo-guide"]);
    expect(plan[0].next).toEqual({ RU: FIXED_RU, ET: "<p>puhas</p>", EN: "" });
    expect(plan[0].links).toEqual([
      {
        lang: "RU",
        before: '<a href="https://www.claudeusercontent.com/ru/products/kevin-murphy-night-shift-100ml" target="_blank" rel="noopener noreferrer">',
        after: '<a href="/ru/products/kevin-murphy-night-shift-100ml">',
      },
      {
        lang: "RU",
        before: '<a href="https://www.claudeusercontent.com/ru/products/blow-dry-ever-smooth" target="_blank" rel="noopener noreferrer">',
        after: '<a href="/ru/products/blow-dry-ever-smooth">',
      },
    ]);
    expect(plan[1].links).toEqual([{
      lang: "ET",
      before: '<a href="https://rempireshop.diipsolutions.eu/et/collections/juuksehooldus" target="_blank" rel="noopener noreferrer">',
      after: '<a href="/et/collections/juuksehooldus">',
    }]);
    expect(plan[1].next.RU).toBe("<p>чисто</p>");
  });
});

describe("every save stores the shop path", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate posts restart identity");
  });

  it("upsertPost — the panel's door, and the assistant's through it", async () => {
    const post = await upsertPost({ title: { RU: "Шампуни" }, body: { RU: PASTED_RU, ET: PASTED_ET } });
    expect(post.body.RU).toBe(FIXED_RU);
    expect(post.body.ET).not.toContain("diipsolutions");
    expect(post.body.ET).toContain('<a href="/et/collections/juuksehooldus">');
    const edited = await upsertPost({ id: post.id, title: { RU: "Шампуни" }, body: { RU: PASTED_RU } });
    expect(edited.body.RU).toBe(FIXED_RU);
  });

  it("shopBody — the Claude connector's door: the link is checked and spelled like any product link", async () => {
    resetProductCache();
    const { list } = await productsNow();
    const byId = new Map(list.map((p) => [p.id, p]));
    const shaped = shopBody(
      '<p>Масло <a href="https://www.claudeusercontent.com/ru/products/kevin-murphy-angel-wash" target="_blank" rel="noopener noreferrer">Angel.Wash</a>' +
      ' и <a href="https://www.claudeusercontent.com/ru/products/no-such-product-here">выдумка</a>.</p>',
      "ET", byId,
    );
    expect(shaped.html).toBe('<p>Масло <a href="/et/products/kevin-murphy-angel-wash">Angel.Wash</a> и выдумка.</p>');
    expect(shaped.ids).toEqual(["kevin-murphy-angel-wash"]);
  });
});
