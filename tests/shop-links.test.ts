/**
 * The storefront's links and pictures, as Google reads them (SEO, 09.10.2026).
 *
 * Google indexes the page as it stands after public/shop2/app.js has run, and
 * until that day the page it got had no <a href> and no <img> in it: every
 * card, menu entry, brand, crumb and «see all» was a <button data-go-…> and
 * every photo a CSS background. They are real links and pictures now —
 *
 *   linkHref(kind, v)  the address a link carries: the one pathFor() writes
 *                      into the bar after the click, in the page's language
 *   heroHref(go)       the banner button's, the same choice as heroGoAttr()
 *   photo() & co       the photo as an <img> in the frame media() draws
 *
 * — and the click handler still keeps a plain click inside the app. These
 * are sliced out of app.js and run here against the address table of
 * src/lib/shop-paths.mjs, which the server, the sitemaps and the prerender
 * use: a link that disagreed with them would send a crawler to a redirect.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { publicPath } from "@/lib/shop-paths.mjs";
import { slugify } from "@/lib/legacy-redirects";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

/** One `  function name(…) { … }` of app.js, by its braces. */
function sliceFn(name: string): string {
  const at = src.indexOf(`\n  function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
/** The address region (shopPathFor and its tables), as tests/shop-paths.test.ts lifts it. */
function addressRegion(): string {
  const from = src.indexOf("  var LANG_OF_SEG = ");
  const to = src.indexOf("  /** The panel and its scanner live at one address");
  expect(from, "app.js lost its address region").toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

type Product = { id: string; brand?: string; name?: string; img?: string; gallery?: unknown[]; photos?: unknown[]; fill?: string };
type Shop = {
  S: { lang: string };
  DEMO: { gallery: Record<string, unknown> };
  BUNDLES: unknown[];
  linkHref(kind: string, v: string): string;
  heroHref(go: string): string;
  heroGoAttr(go: string): string;
  photo(p: Product, i: number, cls: string, alt?: string, first?: boolean, thumb?: boolean): string;
  photoAlt(p: Product): string;
};

function shop(lang = "RU"): Shop {
  const ctx: Record<string, unknown> = {};
  runInNewContext(
    `var S = { lang: ${JSON.stringify(lang)} };
     var DEMO = { gallery: {} };
     var BUNDLES = [];
     function allBundles() { return BUNDLES; }
     function tower(cls) { return '<svg class="' + cls + '"></svg>'; }
     /* the name translation is the dictionary's (tests/admin-product-names-i18n
        and friends); what matters here is that the alt asks for it */
     function trText(s, lang, allowName) {
       if (lang === "RU" || !allowName) return s;
       return s.replace(" — шампунь", lang === "EN" ? " — shampoo" : " — šampoon");
     }
     function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
     ${addressRegion()}
     ${["slugify", "linkHref", "heroGoAttr", "heroHref", "gal", "media", "photo", "photoImg", "photoAlt", "photoThumb"].map(sliceFn).join("\n")}
     this.S = S; this.DEMO = DEMO; this.BUNDLES = BUNDLES;
     this.linkHref = linkHref; this.heroHref = heroHref; this.heroGoAttr = heroGoAttr;
     this.photo = photo; this.photoAlt = photoAlt;`,
    ctx,
  );
  return ctx as unknown as Shop;
}

const LANGS = ["RU", "ET", "EN"] as const;

describe("linkHref — the address on a link, in the page's language", () => {
  it("spells each kind of page the way the server and the sitemap do", () => {
    for (const L of LANGS) {
      const s = shop(L);
      expect(s.linkHref("cat", "hair")).toBe(publicPath(L, "/c/hair/"));
      expect(s.linkHref("cat", "all")).toBe(publicPath(L, "/c/all/"));
      expect(s.linkHref("product", "system-4-bio-botanical-shampoo")).toBe(publicPath(L, "/p/system-4-bio-botanical-shampoo/"));
      expect(s.linkHref("product", "c-kevin-murphy-flawless")).toBe(publicPath(L, "/p/c-kevin-murphy-flawless/"));
      expect(s.linkHref("bundle", "beard-start")).toBe(publicPath(L, "/set/beard-start/"));
      expect(s.linkHref("page", "returns")).toBe(publicPath(L, "/info/returns/"));
      expect(s.linkHref("go", "home")).toBe(publicPath(L, "/"));
      expect(s.linkHref("go", "bundles")).toBe(publicPath(L, "/sets/"));
      expect(s.linkHref("go", "gift")).toBe(publicPath(L, "/gift/"));
      expect(s.linkHref("go", "brands")).toBe(publicPath(L, "/brands/"));
      expect(s.linkHref("go", "blog")).toBe(publicPath(L, "/blog/"));
    }
  });

  it("writes Shopify's addresses: English unprefixed, /ru, /et, each section in its own words", () => {
    expect(shop("EN").linkHref("go", "home")).toBe("/");
    expect(shop("RU").linkHref("go", "home")).toBe("/ru");
    expect(shop("ET").linkHref("go", "home")).toBe("/et");
    expect(shop("EN").linkHref("cat", "hair")).toBe("/collections/hair-care");
    expect(shop("RU").linkHref("cat", "hair")).toBe("/ru/collections/uhod-za-volosami");
    expect(shop("ET").linkHref("cat", "hair")).toBe("/et/collections/juuksehooldus");
    expect(shop("RU").linkHref("cat", "all")).toBe("/ru/collections/vse-tovary");
    expect(shop("EN").linkHref("product", "x")).toBe("/products/x");
    expect(shop("ET").linkHref("go", "gift")).toBe("/et/products/gift-card");
    expect(shop("RU").linkHref("go", "brands")).toBe("/ru/collections/brands");
    expect(shop("EN").linkHref("go", "bundles")).toBe("/collections/sets");
    expect(shop("RU").linkHref("bundle", "beard-start")).toBe("/ru/collections/sets/beard-start");
    expect(shop("ET").linkHref("go", "blog")).toBe("/et/blogs/news");
    expect(shop("EN").linkHref("page", "shipping")).toBe("/policies/shipping-policy");
    expect(shop("RU").linkHref("page", "contact")).toBe("/ru/pages/contact");
  });

  it("names a brand by its collection handle — the brand page's own address", () => {
    for (const brand of ["Kevin.Murphy", "Davines", "System 4", "CBD Daily", "Paul Mitchell"]) {
      for (const L of LANGS) expect(shop(L).linkHref("brand", brand)).toBe(publicPath(L, `/b/${slugify(brand)}/`));
    }
    // Shopify's own spelling where it differed from the brand's slug
    expect(shop("EN").linkHref("brand", "CBD Daily")).toBe("/collections/cbd-daily-haircare");
    expect(shop("RU").linkHref("brand", "Kevin.Murphy")).toBe("/ru/collections/kevin-murphy");
  });

  it("is safe inside a double-quoted attribute, whatever an id carries", () => {
    const href = shop("EN").linkHref("product", 'a"b<c>&d');
    expect(href).not.toMatch(/["<>]/);
    expect(href.startsWith("/products/")).toBe(true);
  });
});

describe("heroHref — the banner's button goes where its action goes", () => {
  const attrToHref = (s: Shop, attr: string) => {
    const m = /^data-([a-z-]+)="([^"]*)"$/.exec(attr);
    expect(m, attr).toBeTruthy();
    const kind = ({ go: "go", "go-cat": "cat", "go-product": "product", page: "page" } as Record<string, string>)[m![1]];
    return s.linkHref(kind, m![2]);
  };
  it("agrees with heroGoAttr() for every kind of target, in every language", () => {
    for (const L of LANGS) {
      const s = shop(L);
      for (const go of ["cat:hair", "cat:all", "product:system-4-bio-botanical-shampoo", "page:returns", "gift", "brands", "bundles", "", "nonsense"]) {
        expect(s.heroHref(go), go).toBe(attrToHref(s, s.heroGoAttr(go)));
      }
      s.BUNDLES.push({ id: "beard-start" });
      expect(s.heroHref("bundles")).toBe(publicPath(L, "/sets/"));
    }
  });
  it("sends «Наборы» to the catalogue while there is no set to show", () => {
    expect(shop("RU").heroHref("bundles")).toBe("/ru/collections/vse-tovary");
  });
});

describe("photo() — the product photo as a real picture", () => {
  const shampoo: Product = {
    id: "system-4-bio-botanical-shampoo", brand: "System 4", name: "Bio Botanical Shampoo — шампунь",
    img: "/shop/img/a-0.webp", gallery: ["/shop/img/a-0.webp", "/shop/img/a-1.webp"],
  };

  it("draws an <img> inside the very frame media() draws, with the same classes", () => {
    const s = shop("RU");
    const html = s.photo(shampoo, 0, "ph card__img", s.photoAlt(shampoo));
    expect(html).toMatch(/^<span class="ph card__img"><img [^>]*><\/span>$/);
    expect(html).toContain('src="/shop/img/a-0.webp"');
    expect(html).not.toContain("background-image");
    // …and the second photo is the second photo
    expect(s.photo(shampoo, 1, "ph card__img2", "")).toContain('src="/shop/img/a-1.webp"');
  });

  it("names the photo by brand and name, in the page's language", () => {
    expect(shop("RU").photoAlt(shampoo)).toBe("System 4 Bio Botanical Shampoo — шампунь");
    expect(shop("EN").photoAlt(shampoo)).toBe("System 4 Bio Botanical Shampoo — shampoo");
    expect(shop("ET").photoAlt(shampoo)).toBe("System 4 Bio Botanical Shampoo — šampoon");
    const s = shop("EN");
    expect(s.photo(shampoo, 0, "ph", s.photoAlt(shampoo))).toContain('alt="System 4 Bio Botanical Shampoo — shampoo"');
    // a repeat of the same product says nothing twice, but still says it is decorative
    expect(s.photo(shampoo, 1, "ph", "")).toContain('alt=""');
  });

  it("is sized before it loads, lazy by default, and first-and-eager for the page's own picture", () => {
    const s = shop("RU");
    const lazy = s.photo(shampoo, 0, "ph", "x");
    expect(lazy).toMatch(/ width="\d+" height="\d+"/);
    expect(lazy).toContain('loading="lazy"');
    expect(lazy).toContain('decoding="async"');
    expect(lazy).not.toContain("fetchpriority");
    const first = s.photo(shampoo, 0, "ph pdp__img", "x", true);
    expect(first).toContain('fetchpriority="high"');
    expect(first).not.toContain("loading=");
  });

  it("puts the owner's small copy on a card, never his full-size upload", () => {
    // the sighting: c-kevin-murphy-flawless-bond-building-styling-lotion's card loaded a 1.39 MB PNG
    const own: Product = {
      id: "c-kevin-murphy-flawless", brand: "Kevin.Murphy", name: "Flawless",
      img: "https://blob.example/flawless.png", gallery: ["https://blob.example/flawless.png"],
      photos: [{ url: "https://blob.example/flawless.png", thumb: "https://blob.example/flawless-thumb.webp" }],
    };
    const s = shop("RU");
    expect(s.photo(own, 0, "ph card__img", "x", false, true)).toContain('src="https://blob.example/flawless-thumb.webp"');
    // the product page still shows the photo itself
    expect(s.photo(own, 0, "ph pdp__img", "x", true)).toContain('src="https://blob.example/flawless.png"');
    // a photo with no small copy is shown as it is
    const bare = { ...own, photos: [{ url: "https://blob.example/flawless.png" }] };
    expect(s.photo(bare, 0, "ph card__img", "x", false, true)).toContain('src="https://blob.example/flawless.png"');
    // …and so is a catalogue product's own file
    expect(s.photo(shampoo, 0, "ph card__img", "x", false, true)).toContain('src="/shop/img/a-0.webp"');
    // a gallery the owner replaced on a catalogue product carries its small copies too
    s.DEMO.gallery[shampoo.id] = [{ url: "/up/new.webp", thumb: "/up/new-thumb.webp" }];
    const replaced = { ...shampoo, gallery: ["/up/new.webp"] };
    expect(s.photo(replaced, 0, "ph card__img", "x", false, true)).toContain('src="/up/new-thumb.webp"');
  });

  it("keeps the model shot filling its frame, and the shop's mark where there is no photo", () => {
    const s = shop("RU");
    expect(s.photo({ ...shampoo, fill: "cover" }, 0, "ph card__img", "x")).toMatch(/^<span class="ph card__img ph--cover"><img /);
    const none = s.photo({ id: "c-new", brand: "X", name: "Y" }, 0, "ph card__img", "x");
    expect(none).toContain("ph--mark");
    expect(none).not.toContain("<img");
  });

  it("escapes what it is handed — an owner's url and a name are data", () => {
    const s = shop("RU");
    const html = s.photo({ id: "q", gallery: ['/a"b.webp'] }, 0, "ph", 'Brand "Q" <name>');
    expect(html).toContain('src="/a&quot;b.webp"');
    expect(html).toContain('alt="Brand &quot;Q&quot; &lt;name&gt;"');
  });
});

describe("the click on a link stays in the shop; the browser keeps the rest", () => {
  const handler = (() => {
    const at = src.indexOf("A link to a page (linkHref");
    expect(at, "the click handler lost its link branch").toBeGreaterThan(0);
    return src.slice(at, src.indexOf("if (d.go) {", at));
  })();
  it("lets a modified click (new tab, new window) through to the browser", () => {
    expect(handler).toContain('t.tagName === "A" && t.hasAttribute("href")');
    expect(handler).toContain("if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;");
  });
  it("stops the browser's own navigation on a plain click, for every kind of page link", () => {
    expect(handler).toContain("e.preventDefault();");
    for (const d of ["d.go ", "d.goCat", "d.goBrand", "d.goProduct", "d.goBundle", "d.page"]) expect(handler).toContain(d);
  });
});

describe("the storefront's page links are links", () => {
  /* The markup itself: a page the shop links to is reached through an <a
     href>, never a <button data-go-…> — the crawler follows nothing else. Not
     part of this: the panel's own «Открыть в магазине» buttons, the bottom
     tab bar, the header's «Кабинет» (an account is no page for a crawler —
     robots.txt keeps it out), and a card's action slot (.card__add —
     «Сообщить о наличии» on a sold-out card, «Смотреть» on a sold-out set),
     which repeats the card's own link a line above it. */
  const FNS = [
    "cardHTML", "bundleCardHTML", "bundleGridHTML", "setsOffHTML", "screenBundles", "screenBundle", "giftTileHTML",
    "screenGift", "screenBlog", "blogCrumbsHTML", "screenBlogPost", "blogProductHTML", "headerHTML", "footer",
    "screenHome", "rail", "screenContact", "screenInfo", "screenDelivery", "screenBrands", "screenNotFound",
    "screenCatalog", "screenProduct", "heroSlideHTML", "consentHTML", "upsellHTML", "screenSearch", "screenDone",
  ];
  it("has no <button data-go…> left in any of them", () => {
    for (const name of FNS) {
      const body = sliceFn(name);
      expect(body, name).not.toMatch(/<button(?![^>]*card__add)[^>]*data-go(?:-cat|-brand|-product|-bundle)?="(?!account")/);
      expect(body, name).not.toMatch(/<button[^>]*data-page="/);
    }
  });
  it("gives every one of those links its address", () => {
    for (const name of FNS) {
      const body = sliceFn(name);
      for (const m of body.matchAll(/<a [^>]*data-(?:go|go-cat|go-brand|go-product|go-bundle|page)="/g)) {
        expect(m[0], name).toMatch(/href="' \+ (linkHref|heroHref)\(/);
      }
    }
  });
});
