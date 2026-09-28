/**
 * «Blog and Sets will be off initially, before any blog post is written and
 * any set by Renat done» — Dim, 28.09.2026.
 *
 * The go-live reset deletes every set and every post (tools/go-live-reset.mjs
 * --test-content). From then on an empty shelf must leave no trace anywhere a
 * visitor or a crawler looks, and it must come back by itself — no switch to
 * remember — the moment Renat publishes the first article or switches on the
 * first set. The places it had to be taught, each proved here:
 *
 *   · app.js: «Наборы» / «Блог» in the header (drawn once, then patched), the
 *     home and category rows, the gift card's crumb, a banner aimed at sets,
 *     and /shop2/sets/, /shop2/set/<id>/, /shop2/blog/ becoming the ordinary
 *     404 screen once the shop KNOWS the shelf is empty — never in the tenth
 *     of a second before the answer lands;
 *   · app.js again: public/shop/bundles.js, the file the table was seeded
 *     from, is still on every page, and every set in it is one the owner
 *     called made up — so before /api/bundles/ answers, only the sets the
 *     BUILD saw on sale (#setsdata) may be shown;
 *   · the server: /shop2/blog/ and /shop2/sets/ answer 404 while empty, and
 *     an empty `bundles` table no longer falls back to the file at the till;
 *   · the prerender: which sets get pages is the table's answer, not the
 *     file's (liveBundles()).
 *
 * The browser pieces are sliced out of public/shop2/app.js by source text and
 * run against stubs, as tests/blog-panel-shop.test.ts does — retyping them
 * would test this file instead of the shop.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import { blogListPageResponse } from "@/lib/blog-page";
import { notFoundPageResponse } from "@/lib/notfound-page";
import { createOrder, OrderError } from "@/lib/orders";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { applyBundlePrices, liveBundles } from "../tools/lib/bundles-export.mjs";
import { setupDb, teardownDb } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** `function <name>(…) { … }` out of app.js, by brace matching. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** `var <name> = …;` out of app.js, up to the `;` at depth 0. */
function sliceVar(name: string): string {
  const start = src.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`no terminating ; for var ${name} in app.js`);
}

/* ---------- the pieces, wired to stubs ---------------------------------- */

type Set_ = { id: string; active?: boolean; cat?: string };
type ShopState = {
  bundles: Set_[] | null;
  bundlesFailed: boolean;
  screen: string;
  lang: string;
  blogLists: Record<string, { posts: unknown[]; total: number; failed?: boolean }>;
  blogPosts: Record<string, { post: unknown; failed?: boolean }>;
  blogSlug: string;
  brand: string;
  cat: string;
  langOpen: boolean;
  query: string;
};

/** The file the shop still loads on every page: eight sets the owner called made up. */
const FILE: Set_[] = ["beard-start", "shave-smooth", "tattoo-care", "styling-duo", "gift-rempire", "hair-young-again", "face-basic", "barberism"].map(
  (id) => ({ id, cat: "hair" }),
);

const FNS = [
  "setsOn", "allBundlesRaw", "bundlesBeforeAnswer", "setsKnown", "setsShelf", "allBundles", "bundleById",
  "shownBundleById", "blogKey", "blogList", "blogEntry", "blogShown", "blogKnownEmpty", "settleEmptyScreens",
  "heroGoAttr", "headerHTML", "patchHeader",
];

type Shop = {
  S: ShopState;
  allBundles(): Set_[];
  setsKnown(): boolean;
  bundleById(id: string): Set_ | null;
  shownBundleById(id: string): Set_ | null;
  blogShown(): boolean;
  blogKnownEmpty(): boolean;
  settleEmptyScreens(): void;
  heroGoAttr(go: string): string;
  headerHTML(): string;
  patchHeader(): void;
  nav: FakeNav;
};

/* A header whose nav is what patchHeader() adds to and removes from — the
   header is built ONCE and patched for ever after, which is exactly why the
   two entries have to be handled there and not only in headerHTML(). */
