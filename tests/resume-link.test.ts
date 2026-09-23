/**
 * The abandoned-cart letter's button, opened where letters are opened.
 *
 * Both letters link to `/shop2/checkout/?resume=<signed token>`. They are
 * read on a phone that never saw the basket, or days later in a browser that
 * has been cleared — an EMPTY basket, not signed in. Until 23.09.2026 that
 * browser was sent to the home page with nothing in the basket and nothing
 * said: firstPaint() decided the route first, /shop2/checkout/ with an empty
 * basket is routeHome(), and routeHome() replaceState()s the address to
 * /shop2/ — query and all — so resumeCart(), which ran after, found no
 * `?resume=` to read. The one browser the link worked in was the one that
 * still had the basket and did not need it.
 *
 * And the second letter's code never reached the order at all: nothing read
 * `p` out of the token, and a code on the `cart` scope matched no line in the
 * browser's own arithmetic (promoLineIn), so the summary showed no discount
 * and orderPayload() sent no code.
 *
 * The boot is sliced out of public/shop2/app.js by source text and run
 * against a tiny browser: `history.replaceState()` really rewrites
 * `location`, because that rewrite IS the bug. The server halves — the token
 * and the route that vouches for its code — are the real ones.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeResumeToken } from "@/lib/flows";
import { quoteFromPromo, type Promo } from "@/lib/promos";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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

type Line = { id: string; size: number; qty: number };
type Product = {
  id: string; name: string; brand: string; price: number;
  stock?: string; sizes?: string[]; stockVar?: Record<string, string>;
};

const CATALOGUE: Product[] = [
  { id: "shampoo", name: "Shampoo", brand: "Davines", price: 30, stock: "in", sizes: ["250 мл", "1000 мл"] },
  { id: "wax", name: "Wax", brand: "Reuzel", price: 20, stock: "in" },
  { id: "comb", name: "Comb", brand: "Proraso", price: 10, stock: "in" },
  { id: "gone", name: "Gone", brand: "Reuzel", price: 15, stock: "out" },
];

const cartLine = (id: string, size: number | null, qty: number) =>
  ({ id, title: id, brand: "", variant: null, size, qty, price: 0 });

/** The letters' own token, from src/lib/flows.ts. */
const LETTER = [cartLine("shampoo", 1, 2), cartLine("wax", null, 1)];

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Lets the fetch → json → apply chain run out — the route is a real, async import. */
async function settle(done: () => boolean, most = 500): Promise<void> {
  for (let i = 0; i < most && !done(); i++) await flush();
}

/** A fetch that answers GET /api/carts/resume/ with the REAL route. */
async function realResumeRoute(url: string): Promise<Response> {
  const { GET } = await import("@/app/api/carts/resume/route");
  return GET(new Request(`https://rempireshop.com${url}`, { headers: { "x-forwarded-for": "203.0.113.7" } }));
}

/**
 * The real firstPaint() with the real router and the real resume functions:
 * a page load at `url` in a browser whose saved basket is `cart`.
 * `applyPromoCode` is a recorder here — what it does is the next describe's.
 */
function boot(url: string, cart: Line[] = [], fetchImpl: (u: string) => Promise<unknown> = realResumeRoute) {
  const u = new URL(url, "https://rempireshop.com");
  const location = { pathname: u.pathname, search: u.search };
  const history = {
    state: null as unknown,
    replaceState(state: unknown, _t: string, to: string) {
      const n = new URL(to, "https://rempireshop.com");
      location.pathname = n.pathname;
      location.search = n.search;
      history.state = state;
    },
  };
  const S = {
    cart: cart.map((l) => ({ ...l })),
    lang: "RU",
    screen: "home",
    coStep: 0,
    shown: 12,
    promo: "",
  };
  const toasts: string[] = [];
  const fetched: string[] = [];
  const applied: unknown[][] = [];
  const body = `
    var pathLang = "RU", preRendered = null, hdrSlot = null, navSlot = null, ovlKey = "";
    var LANG_OF_SEG = { et: "ET", en: "EN", ru: "RU" };
    var SEG_OF_LANG = { RU: "", ET: "/et", EN: "/en" };
    ${slice("langFromPath")}
    ${slice("stripLangPrefix")}
    ${slice("safeDecode")}
    ${slice("here")}
    ${slice("routeHome")}
    ${slice("routeFromPath")}
    ${slice("sizeStockOf")}
    ${slice("sizeOut")}
    ${slice("resumeToken")}
    ${slice("resumePayload")}
    ${slice("resumeCart")}
    ${slice("resumeSay")}
    ${slice("resumeCode")}
    ${slice("firstPaint")}
    firstPaint();
  `;
  const noop = () => {};
  // The body is this repository's own source plus fixed stub text.
  new Function(
    "location", "history", "S", "CATALOGUE", "CART_MAX_QTY", "persist", "render", "toast",
    "trackNav", "blogPrefetchSoon", "restartHero", "intro", "buyFromLink", "heldAsk",
    "acctHinted", "acctLoad", "acctRefresh", "document", "savedHadLang", "fetch", "applyPromoCode",
    body,
  )(
    location, history, S, CATALOGUE, 99, noop, noop, (t: string) => toasts.push(t),
    noop, noop, noop, noop, noop, noop,
    () => false, noop, noop, { addEventListener: noop }, true,
    (url: string) => { fetched.push(url); return fetchImpl(url); },
    (...args: unknown[]) => applied.push(args),
  );
  return { S, toasts, fetched, applied, address: () => location.pathname + location.search };
}

