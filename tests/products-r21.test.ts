/**
 * Round 21 — six things the shop said that were not true, five of them about
 * a set and one about a barcode.
 *
 *  1. A set the owner DELETED can still be in somebody's cart: loadBundles()
 *     carries it over from the static public/shop/bundles.js (which still
 *     ships the eight seeded sets whatever has happened to them since), so
 *     the line survives the prune and src/lib/orders.ts refuses the order
 *     with `bundle_unknown` — a code ORDER_ERRS had no sentence for, so the
 *     shopper met «попробуйте ещё раз» and went round the same loop for ever.
 *  2. A set the owner BUILT is in neither the static file nor a failed
 *     /api/bundles/ answer, and lineUnit() priced its cart line at 0 € — the
 *     total, the free-shipping bar and the checkout summary all short by the
 *     whole set, with the server about to bill the real price.
 *  3. expand() recomputes a set's `sum` from the live catalogue on every
 *     read, while `price` is what the owner stored — so a product whose price
 *     came down can leave the sum BELOW the price. save and pct clamp to 0
 *     and the card went on printing «−0 %» beside a crossed-out sum lower
 *     than the price next to it.
 *  4. «Фото по объёмам» reads back as [0, 0, …] for a product that has no map
 *     saved, which is the same thing — so every first save of a multi-size
 *     product with several photos wrote an override nobody asked for and
 *     toasted «Сохранено ✓» for it.
 *  5. The «Остаток» box takes a number and «Сохранить» sends the difference
 *     between it and the count the warehouse row holds. While that list is in
 *     flight there is no row, the difference was taken against 0, and the
 *     whole typed number went out as a move: a shelf of 7 recounted as 3
 *     became 10.
 *  6. The products search box promised «штрихкод» and admCatalogRows() never
 *     looked at one.
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so the functions are
 * sliced out of public/shop2/app.js by source text and run against stubs —
 * the same way tests/product-editor-values.test.ts does it. Retyping them
 * would test this file instead of the shop, and the slice fails loudly if
 * app.js drops or renames one of them.
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

/** …and the same for a `var <name> = { … };` table. */
function sliceVar(name: string): string {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1) + ";";
  }
  throw new Error(`unbalanced braces around var ${name} in app.js`);
}

/** The shop's own money format, near enough for an assertion on markup. */
const eur = (n: number) => String(Math.round(Number(n) * 100) / 100).replace(".", ",") + " €";
const esc = (s: unknown) => String(s ?? "");

/* ---------- 1. a set the server has no row for ---------------------------- */

describe("checkout — the order the server refuses with bundle_unknown", () => {
  const orderErrText = new Function(
    "code",
    `${sliceVar("ORDER_ERRS")}
     ${slice("orderErrText")}
     return orderErrText(code);`,
  ) as (code: string) => string;

  it("says which line is wrong instead of «попробуйте ещё раз»", () => {
    const generic = orderErrText("no_such_code_at_all");
    expect(orderErrText("bundle_unknown")).not.toBe(generic);
    // …and it tells the shopper the one thing they can do about it
    expect(orderErrText("bundle_unknown")).toMatch(/корзин/i);
  });

  it("is translated, like every other sentence the checkout can print", () => {
    // once as the Russian source in ORDER_ERRS, once as a key in each of the
    // two dictionaries — tools/i18n-gaps.mjs is the full check, this is the
    // one that fails in the same run as the sentence itself
    const key = '"Этого набора больше нет в продаже — уберите его из корзины"';
    expect(src.split(key).length - 1, "RU source + ET key + EN key").toBe(3);
  });
});

/* ---------- 2. a cart line the shop cannot resolve ------------------------ */

type Line = { type: string; id: string; qty: number; price?: number };

function lineUnit(line: Line, known: Record<string, { price: number }>): number {
  const run = new Function(
    "l",
    "bundleById",
    "giftAmount",
    "byId",
    "proPrice",
    "sizePrice",
    `${slice("lineUnit")}
     return lineUnit(l);`,
  ) as (...a: unknown[]) => number;
  return run(
    line,
    (id: string) => known[String(id).replace(/^bundle:/, "")] || null,
    () => 0,
    () => ({}),
    () => null,
    () => 0,
  );
}