type FakeBtn = { attrs: Record<string, string>; dataset: Record<string, string>; textContent: string; setAttribute(k: string, v: string): void; remove(): void };
type FakeNav = { children: FakeBtn[]; keys(): string[] };
function fakeHeader(initial: string[]) {
  const camel = (s: string) => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  const nav: FakeNav & { querySelector(sel: string): FakeBtn | null; insertBefore(el: FakeBtn, ref: FakeBtn | null): void; appendChild(el: FakeBtn): void } = {
    children: [],
    keys: () => nav.children.map((b) => Object.keys(b.attrs).find((k) => k.startsWith("data-nav-")) || b.attrs["data-go-cat"] || "?"),
    querySelector(sel) {
      const m = /^\[([a-z-]+)\]$/.exec(sel);
      return (m && nav.children.find((b) => m[1] in b.attrs)) || null;
    },
    insertBefore(el, ref) {
      const at = ref ? nav.children.indexOf(ref) : -1;
      if (at < 0) nav.children.push(el);
      else nav.children.splice(at, 0, el);
    },
    appendChild(el) { nav.children.push(el); },
  };
  const button = (): FakeBtn => {
    const b: FakeBtn = {
      attrs: {},
      dataset: {},
      textContent: "",
      setAttribute(k, v) {
        b.attrs[k] = v;
        if (k.startsWith("data-")) b.dataset[camel(k.slice(5))] = v;
      },
      remove() { nav.children.splice(nav.children.indexOf(b), 1); },
    };
    return b;
  };
  for (const key of initial) {
    const b = button();
    b.setAttribute(`data-nav-${key}`, "");
    nav.children.push(b);
  }
  const plain = () => ({ style: {} as Record<string, string>, innerHTML: "", outerHTML: "", hidden: false, value: "", setAttribute() {} });
  const hdr = {
    firstChild: {},
    querySelector(sel: string) {
      if (sel === ".hdr__nav") return nav;
      return plain();
    },
    querySelectorAll() { return nav.children; },
  };
  const document = { activeElement: null, createElement: () => button(), getElementById: () => null };
  return { nav, hdr, document };
}

function shop(opts: {
  build?: string[] | null;          // #setsdata on the page — null: no such block
  answer?: Set_[] | null;           // what /api/bundles/ said — null: not yet
  failed?: boolean;                 // …or that it said nothing
  switchOn?: boolean;               // DEMO.bundles
  blog?: { posts: unknown[]; total: number; failed?: boolean } | null;
  blogAtBuild?: boolean;            // #blogdata on the page
  screen?: string;
  nav?: string[];
} = {}): Shop {
  const S: ShopState = {
    bundles: opts.answer === undefined ? null : opts.answer,
    bundlesFailed: !!opts.failed,
    screen: opts.screen || "home",
    lang: "RU",
    blogLists: opts.blog ? { RU: opts.blog } : {},
    blogPosts: {},
    blogSlug: "",
    brand: "",
    cat: "all",
    langOpen: false,
    query: "",
  };
  const DEMO = { bundles: opts.switchOn === false ? false : true };
  const { nav, hdr, document } = fakeHeader(opts.nav || ["gift", "brands"]);
  const run = new Function(
    "S", "DEMO", "BUNDLES", "SETS_AT_BUILD", "BLOG_AT_BUILD", "document", "hdrSlot",
    "announceHTML", "announceBody", "towerDraw", "icon", "CATS", "esc", "cartCount", "FLAG", "LANGS", "translateTree",
    FNS.map(slice).join("\n") +
      "\nreturn { allBundles: allBundles, setsKnown: setsKnown, bundleById: bundleById, shownBundleById: shownBundleById," +
      " blogShown: blogShown, blogKnownEmpty: blogKnownEmpty, settleEmptyScreens: settleEmptyScreens," +
      " heroGoAttr: heroGoAttr, headerHTML: headerHTML, patchHeader: patchHeader };",
  );
  const api = run(
    S, DEMO, FILE, opts.build === undefined ? null : opts.build, !!opts.blogAtBuild, document, hdr,
    () => "", () => "", () => "", () => "", [{ id: "hair", name: "Уход за волосами" }], (s: string) => String(s), () => 0,
    { RU: "" }, [], () => {},
  );
  return Object.assign(api, { S, nav });
}

/* ---------- sets: what may be SHOWN ------------------------------------- */