const link = (tok: string, lang = "") => `/shop2${lang}/checkout/?resume=${encodeURIComponent(tok)}`;

describe("the letter's button in a browser that has never seen the basket", () => {
  it("fills the basket — lines, sizes, quantities — and opens the checkout", () => {
    const out = boot(link(makeResumeToken(LETTER)));
    expect(out.S.cart).toEqual([
      { id: "shampoo", size: 1, qty: 2 },
      { id: "wax", size: 0, qty: 1 },
    ]);
    expect(out.S.screen).toBe("checkout");
    expect(out.S.coStep).toBe(1);
    expect(out.toasts).toEqual(["Корзина восстановлена ✓"]);
  });

  it("leaves the checkout's own address behind, so a reload adds nothing", () => {
    const out = boot(link(makeResumeToken(LETTER)));
    expect(out.address()).toBe("/shop2/checkout/");
  });

  it("works from the Estonian and the English letter too", () => {
    const et = boot(link(makeResumeToken(LETTER), "/et"));
    expect(et.S.screen).toBe("checkout");
    expect(et.S.lang).toBe("ET");
    expect(et.address()).toBe("/shop2/et/checkout/");
    expect(boot(link(makeResumeToken(LETTER), "/en")).S.cart).toHaveLength(2);
  });

  it("the first letter carries no code, and the server is not asked about one", () => {
    const out = boot(link(makeResumeToken(LETTER)));
    expect(out.fetched).toEqual([]);
    expect(out.applied).toEqual([]);
  });
});

describe("the same link again, and a basket that is not empty", () => {
  it("opened twice is the same basket, not two of everything", () => {
    const tok = makeResumeToken(LETTER);
    const first = boot(link(tok));
    const second = boot(link(tok), first.S.cart);
    expect(second.S.cart).toEqual(first.S.cart);
  });

  it("raises a line to the letter's count, never adds to it, and keeps the rest", () => {
    const out = boot(link(makeResumeToken(LETTER)), [
      { id: "shampoo", size: 1, qty: 1 },   // fewer than the letter — raised to 2
      { id: "wax", size: 0, qty: 4 },       // more than the letter — kept at 4
      { id: "comb", size: 0, qty: 1 },      // not in the letter — stays
    ]);
    expect(out.S.cart).toEqual([
      { id: "shampoo", size: 1, qty: 2 },
      { id: "wax", size: 0, qty: 4 },
      { id: "comb", size: 0, qty: 1 },
    ]);
    expect(out.S.screen).toBe("checkout");
  });

  it("another volume of the same product is its own line", () => {
    const out = boot(link(makeResumeToken(LETTER)), [{ id: "shampoo", size: 0, qty: 1 }]);
    expect(out.S.cart).toEqual([
      { id: "shampoo", size: 0, qty: 1 },
      { id: "shampoo", size: 1, qty: 2 },
      { id: "wax", size: 0, qty: 1 },
    ]);
  });
});