describe("the cart line of a set the shop cannot resolve", () => {
  const line: Line = { type: "bundle", id: "bundle:renat-own", qty: 1, price: 34.9 };

  it("is priced at what it was added at, not at nothing", () => {
    // /api/bundles/ answered 503 (or the set was built in the panel and the
    // static file never had it): bundleById() finds nothing
    expect(lineUnit(line, {})).toBe(34.9);
  });

  it("still prefers the live price when the set IS resolvable", () => {
    expect(lineUnit(line, { "renat-own": { price: 29.9 } })).toBe(29.9);
  });

  it("is 0 only when the line itself carries no price", () => {
    expect(lineUnit({ type: "bundle", id: "bundle:x", qty: 1 }, {})).toBe(0);
  });
});

/* ---------- 3. a set whose discount has drifted to nothing ---------------- */

type Bundle = {
  id: string;
  price: number;
  sum: number;
  save: number;
  pct: number;
  title: Record<string, string>;
  desc?: Record<string, string>;
  items: Array<Record<string, unknown>>;
  images?: string[];
};

/** A set priced 34,90 € whose parts now add up to `sum`. */
const setWith = (sum: number): Bundle => ({
  id: "beard-start",
  price: 34.9,
  sum,
  save: Math.max(0, Math.round((sum - 34.9) * 100) / 100),
  pct: sum > 0 ? Math.round((Math.max(0, sum - 34.9) / sum) * 100) : 0,
  title: { RU: "Борода — стартовый набор" },
  desc: { RU: "Масло, бальзам и мыло." },
  items: [{ id: "oil", price: 12, sizeLabel: "30 мл", img: "/a.webp" }],
  images: ["/a.webp"],
});

function cardHTML(b: Bundle): string {
  const run = new Function(
    "b",
    "bundleStock",
    "bundleStack",
    "bundleTitle",
    "esc",
    "eur",
    `${slice("bundleSaved")}
     ${slice("bundleCardHTML")}
     return bundleCardHTML(b);`,
  ) as (...a: unknown[]) => string;
  return run(b, () => "in", () => "<span class='bstack'></span>", (x: Bundle) => x.title.RU, esc, eur);
}

function setPageHTML(b: Bundle): string {
  const run = new Function(
    "S",
    "b0",
    "esc",
    "eur",
    `var setsOn = function () { return true; };
     var setsOffHTML = function () { return ""; };
     var shownBundleById = function () { return b0; };
     var bundleStock = function () { return "in"; };
     var bundleStack = function () { return "<span class='bstack'></span>"; };
     var bundleTitle = function (x) { return x.title.RU; };
     var bundleDesc = function (x) { return (x.desc && x.desc.RU) || ""; };
     var bundleItemProduct = function () { return null; };
     var bundleItemStock = function () { return "in"; };
     var bundleItemName = function (it) { return it.id; };
     var pdpShipLine = function () { return "Доставка"; };
     ${slice("bundleSaved")}
     ${slice("screenBundle")}
     return screenBundle();`,
  ) as (...a: unknown[]) => string;
  return run({ bundleId: b.id, lang: "RU" }, b, esc, eur);
}

describe("a set that is no longer cheaper than the things in it", () => {
  it("still shows the discount when there really is one", () => {
    const card = cardHTML(setWith(40));
    expect(card).toContain("bbadge");
    expect(card).toContain("bwas");
    const page = setPageHTML(setWith(40));
    expect(page).toContain("bwas");
    expect(page).toContain("выгода");
  });

  it("drops the «−0 %» badge and the crossed-out sum when the parts got cheaper", () => {
    // one bottle's price came down: the parts now add up to LESS than the set
    const card = cardHTML(setWith(31));
    expect(card, "«−0 %» over a «было» lower than the price").not.toContain("bbadge");
    expect(card, "a crossed-out sum lower than the price beside it").not.toContain("bwas");
    // …and the price itself is still on the card
    expect(card).toContain(eur(34.9));
  });

  it("drops them on the set's own page too, chip and all", () => {
    const page = setPageHTML(setWith(31));
    expect(page).not.toContain("bwas");
    expect(page, "«выгода 0,00 €»").not.toContain("выгода");
    expect(page).toContain(eur(34.9));
  });

  it("treats a set that costs exactly its parts as no discount", () => {
    expect(cardHTML(setWith(34.9))).not.toContain("bbadge");
    // …and a single cent of real saving is still a saving
    expect(cardHTML(setWith(34.91))).toContain("bbadge");
  });
});

/* ---------- 4. «Фото по объёмам» that nobody touched ---------------------- */