describe("sets — nothing the database does not sell is shown", () => {
  it("shows none of the file's sets on a page whose build saw no set on sale", () => {
    const s = shop({ build: [] });
    expect(s.allBundles()).toEqual([]);
    expect(s.shownBundleById("beard-start")).toBeNull();
    // …while a set already in somebody's cart is still priced from the file
    expect(s.bundleById("bundle:beard-start")?.id).toBe("beard-start");
    expect(s.setsKnown()).toBe(false);
  });

  it("shows none of them on a page with no build list at all (a request-time page)", () => {
    expect(shop({ build: null }).allBundles()).toEqual([]);
  });

  it("shows exactly the ones the build saw, until the answer lands", () => {
    const s = shop({ build: ["shave-smooth", "barberism"] });
    expect(s.allBundles().map((b) => b.id)).toEqual(["shave-smooth", "barberism"]);
    expect(s.shownBundleById("shave-smooth")?.id).toBe("shave-smooth");
    expect(s.shownBundleById("beard-start")).toBeNull();
  });

  it("follows the answer once it lands — an empty table is an empty shelf", () => {
    const s = shop({ build: ["shave-smooth"], answer: [] });
    expect(s.allBundles()).toEqual([]);
    expect(s.setsKnown()).toBe(true);
  });

  it("comes back by itself with the first set Renat switches on", () => {
    const s = shop({ build: [], answer: [{ id: "renat-first", cat: "beard" }] });
    expect(s.allBundles().map((b) => b.id)).toEqual(["renat-first"]);
    expect(s.shownBundleById("renat-first")?.id).toBe("renat-first");
  });

  it("keeps a hidden set off the shelf, and the owner's switch still wins", () => {
    expect(shop({ answer: [{ id: "a", active: false }] }).allBundles()).toEqual([]);
    expect(shop({ answer: [{ id: "a" }], switchOn: false }).allBundles()).toEqual([]);
  });

  it("falls back to what the build saw when the answer never comes", () => {
    const s = shop({ build: ["face-basic"], failed: true });
    expect(s.setsKnown()).toBe(true);
    expect(s.allBundles().map((b) => b.id)).toEqual(["face-basic"]);
  });

  it("reads the build's list off the page, and nothing when the page has none", () => {
    const read = (el: { textContent: string } | null) =>
      new Function("document", `${sliceVar("SETS_AT_BUILD")} return SETS_AT_BUILD;`)({ getElementById: () => el });
    expect(read({ textContent: '["beard-start","shave-smooth"]' })).toEqual(["beard-start", "shave-smooth"]);
    expect(read({ textContent: "[]" })).toEqual([]);
    expect(read(null)).toBeNull();
    expect(read({ textContent: "not json" })).toBeNull();
  });

  it("sends a banner aimed at sets to the catalogue while there is none", () => {
    expect(shop({ answer: [] }).heroGoAttr("bundles")).toBe('data-go-cat="all"');
    expect(shop({ answer: [{ id: "x" }] }).heroGoAttr("bundles")).toBe('data-go="bundles"');
  });

  it("drops the «Наборы» crumb over the gift card while there is no set", () => {
    const gift = slice("screenGift");
    expect(gift).toContain("(allBundles().length");
    expect(gift).not.toContain("(setsOn()");
  });
});

/* ---------- blog: what may be SHOWN ------------------------------------- */

describe("blog — «Блог» is there only while there is an article", () => {
  it("is hidden when the list says there is none", () => {
    const s = shop({ blog: { posts: [], total: 0 } });
    expect(s.blogShown()).toBe(false);
    expect(s.blogKnownEmpty()).toBe(true);
  });

  it("is shown when the list has an article", () => {
    const s = shop({ blog: { posts: [{ slug: "a" }], total: 1 } });
    expect(s.blogShown()).toBe(true);
    expect(s.blogKnownEmpty()).toBe(false);
  });

  it("trusts what the build saw until the list lands — and after a failed list", () => {
    expect(shop({ blogAtBuild: true }).blogShown()).toBe(true);
    expect(shop({ blogAtBuild: false }).blogShown()).toBe(false);
    const down = shop({ blog: { posts: [], total: 0, failed: true }, blogAtBuild: true });
    expect(down.blogShown()).toBe(true);
    expect(down.blogKnownEmpty()).toBe(false); // an outage is not an empty blog
  });

  it("reads the build's articles off #blogdata, in any language", () => {
    const read = (el: { textContent: string } | null) =>
      new Function("document", `${sliceVar("BLOG_AT_BUILD")} return BLOG_AT_BUILD;`)({ getElementById: () => el });
    expect(read({ textContent: JSON.stringify({ lang: "ET", posts: [{ slug: "a" }], total: 3 }) })).toBe(true);
    expect(read(null)).toBeFalsy();
  });
});

/* ---------- the header, drawn once and patched --------------------------- */