describe("a link that cannot bring the basket back says so", () => {
  it("an expired one: the home page, an empty basket, and a sentence", () => {
    const stale = makeResumeToken(LETTER, Date.now() - 31 * 86_400_000);
    const out = boot(link(stale));
    expect(out.S.cart).toEqual([]);
    expect(out.S.screen).toBe("home");
    expect(out.address()).toBe("/shop2/");
    expect(out.toasts).toEqual(["Ссылка из письма устарела — корзину не восстановить"]);
  });

  it("an expired one in a browser with a basket: that basket, untouched, and the sentence", () => {
    const stale = makeResumeToken(LETTER, Date.now() - 31 * 86_400_000);
    const out = boot(link(stale), [{ id: "comb", size: 0, qty: 3 }]);
    expect(out.S.cart).toEqual([{ id: "comb", size: 0, qty: 3 }]);
    expect(out.S.screen).toBe("checkout");
    expect(out.address()).toBe("/shop2/checkout/");
    expect(out.toasts).toEqual(["Ссылка из письма устарела — корзину не восстановить"]);
  });

  it("a mangled one (a mail client cut the address): the home page and a sentence", () => {
    for (const tok of ["%%%", "bm90LWpzb24.sig", "eyJ2IjoxfQ.sig"]) {
      const out = boot(`/shop2/checkout/?resume=${tok}`);
      expect(out.S.cart, tok).toEqual([]);
      expect(out.S.screen, tok).toBe("home");
      expect(out.address(), tok).toBe("/shop2/");
      expect(out.toasts, tok).toEqual(["Ссылка из письма повреждена — корзину не восстановить"]);
    }
  });

  it("one whose every product has sold out since: said, not an empty home page", () => {
    const out = boot(link(makeResumeToken([cartLine("gone", null, 1), cartLine("deleted-long-ago", null, 1)])));
    expect(out.S.cart).toEqual([]);
    expect(out.S.screen).toBe("home");
    expect(out.toasts).toEqual(["Товаров из письма больше нет в наличии"]);
  });

  it("no ?resume= at all is an ordinary visit — nothing said", () => {
    const out = boot("/shop2/checkout/", [{ id: "comb", size: 0, qty: 1 }]);
    expect(out.toasts).toEqual([]);
    expect(out.S.screen).toBe("checkout");
  });
});

describe("the second letter: the code in the token", () => {
  it("is confirmed by the server before anything is applied", async () => {
    const tok = makeResumeToken(LETTER, Date.now(), "REM-CART-ABC123");
    const out = boot(link(tok));
    await settle(() => out.applied.length > 0);
    expect(out.fetched).toEqual([`/api/carts/resume/?t=${encodeURIComponent(tok)}`]);
    expect(out.S.promo).toBe("REM-CART-ABC123");
    expect(out.applied).toEqual([[true]]);
  });

  it("is NOT applied when the signature does not hold — and that is said", async () => {
    const tok = makeResumeToken(LETTER, Date.now(), "REM-CART-ABC123");
    const forged = `${tok.split(".")[0]}.not-the-signature`;
    const out = boot(link(forged));
    await settle(() => out.toasts.length > 1);
    // the basket still comes back: ids at a capped quantity are nobody's secret
    expect(out.S.cart).toHaveLength(2);
    expect(out.S.promo).toBe("");
    expect(out.applied).toEqual([]);
    expect(out.toasts).toEqual([
      "Корзина восстановлена ✓",
      "Скидку из письма не удалось проверить — введите код из письма",
    ]);
  });

  it("is left alone where there is no shop behind the page (the static prototype)", async () => {
    const tok = makeResumeToken(LETTER, Date.now(), "REM-CART-ABC123");
    const out = boot(link(tok), [], () => Promise.resolve({ status: 404, json: () => Promise.reject(new Error("html")) }));
    await settle(() => false, 10);
    expect(out.applied).toEqual([]);
    expect(out.toasts).toEqual(["Корзина восстановлена ✓"]);
  });
});

/* ------------------------------------------------------------------------ *
 * The code on the checkout: a 'cart' code has to MATCH something
 * ------------------------------------------------------------------------ */

const CART_PROMO: Promo = {
  code: "REM-CART-ABC123", kind: "percent", value: 5, minSubtotal: 0, startsAt: null, endsAt: null,
  maxUses: 1, used: 0, active: true, note: null, createdAt: "2026-09-20T00:00:00Z",
  scope: "cart", scopeValue: "8a0c3f1e-cart", scopeLines: ["shampoo", "wax"],
};

/**
 * The real resumeCode() → applyPromoCode() → promoLive()/discount() over a
 * restored basket. POST /api/promos/check answers with quoteFromPromo() — the
 * server's own pricing — in the route's shape, `lines` included.
 */
