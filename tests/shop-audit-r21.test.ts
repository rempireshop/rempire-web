/**
 * Round 21 — the storefront half of the audit's medium and low findings.
 *
 * Every one of these is a place where the shop showed the shopper a number, a
 * promise or a row it then did not honour:
 *
 *   · the cart drawer kept the rows it was drawn with after a background feed
 *     took a line out of the basket, and `data-cline` is an INDEX;
 *   · the abandoned-cart letter put a sold-out product back in the basket
 *     that «В корзину» would have refused, to be turned away as a whole order
 *     at the last tap of the checkout;
 *   · the gift page promised the card «не сгорает» two paragraphs above «Карта
 *     действует год со дня покупки»;
 *   · the free-delivery upsell quoted one rung of the ladder and added
 *     another, and could offer the product whose page was open underneath the
 *     drawer — whose «+» then added ITS quantity and ITS volume;
 *   · «Сначала дешевле» sorted on a price no card prints;
 *   · the product's JSON-LD glued the shop's origin onto photo URLs that were
 *     already absolute.
 *
 * Same technique as tests/checkout-parity.test.ts and tests/shop-lost-answer.test.ts:
 * the functions are sliced out of public/shop2/app.js **by source text** and run
 * against stubs, so this tests the shop's own code and not a retyped copy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

type Product = {
  id: string; brand: string; name: string; cat: string; stock?: string;
  price: number; prices?: number[]; sizes?: string[]; priceFrom?: boolean;
};

/* ------------------------------------------------------------------------ *
 * 1. A background feed that drops a cart line redraws the open drawer
 * ------------------------------------------------------------------------ */

describe("loadServerOverrides: an open drawer after the feed drops a line", () => {
  /** The real loadServerOverrides(), with everything it calls stubbed. */
  function run(opts: { cartOpen: boolean; drops: boolean }): Promise<string[]> {
    const calls: string[] = [];
    const S = { cart: [{ id: "a" }, { id: "b" }], cartOpen: opts.cartOpen, screen: "catalog" };
    const body = `
      ${slice("loadServerOverrides")}
      return loadServerOverrides();
    `;
    return (new Function(
      "apiJson", "FEED_FETCH", "adoptServer", "demoSave", "applyDemoOverrides",
      "bootHeld", "patchDelivery", "patchSummary", "render", "rebuildCart", "noop", "S", "SRV",
      body,
    )(
      () => Promise.resolve({ status: 200, body: { ok: true } }),
      {},
      () => { if (opts.drops) S.cart = S.cart.slice(0, 1); calls.push("adopt"); },
      () => calls.push("demoSave"),
      () => calls.push("applyDemoOverrides"),
      false,
      () => calls.push("patchDelivery"),
      () => calls.push("patchSummary"),
      () => calls.push("render"),
      () => calls.push("rebuildCart"),
      () => {},
      S,
      {},
    ) as Promise<void>).then(() => calls);
  }

  it("redraws the list when the drawer is open and a line went", async () => {
    expect(await run({ cartOpen: true, drops: true })).toContain("rebuildCart");
  });

  it("leaves the drawer alone when nothing was dropped", async () => {
    expect(await run({ cartOpen: true, drops: false })).not.toContain("rebuildCart");
  });

  it("does nothing extra when no drawer is open", async () => {
    expect(await run({ cartOpen: false, drops: true })).not.toContain("rebuildCart");
  });
});

/* ------------------------------------------------------------------------ *
 * 2. ?resume=… never puts a sold-out product back in the basket
 * ------------------------------------------------------------------------ */