describe("the header", () => {
  it("draws neither entry for an empty shop, and both for a full one", () => {
    const empty = shop({ answer: [], blog: { posts: [], total: 0 } }).headerHTML();
    expect(empty).not.toContain("data-nav-bundles");
    expect(empty).not.toContain("data-nav-blog");
    expect(empty).toContain("data-nav-gift"); // the gift card is not a set and stays
    const full = shop({ answer: [{ id: "x" }], blog: { posts: [{}], total: 1 } }).headerHTML();
    expect(full).toContain("data-nav-bundles");
    expect(full).toContain("data-nav-blog");
  });

  it("takes both entries out of a header drawn before the answers", () => {
    const s = shop({ answer: [], blog: { posts: [], total: 0 }, nav: ["bundles", "gift", "brands", "blog"] });
    s.patchHeader();
    expect(s.nav.keys()).toEqual(["data-nav-gift", "data-nav-brands"]);
  });

  it("puts them back by itself — «Наборы» before the gift card, «Блог» last", () => {
    const s = shop({ answer: [], blog: { posts: [], total: 0 }, nav: ["gift", "brands"] });
    s.patchHeader();
    expect(s.nav.keys()).toEqual(["data-nav-gift", "data-nav-brands"]);
    s.S.bundles = [{ id: "renat-first" }];
    s.S.blogLists.RU = { posts: [{ slug: "first" }], total: 1 };
    s.patchHeader();
    expect(s.nav.keys()).toEqual(["data-nav-bundles", "data-nav-gift", "data-nav-brands", "data-nav-blog"]);
    s.patchHeader(); // idempotent
    expect(s.nav.keys()).toHaveLength(4);
  });

  it("patches the header when the blog list lands on any screen, not only on the blog", () => {
    const sync = slice("blogSyncList");
    expect(sync).toContain("navBefore !== blogShown()");
    expect(sync).toContain("patchHeader()");
  });
});

/* ---------- the addresses become the ordinary 404, once known ----------- */

describe("an empty shelf's address is the 404 screen — once the shop knows", () => {
  const settled = (o: Parameters<typeof shop>[0]) => {
    const s = shop(o);
    s.settleEmptyScreens();
    return s.S.screen;
  };

  it("turns /sets/ and /set/<id>/ into «Страница не найдена» after an empty answer", () => {
    expect(settled({ screen: "bundles", answer: [] })).toBe("notfound");
    expect(settled({ screen: "bundle", answer: [] })).toBe("notfound");
    // with the switch off too: nothing to be «недоступны» about
    expect(settled({ screen: "bundles", answer: [], switchOn: false })).toBe("notfound");
  });

  it("waits while the answer is out — an empty list then means nothing", () => {
    expect(settled({ screen: "bundles", build: [] })).toBe("bundles");
    expect(settled({ screen: "blog" })).toBe("blog");
  });

  it("leaves a shop with sets alone, whatever set page is asked for", () => {
    expect(settled({ screen: "bundles", answer: [{ id: "x" }] })).toBe("bundles");
    expect(settled({ screen: "bundle", answer: [{ id: "x" }] })).toBe("bundle"); // «Набор не найден», as before
    // the switch off with sets on sale is still «Наборы сейчас недоступны»
    expect(settled({ screen: "bundles", answer: [{ id: "x" }], switchOn: false })).toBe("bundles");
  });

  it("turns /blog/ into the 404 after an empty list, not after a failed one", () => {
    expect(settled({ screen: "blog", blog: { posts: [], total: 0 } })).toBe("notfound");
    expect(settled({ screen: "blog", blog: { posts: [], total: 0, failed: true } })).toBe("blog");
    expect(settled({ screen: "blog", blog: { posts: [{}], total: 1 } })).toBe("blog");
  });

  it("turns an article page into the 404 only once the article itself is known missing", () => {
    const s = shop({ screen: "blogpost", blog: { posts: [], total: 0 } });
    s.S.blogSlug = "first";
    s.settleEmptyScreens();
    expect(s.S.screen).toBe("blogpost"); // not asked yet: a minute-old list must not 404 a new article
    s.S.blogPosts["RU:first"] = { post: { slug: "first" } };
    s.settleEmptyScreens();
    expect(s.S.screen).toBe("blogpost");
    s.S.blogPosts["RU:first"] = { post: null };
    s.settleEmptyScreens();
    expect(s.S.screen).toBe("notfound");
  });

  it("is applied at the top of every render, and takes the server's 404 at boot", () => {
    expect(slice("renderImpl")).toMatch(/var body;\s*settleEmptyScreens\(\);/);
    const boot = slice("firstPaint");
    expect(boot).toContain('preRendered.querySelector(".nf")');
    expect(boot).toMatch(/S\.screen === "blog" \|\| S\.screen === "bundles"/);
  });

  it("offers no way «back into the blog» from a missing article when the blog is empty", () => {
    expect(slice("screenBlogPost")).toContain("(blogShown() ? '<p><button class=\"link\" data-go=\"blog\">Вернуться в блог</button></p>' : \"\")");
  });

  it("never promises «Наборы скоро появятся» any more", () => {
    expect(slice("screenBundles")).not.toContain("<p class=\"muted\">Наборы скоро появятся.</p>");
  });
});