function checkout(cart: Line[], answer: "ok" | "used_up" = "ok", withLines = true) {
  const S = {
    cart: cart.map((l) => ({ ...l })),
    promo: "", promoInfo: null as null | Record<string, unknown>, promoErr: "", promoMin: 0,
    promoErrScope: "", promoErrValue: "", promoBusy: false, giftErr: "", giftCard: null,
  };
  const toasts: string[] = [];
  const focused: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const byId = (id: string) => CATALOGUE.find((p) => p.id === id) ?? null;
  const unit = (l: Line) => (byId(l.id)?.price ?? 0) * (l.id === "shampoo" && l.size === 1 ? 3 : 1);
  const postJSON = (_url: string, req: { code: string; subtotal: number; shipping: number; items: Array<{ id: string; kind: string; brand: string; sum: number }> }) => {
    posted.push(req);
    const promo = answer === "used_up" ? { ...CART_PROMO, used: 1 } : CART_PROMO;
    const q = quoteFromPromo(promo, req.subtotal, req.shipping, new Date(), req.items);
    const body = q.ok
      ? { ok: true, code: q.code, kind: q.kind, value: q.value, discount: q.discount, freeShipping: q.freeShipping,
          minSubtotal: q.minSubtotal, scope: q.scope, scopeValue: q.scopeValue, base: q.base,
          ...(withLines ? { lines: q.lines } : {}) }
      : { ok: false, error: q.error, code: q.code, minSubtotal: q.minSubtotal, scope: q.scope, scopeValue: q.scopeValue };
    return Promise.resolve({ body, status: 200 });
  };
  const body = `
    ${slice("resumeCode")}
    ${slice("promoSaid")}
    ${slice("applyPromoCode")}
    ${slice("promoGoods")}
    ${slice("promoLines")}
    ${slice("promoBrandKey")}
    ${slice("promoLineIn")}
    ${slice("promoBase")}
    ${slice("promoLive")}
    ${slice("discount")}
    return { resumeCode: resumeCode, promoLive: promoLive, discount: discount, promoGoods: promoGoods };
  `;
  const noop = () => {};
  // The body is this repository's own source plus fixed stub text.
  const api = new Function(
    "S", "fetch", "postJSON", "apiSeen", "render", "refocus", "toast", "shipCost", "lineUnit", "byIdOrNull",
    body,
  )(
    S, realResumeRoute, postJSON, noop, noop, (sel: string) => focused.push(sel), (t: string) => toasts.push(t),
    () => 3.49, unit, byId,
  ) as { resumeCode: (t: string) => void; promoLive: () => unknown; discount: () => number; promoGoods: () => number };
  return { S, api, toasts, focused, posted };
}

/** The promo box has had its answer, whichever it was. */
const answered = (c: { S: { promoBusy: boolean; promoInfo: unknown; promoErr: string } }) =>
  () => !c.S.promoBusy && (c.S.promoInfo !== null || c.S.promoErr !== "");

describe("the letter's code on the checkout", () => {
  const restored: Line[] = [
    { id: "shampoo", size: 1, qty: 2 },   // 2 × 90 € = 180 €
    { id: "wax", size: 0, qty: 1 },       // 20 €
  ];

  it("is applied, shows as a discount, and goes into the order", async () => {
    const c = checkout(restored);
    c.api.resumeCode(makeResumeToken(LETTER, Date.now(), CART_PROMO.code));
    await settle(answered(c));
    expect(c.S.promo).toBe(CART_PROMO.code);
    expect(c.S.promoInfo).toMatchObject({ code: CART_PROMO.code, scope: "cart", lines: ["shampoo", "wax"] });
    // 5 % of 200 € — the summary's figure
    expect(c.api.discount()).toBe(10);
    // …and promoLive() is what orderPayload() sends as discountCode
    expect(c.api.promoLive()).toMatchObject({ code: CART_PROMO.code });
    expect(c.toasts).toEqual([]);
    // nobody pressed «Применить»: focus is not dragged down to it
    expect(c.focused).toEqual([]);
  });

  it("takes nothing off what the shopper added after the letter — the server's own figure", async () => {
    const withComb = [...restored, { id: "comb", size: 0, qty: 4 }];
    const c = checkout(withComb);
    c.api.resumeCode(makeResumeToken(LETTER, Date.now(), CART_PROMO.code));
    await settle(answered(c));
    const server = quoteFromPromo(CART_PROMO, 240, 3.49, new Date(), c.posted[0].items as never);
    expect(server.discount).toBe(10);
    expect(c.api.discount()).toBe(server.discount);
  });

  it("a refused code (already spent) is said, and nothing is taken off", async () => {
    const c = checkout(restored, "used_up");
    c.api.resumeCode(makeResumeToken(LETTER, Date.now(), CART_PROMO.code));
    await settle(answered(c));
    expect(c.S.promoInfo).toBeNull();
    expect(c.S.promoErr).toBe("used_up");
    expect(c.api.discount()).toBe(0);
    expect(c.toasts).toEqual(["Скидку из письма применить не удалось — причина под полем промокода"]);
  });

  it("a cart code without its list matches nothing — the server's rule, not the whole basket", async () => {
    const c = checkout(restored, "ok", false);
    c.api.resumeCode(makeResumeToken(LETTER, Date.now(), CART_PROMO.code));
    await settle(answered(c));
    expect(c.api.discount()).toBe(0);
    expect(c.api.promoLive()).toBeNull();
  });
});