describe("the per-size photo map", () => {
  const varImgChanged = new Function(
    "map",
    "saved",
    `${slice("varImgChanged")}
     return varImgChanged(map, saved);`,
  ) as (map: number[], saved: number[] | undefined | null) => boolean;

  it("is not a change when every size is still on the main photo", () => {
    // what the rows render and read back for a product with no map stored
    expect(varImgChanged([0, 0], undefined)).toBe(false);
    expect(varImgChanged([0, 0, 0], null)).toBe(false);
    expect(varImgChanged([0, 0], [])).toBe(false);
  });

  it("is a change as soon as one size points somewhere else", () => {
    expect(varImgChanged([0, 1], undefined)).toBe(true);
    expect(varImgChanged([0, 0], [0, 1])).toBe(true);
  });

  it("is never a change when a row has nothing ticked", () => {
    expect(varImgChanged([0, -1], undefined)).toBe(false);
    expect(varImgChanged([], undefined)).toBe(false);
  });
});

/* ---------- 5. «Остаток» before the warehouse list lands ------------------ */

function qtyCell(stockLevels: unknown, lv: unknown): string {
  const run = new Function(
    "S",
    "esc",
    "key",
    "lv",
    "low",
    `${slice("edCell")}
     ${slice("edQtyCell")}
     return edQtyCell(key, lv, low);`,
  ) as (...a: unknown[]) => string;
  return run({ stockLevels }, esc, "azur 100 мл", lv, false);
}

describe("the «Остаток» box of the sizes grid", () => {
  it("takes no typing until the warehouse list has landed", () => {
    // what «Сохранить» would send is `typed − the row's count`, and with no
    // list there is no count: the whole typed number would go out as a move
    const cell = qtyCell(null, null);
    expect(cell, "a box that cannot be counted from is open for typing").toContain("disabled");
    expect(cell, "«не учтено» means «never counted», not «still loading»").not.toContain("не учтено");
  });

  it("opens as soon as the list is there, and says so for a fresh volume", () => {
    const cell = qtyCell([], null);
    expect(cell).not.toContain("disabled");
    expect(cell).toContain("не учтено");
  });

  it("shows the count of a volume the warehouse knows", () => {
    const cell = qtyCell([{}], { tracked: true, qty: 7 });
    expect(cell).not.toContain("disabled");
    expect(cell).toContain('value="7"');
  });

  it("is what both size grids actually render", () => {
    for (const pane of ["edPaneSizesOwn", "edPaneSizes"]) {
      expect(slice(pane), pane).toContain("edQtyCell(");
    }
  });
});

/* ---------- 6. what the products search box promises ---------------------- */

describe("«Товары» — the search box over the catalogue list", () => {
  it("promises only the fields admCatalogRows() reads", () => {
    const filter = slice("admCatalogRows");
    // the haystack, verbatim: brand + name + id, and nothing from the warehouse
    expect(filter).toContain('p.brand + " " + p.name + " " + p.id');
    expect(filter, "barcodes live on S.stockLevels, which this screen never loads")
      .not.toContain("ean");

    const box = src.slice(src.indexOf("data-goodsq"), src.indexOf("data-goodsq") + 400);
    const placeholder = /placeholder="([^"]*)"/.exec(box)?.[1] ?? "";
    expect(placeholder, "the box said «штрихкод» and the filter never looked at one")
      .not.toMatch(/штрихкод/i);
    expect(placeholder).toBe("Название или бренд");
  });
});

/* ---------- 7. «Фото по объёмам» before it is saved ----------------------- */

type Photo = { url: string; thumb: string; alt: string };

function sizePick(
  picks: Record<number, string>,
  list: Photo[],
  saved: Photo[],
  varImg: number[] | null,
  si: number,
): number {
  const run = new Function(
    "GAL",
    "galPhotos",
    "p",
    "si",
    `${slice("galSizePick")}
     return galSizePick(p, si);`,
  ) as (...a: unknown[]) => number;
  return run({ id: "x", list, picks }, () => saved, { id: "x", varImg }, si);
}