/* ---------- the prerender: which sets get pages ------------------------- */

describe("the prerender writes set pages only for sets the table sells", () => {
  const file = [{ id: "a", sum: 10, price: 9 }, { id: "b", sum: 10, price: 9 }, { id: "c", sum: 10, price: 9 }];

  it("keeps the file's list when there was no database to ask", () => {
    expect(liveBundles(file, null)).toEqual(file);
  });

  it("writes none for an empty table — the shop after the go-live reset", () => {
    expect(liveBundles(file, {})).toEqual([]);
  });

  it("writes the ones on sale, and prices them from the table", () => {
    const rows = { a: { price: 7, discountPct: null, active: true }, b: { price: null, discountPct: null, active: false } };
    const out = applyBundlePrices(liveBundles(file, rows), rows);
    expect(out.map((b: { id: string }) => b.id)).toEqual(["a"]);
    expect(out[0].price).toBe(7);
  });

  it("puts the build's set ids on every page it writes, the shell included", () => {
    const tool = readFileSync(new URL("../tools/prerender-shop2.mjs", import.meta.url), "utf8");
    expect(tool).toContain("liveBundles(");
    expect(tool).toContain("${blogDataScript(spec.lang.code)}${setsDataScript()}");
    expect(tool).toContain("spec.content + blogDataScript(spec.lang.code) + setsDataScript()");
    const check = readFileSync(new URL("../tools/check-prerender.mjs", import.meta.url), "utf8");
    expect(check).toContain('id="setsdata"'); // the check reads the same list, not the whole file
  });
});

/* ---------- the server ---------------------------------------------------- */

describe("the server, with an empty blog and no sets", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("answers /shop2/blog/ with the ordinary 404 page while there is no article", async () => {
    await exec("delete from posts");
    for (const [seg, lang] of [["", "ru"], ["et", "et"], ["en", "en"]] as const) {
      const res = await blogListPageResponse(seg);
      expect(res.status, seg || "ru").toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain(`<html lang="${lang}"`);
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain('class="sec nf"'); // the same block app.js takes the server's word from
    }
  });

  it("serves the listing again, by itself, once an article is published", async () => {
    await query("insert into posts (slug, status, title, body, published_at) values ('first', 'published', $1::jsonb, '{}'::jsonb, now())", [
      JSON.stringify({ RU: "Первая статья" }),
    ]);
    const res = await blogListPageResponse("");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Первая статья");
    // a draft alone is still no blog
    await exec("delete from posts");
    await query("insert into posts (slug, status, title, body) values ('draft', 'draft', '{\"RU\":\"x\"}'::jsonb, '{}'::jsonb)");
    expect((await blogListPageResponse("")).status).toBe(404);
  });

  it("answers /shop2/sets/ with the 404 page while no set is on sale, and the shell once one is", async () => {
    // the seeded sets (120_bundles.sql) are on sale: the page exists
    expect((await notFoundPageResponse("/shop2/sets/")).status).toBe(200);
    await exec("update bundles set active = false");
    for (const p of ["/shop2/sets/", "/shop2/et/sets/", "/shop2/en/sets/"]) {
      const res = await notFoundPageResponse(p);
      expect(res.status, p).toBe(404);
      expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow">');
    }
    await exec("update bundles set active = true where id = 'beard-start'");
    expect((await notFoundPageResponse("/shop2/sets/")).status).toBe(200);
  });

  it("does not sell the file's sets from an EMPTY table — only from an unreadable one", async () => {
    type Min = { id: string; s: string };
    const V = variants as Record<string, unknown>;
    const plain = (catalogueMin as Min[]).find((p) => p.s === "in" && !V[p.id])!;
    const order = (id: string) =>
      createOrder({
        lang: "ru",
        items: [{ id, qty: 1 }],
        customer: { name: "Тест", email: "empty.shelf@example.com", phone: "+372 5555 5555" },
        shipping: { method: "parcel", country: "EE" },
      } as Parameters<typeof createOrder>[0]);
    await exec("delete from bundles");
    const err = await order("bundle:beard-start").catch((e) => e);
    expect(err).toBeInstanceOf(OrderError);
    expect(err.code).toBe("bundle_unknown");
    // and an ordinary product still sells
    await expect(order(plain.id)).resolves.toBeTruthy();
    expect((await notFoundPageResponse("/shop2/sets/")).status).toBe(404);
    expect((await notFoundPageResponse("/shop2/set/beard-start/")).status).toBe(404);
  });
});