describe("resumeCart: the abandoned-cart link and stock", () => {
  function token(items: Array<{ id: string; q?: number; s?: number }>): string {
    return `${Buffer.from(JSON.stringify({ i: items }), "utf8").toString("base64url")}.sig`;
  }

  /** The real resumeCart() over a two-product catalogue, one of them out. */
  function run(items: Array<{ id: string; q?: number; s?: number }>) {
    const CATALOGUE: Product[] = [
      { id: "in", brand: "B", name: "In", cat: "hair", stock: "in", price: 10 },
      { id: "gone", brand: "B", name: "Gone", cat: "hair", stock: "out", price: 10 },
    ];
    const S = { cart: [] as Array<{ id: string; size: number; qty: number }> };
    const toasts: string[] = [];
    const body = `${slice("resumeCart")} resumeCart();`;
    new Function("location", "CATALOGUE", "S", "CART_MAX_QTY", "persist", "history", "render", "toast", body)(
      { search: `?resume=${encodeURIComponent(token(items))}`, pathname: "/shop2/" },
      CATALOGUE,
      S,
      12,
      () => {},
      { state: null, replaceState: () => {} },
      () => {},
      (t: string) => toasts.push(t),
    );
    return { cart: S.cart, toasts };
  }

  it("restores a line that is in stock", () => {
    expect(run([{ id: "in", q: 2 }]).cart).toEqual([{ id: "in", size: 0, qty: 2 }]);
  });

  it("drops the sold-out line instead of letting the checkout refuse the order", () => {
    expect(run([{ id: "in", q: 1 }, { id: "gone", q: 1 }]).cart)
      .toEqual([{ id: "in", size: 0, qty: 1 }]);
  });

  it("says nothing at all when every line of the letter has sold out", () => {
    const out = run([{ id: "gone", q: 1 }]);
    expect(out.cart).toEqual([]);
    expect(out.toasts).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * 3. The gift page does not contradict itself
 * ------------------------------------------------------------------------ */

describe("the gift-card page and the year it is valid for", () => {
  it("no longer promises the card does not expire, in any of the three", () => {
    expect(src).not.toContain("не сгорает");
    expect(src).not.toContain("ega aegu");
    expect(src).not.toContain("expire on you");
  });

  it("still says the card is valid for a year — that is the true half", () => {
    expect(src).toContain("Карта действует год со дня покупки.");
  });

  it("and the intro is still there, all three languages in step", () => {
    const ru = "Работает на весь магазин. После оплаты придёт письмо с кодом — вам или сразу получателю.";
    // the RU source, plus one dictionary key per other language
    expect(src.split(ru).length - 1).toBe(3);
  });
});

/* ------------------------------------------------------------------------ *
 * 4. The cart's free-delivery upsell
 * ------------------------------------------------------------------------ */

describe("upsellHTML: the price it quotes is the price the «+» adds", () => {
  /**
   * The real upsellHTML() with the real price stack under it — sizePrice(),
   * proPrice(), shownPrice(), cardSizes(), cardSizeIdx(), cardPriceText() —
   * over a catalogue whose ladder is NOT in price order, which is the case
   * `p.price` got wrong (RE.STORE: 36 € for 40 мл, 7 € for 200 мл).
   */
  function run(opts: { screen?: string; productId?: string; cart?: string[] } = {}): string {
    const CATALOGUE: Product[] = [
      {
        id: "ladder", brand: "RE", name: "Store", cat: "hair", stock: "in",
        // p.price is prices[0] — the DEAREST rung here
        price: 36, prices: [36, 7], sizes: ["40 мл", "200 мл"], priceFrom: true,
      },
      { id: "plain", brand: "PL", name: "Plain", cat: "hair", stock: "in", price: 12 },
      { id: "open", brand: "OP", name: "Open", cat: "hair", stock: "in", price: 9 },
      { id: "incart", brand: "IC", name: "InCart", cat: "hair", stock: "in", price: 5 },
    ];
    const S = {
      cart: (opts.cart ?? ["incart"]).map((id) => ({ id })),
      screen: opts.screen ?? "catalog",
      productId: opts.productId ?? "",
      pro: null,
    };
    const body = `
      ${slice("sizePrice")}
      ${slice("proPrice")}
      ${slice("shownPrice")}
      ${slice("cardSizes")}
      ${slice("cardSizeIdx")}
      ${slice("cardPriceText")}
      ${slice("upsellHTML")}
      return upsellHTML(SUM, THR);
    `;
    return new Function(
      "CATALOGUE", "S", "byId", "complementsFor", "media", "esc", "eur", "cartSumRetail", "SUM", "THR",
      body,
    )(
      CATALOGUE,
      S,
      (id: string) => CATALOGUE.find((p) => p.id === id) ?? CATALOGUE[0],
      () => [],
      () => "",
      (s: string) => String(s),
      (n: number) => `${n} €`,
      () => 0,
      // 52 € in the basket against a 59 € threshold: a 7 € gap
      52,
      59,
    ) as string;
  }

  it("picks and prints the rung the add will basket, not the first one", () => {
    const html = run();
    // 7 € closes the 7 € gap and is what cardSizeIdx() would add. On p.price
    // the ladder reads 36 €, falls straight out of the window, and the row
    // offered something else instead.
    expect(html).toContain("RE Store");
    expect(html).toContain(">7 €<");
    expect(html).not.toContain("от 36 €");
  });

  it("never offers the product whose page is open under the drawer", () => {
    // «+» carries a bare id, and addToCart() then reads the page's own volume
    // and QUANTITY — three 500 ml bottles off a row quoting 9 €
    const html = run({ screen: "product", productId: "open" });
    expect(html).not.toContain("OP Open");
    expect(html).toContain("RE Store");
  });

  it("offers nothing at all rather than offering the open product", () => {
    expect(run({ screen: "product", productId: "open", cart: ["ladder", "plain", "incart"] })).toBe("");
  });

  it("…and still offers it from any other screen", () => {
    expect(run({ screen: "catalog", productId: "open", cart: ["ladder", "plain", "incart"] }))
      .toContain("OP Open");
  });
});

/* ------------------------------------------------------------------------ *
 * 5. «Сначала дешевле» sorts on the number the card prints
 * ------------------------------------------------------------------------ */

describe("sortByShown: the grid's order and the grid's prices agree", () => {
  function run(list: Product[], dir: 1 | -1, pro: unknown = null): string[] {
    const body = `
      ${slice("sizePrice")}
      ${slice("proPrice")}
      ${slice("shownPrice")}
      ${slice("cardSizes")}
      ${slice("cardSizeIdx")}
      ${slice("sortByShown")}
      return sortByShown(CATALOGUE.slice(), DIR).map(function (p) { return p.id; });
    `;
    return new Function("CATALOGUE", "S", "byId", "cartSumRetail", "DIR", body)(
      list,
      { pro },
      (id: string) => list.find((p) => p.id === id) ?? list[0],
      () => 0,
      dir,
    ) as string[];
  }

  /** A ladder out of price order: the card prints 7 €, p.price says 36 €. */
  const LADDER: Product[] = [
    { id: "ladder", brand: "RE", name: "Store", cat: "hair", price: 36, prices: [36, 7], sizes: ["40", "200"] },
    { id: "mid", brand: "B", name: "Mid", cat: "hair", price: 12 },
    { id: "cheap", brand: "B", name: "Cheap", cat: "hair", price: 9 },
  ];

  it("puts the 7 € ladder first, because 7 € is what its card says", () => {
    expect(run(LADDER, 1)).toEqual(["ladder", "cheap", "mid"]);
  });

  it("and reverses cleanly for «Сначала дороже»", () => {
    expect(run(LADDER, -1)).toEqual(["mid", "cheap", "ladder"]);
  });

  it("follows a salon customer's own prices, which are the ones on screen", () => {
    // 50 % off everything, and one product priced by hand at 1 €
    const shelf: Product[] = [
      { id: "a", brand: "B", name: "A", cat: "hair", price: 20 },
      { id: "b", brand: "B", name: "B", cat: "hair", price: 12 },
      { id: "c", brand: "B", name: "C", cat: "hair", price: 9 },
    ];
    const pro = { tier: "pro", proDiscountPct: 50, proMinOrder: 0, proPrices: { a: 1 } };
    // retail order is c, b, a — the salon sees 1 €, 4,50 €, 6 €
    expect(run(shelf, 1, pro)).toEqual(["a", "c", "b"]);
  });
});

/* ------------------------------------------------------------------------ *
 * 6. Product JSON-LD: the origin in front of a path, never a URL
 * ------------------------------------------------------------------------ */

describe("ldImage: the photo address handed to Google", () => {
  function run(img: string): string {
    return new Function("location", "IMG", `${slice("ldImage")} return ldImage(IMG);`)(
      { origin: "https://rempireshop.com" },
      img,
    ) as string;
  }

  it("prefixes the origin onto a catalogue photo's path", () => {
    expect(run("/shop2/img/x.webp")).toBe("https://rempireshop.com/shop2/img/x.webp");
  });

  it("leaves an uploaded photo's own absolute URL exactly as it is", () => {
    expect(run("https://pub-abc.r2.dev/products/x.webp")).toBe("https://pub-abc.r2.dev/products/x.webp");
    expect(run("http://pub-abc.r2.dev/products/x.webp")).toBe("http://pub-abc.r2.dev/products/x.webp");
  });
});