describe("the photo chosen for one volume, before «Сохранить»", () => {
  const a = { url: "/a.webp", thumb: "/a.webp", alt: "" };
  const b = { url: "/b.webp", thumb: "/b.webp", alt: "" };
  const saved = [a, b];

  it("is the main photo when nothing is chosen and nothing is stored", () => {
    expect(sizePick({}, [a, b], saved, null, 0)).toBe(0);
  });

  it("survives the render() that every photo button ends in", () => {
    // the owner ticked the second photo for the second volume — it used to
    // live only in an aria-current attribute the next render() rewrote
    expect(sizePick({ 1: "/b.webp" }, [a, b], saved, null, 1)).toBe(1);
  });

  it("follows its photo when the list is reordered under it", () => {
    // ★ made /b.webp the main one: the choice is still that photo, now first
    expect(sizePick({ 1: "/b.webp" }, [b, a], saved, null, 1)).toBe(0);
  });

  it("falls back to the stored map when the chosen photo was deleted", () => {
    expect(sizePick({ 1: "/gone.webp" }, [a, b], saved, [0, 1], 1)).toBe(1);
    expect(sizePick({ 1: "/gone.webp" }, [a, b], saved, null, 1)).toBe(0);
  });

  it("leaves the stored map alone for a volume nobody touched", () => {
    expect(sizePick({ 0: "/b.webp" }, [a, b], saved, [0, 1], 1)).toBe(1);
  });

  it("is what the thumbnail actually writes down when it is tapped", () => {
    // the handler still patches the DOM rather than rendering — a render()
    // there would rebuild the editor from what is SAVED and take the price,
    // the SEO boxes and the descriptions being typed with it — so the draft
    // is the only thing that survives to «Сохранить»
    const at = src.indexOf("if (d.vpick !== undefined) {");
    expect(at, "app.js no longer has the [data-vpick] handler").toBeGreaterThan(0);
    const handler = src.slice(at, src.indexOf("\n    }", at));
    expect(handler, "the tick is written to the DOM and nowhere else").toContain("GAL.picks[");
  });
});

/* ---------- 8. how many of each thing a set holds ------------------------- */

describe("a set that holds two of something", () => {
  const twice = (qty: number): Bundle => ({
    ...setWith(40),
    items: [{ id: "oil", price: 12, qty, sizeLabel: "30 мл", img: "/a.webp" }],
  });

  it("says so on the set's page, so the crossed-out sum adds up", () => {
    expect(setPageHTML(twice(2)), "the «было» sum counts it twice and the list did not")
      .toContain("× 2");
    expect(setPageHTML(twice(1))).not.toContain("×");
  });

  it("says so on the cart line's list of parts too", () => {
    const run = new Function(
      "l",
      "bundleById",
      "bundleItemName",
      "esc",
      `var giftAmount = function () { return 0; };
       var eur = function (n) { return String(n); };
       var byId = function () { return {}; };
       var S = { lang: "RU" };
       var LINE_KIND = { bundle: { RU: "Набор" }, gift: { RU: "Карта" } };
       ${slice("lineNoteHTML")}
       return lineNoteHTML(l);`,
    ) as (...a: unknown[]) => string;
    const note = (qty: number) =>
      run({ type: "bundle", id: "bundle:x" }, () => twice(qty), () => "Proraso Oil", esc);
    expect(note(2)).toContain("× 2");
    expect(note(1)).not.toContain("×");
  });
});

/* ---------- 9. what the set editor's picker may offer --------------------- */

describe("«Наборы» — the product picker inside the set editor", () => {
  const file = { id: "azur", brand: "Proraso", name: "Azur Lime" };
  const own = { id: "c-renat-1", brand: "Rempire", name: "Своё мыло", custom: true };

  function pickRows(found: Array<Record<string, unknown>>): string {
    const run = new Function(
      "S",
      "heroFind",
      "admPickTile",
      `var HERO_NOHIT = "<p>none</p>";
       ${slice("bundlePickRows")}
       return bundlePickRows();`,
    ) as (...a: unknown[]) => string;
    return run({ bundleQ: "" }, () => found, (_attr: string, id: string) => `<b>${id}</b>`);
  }

  it("offers only what src/lib/bundles.ts can resolve", () => {
    const rows = pickRows([file, own]);
    expect(rows).toContain("azur");
    expect(rows, "a product the owner made is refused on save as unknown_product")
      .not.toContain("c-renat-1");
  });

  it("says «ничего не нашлось» rather than an empty grid", () => {
    expect(pickRows([own])).toBe("<p>none</p>");
  });

  it("explains why his own products are missing — but only once he has one", () => {
    const hint = (catalogue: Array<Record<string, unknown>>) =>
      (new Function("CATALOGUE", `${slice("bundleOwnHint")} return bundleOwnHint();`) as (
        c: unknown,
      ) => string)(catalogue);
    expect(hint([file])).toBe("");
    expect(hint([file, own])).toContain("Свои товары");
  });
});
