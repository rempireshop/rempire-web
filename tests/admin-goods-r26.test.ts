/**
 * «Товары» — the questions the panel used to answer only after a tap, and the
 * work it used to throw away without one.
 *
 * Dim, 19.09.2026, with a screenshot of the «Склад» filter row circled in red
 * and the words «No counts»: «Overall flow UI/UX with the products needs to be
 * simpler and better + to a standard of an e-commerce shop.»
 *
 * A survey of the three tabs found the same defect in several shapes, and one
 * that was worse than any count:
 *
 *   · the product editor keeps NO draft in `S` — every field is read off the
 *     DOM when «Сохранить» is pressed — and «← Товары», «Отмена» and the
 *     phone's back gesture each cleared it silently. A price, three
 *     descriptions, six SEO boxes, the size ladder and any reordered photos,
 *     gone on one mis-tap at the top of a five-pane form;
 *   · three of the four buttons in the photo strip edited that draft without
 *     the save bar ever saying «Не сохранено»;
 *   · «Каталог» chips printed no numbers, «Склад»'s tab badge hid its zero,
 *     and the header counted the shop's catalogue on all three tabs;
 *   · «Нет в наличии» on «Каталог» and «Нет» on «Склад» counted two different
 *     things, so one bottle could be both.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so its own functions are
 * cut out of public/shop2/app.js by source text and run against stubs. Where a
 * defect lives in a CALLER rather than in a function — which is where most of
 * these lived — the source itself is read instead, because no stub can see a
 * caller.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
/* app.js is stored CRLF; a lifter that looks for a newline after a token
   matches far down the file against one (18.09.2026, b4e939c). */
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

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

type Product = { id: string; brand: string; name: string; stock?: string; custom?: boolean; active?: boolean; sizes?: string[] };
type Shelf = { productId: string; variant?: string; tracked: boolean; state: string; offSale?: boolean };

/** goodsMatchesFilter(), with the warehouse it reads and the hidden list. */
function matches(p: Product, f: string, levels: Shelf[] = [], hidden: string[] = []): boolean {
  const body = `
    var S = { stockLevels: LEVELS };
    function shopHidden(id) { return HIDDEN.indexOf(id) >= 0; }
    ${slice("goodsOffSale")}
    ${slice("goodsIsOut")}
    ${slice("goodsStockWord")}
    ${slice("goodsMatchesFilter")}
    return goodsMatchesFilter(P, F);
  `;
  // repository source plus fixed stub text — P/F/LEVELS/HIDDEN are arguments
  return (new Function("P", "F", "LEVELS", "HIDDEN", body) as (...a: unknown[]) => boolean)(p, f, levels, hidden);
}

const BOTTLE: Product = { id: "p1", brand: "Kevin.Murphy", name: "Un.Tangled", stock: "in" };

describe("«Каталог» and «Склад» count the same shelf", () => {
  it("calls a product out of stock when the counted shelf says so", () => {
    /* The bottle's manual «Наличие» still says «in» — the warehouse is the
       one that sells, so the warehouse wins. */
    expect(matches(BOTTLE, "out", [{ productId: "p1", tracked: true, state: "out" }])).toBe(true);
    expect(matches(BOTTLE, "out", [{ productId: "p1", tracked: true, state: "in" }])).toBe(false);
  });

  it("falls back to the manual flag for a product nobody counts", () => {
    expect(matches({ ...BOTTLE, stock: "out" }, "out", [])).toBe(true);
    expect(matches({ ...BOTTLE, stock: "out" }, "out", [{ productId: "p1", tracked: false, state: "in" }])).toBe(true);
    expect(matches(BOTTLE, "out", [])).toBe(false);
  });

  it("finds a custom product, which hard-codes stock: «in» and could never appear", () => {
    const own: Product = { id: "c-own", brand: "Rempire", name: "Soap", stock: "in", custom: true };
    expect(matches(own, "out", [{ productId: "c-own", tracked: true, state: "out" }])).toBe(true);
  });

  it("keeps a hidden product out of «Нет в наличии» — it is not for sale at all", () => {
    expect(matches(BOTTLE, "out", [{ productId: "p1", tracked: true, state: "out" }], ["p1"])).toBe(false);
    expect(matches(BOTTLE, "off", [], ["p1"])).toBe(true);
    expect(matches(BOTTLE, "on", [], ["p1"])).toBe(false);
  });
});

describe("what the source says about the callers", () => {
  /** The body of one function, as source. */
  function body(name: string): string {
    return slice(name);
  }

  it("every «Каталог» chip carries its number, zero included", () => {
    const html = body("admCatalogHTML");
    expect(html).toContain("goodsMatchesFilter(q, x[0])");
    /* `(n ? " " + n : "")` is the old form and hides a zero, which makes
       «Скрытые» before the list loads look like «Скрытые» with nothing in it. */
    expect(html).not.toContain('(n ? " " + n : "")');
    expect(html).toContain('x[1] + " " + n');
  });

  it("the «Склад» tab badge prints its zero once the shelf has arrived", () => {
    expect(body("admProductsHTML")).toContain("(S.stockLevels ? warn : \"\")");
  });

  it("the header counts the tab the owner is looking at", () => {
    expect(body("admProductsHTML")).toContain("admProductsCount(tab)");
    const count = body("admProductsCount");
    expect(count).toContain("S.stockLevels");
    expect(count).toContain("S.admBundles");
    expect(count).toContain("admCatalogList().length");
  });

  it("«Каталог» searches the way the owner types, like «Склад» does", () => {
    const rows = body("admCatalogRows");
    expect(rows).toContain("scanFold(S.goodsQ)");
    expect(rows).toContain("scanWordHas");
    // the raw substring that could not find «kevin murphy»
    expect(rows).not.toContain('.toLowerCase().indexOf(q) >= 0');
  });

  it("an empty result has a way out of itself", () => {
    expect(body("admCatalogRows")).toContain("data-goodsclear");
    expect(src).toContain("[data-goodsclear],");
    expect(src).toContain('if (d.goodsclear !== undefined)');
  });

  it("«Каталог» turns its own page, as «Склад» has since 13.09", () => {
    expect(src).toContain("goodsScrollMore();");
    expect(body("goodsScrollMore")).toContain("data-admgoodsmore");
  });
});

describe("the product editor stops throwing work away", () => {
  function dirty(open: string, touched: string | null): boolean {
    const bodySrc = `
      var S = { adminEdit: OPEN, goodsNew: null, barTouched: TOUCHED, bundleForm: null, promoForm: null, partnerForm: null };
      // the drafts a button changes are tests/admin-button-edits-dirty.test.ts — untouched here
      function edMediaDirty() { return false; }
      function admDraftDiffers() { return false; }
      ${slice("admBarIdent")}
      ${slice("admFormDirty")}
      ${slice("goodsEditDirty")}
      return goodsEditDirty();
    `;
    return (new Function("OPEN", "TOUCHED", bodySrc) as (...a: unknown[]) => boolean)(open, touched);
  }

  it("is dirty only while the open product is the one that was typed in", () => {
    expect(dirty("p1", "p1")).toBe(true);
    expect(dirty("p1", null)).toBe(false);
    // a flag left over from the form before it must not speak for this one
    expect(dirty("p1", "p2")).toBe(false);
    expect(dirty("", "p1")).toBe(false);
  });

  it("asks before every exit, not just the button", () => {
    /* Three ways out and all three used to clear S.adminEdit outright: the
       back link, «Отмена» (both `data-admclose`) and the phone's back
       gesture (admCloseTop's «edit» branch). */
    expect(src).toContain('if (d.admclose !== undefined || d.admbackyes !== undefined)');
    expect(src).toContain("goodsEditDirty() && !S.goodsConfirmBack");
    // the gesture branch asks the same question
    const back = slice("admCloseTop");
    expect(back).toContain("goodsEditDirty() && !S.goodsConfirmBack");
  });

  it("offers both answers, and the delegate can hear them", () => {
    const editor = slice("goodsEditor");
    expect(editor).toContain("data-admbackyes");
    expect(editor).toContain("data-admbackno");
    expect(src).toContain("[data-admbackyes],[data-admbackno],");
    expect(src).toContain("if (d.admbackno !== undefined)");
  });

  it("is quiet again once the editor is saved or reopened", () => {
    expect(src).toContain("S.goodsConfirmBack = false;   // saved");
    expect(src).toContain("S.goodsConfirmBack = false;   // a fresh card");
  });

  /* «Every button that edits the draft should say so here» — the rule above
     admBarTouched(), written when «×» on a size was fixed for Renat on
     12.09.2026. Only «★» in the photo strip obeyed it. */
  it("every photo button says the product is unsaved, not only «★»", () => {
    const handler = src.slice(src.indexOf("if (d.galmove !== undefined)"), src.indexOf("if (d.vpick !== undefined)"));
    for (const branch of ["galmove", "galmain", "galdel", "galreset"]) {
      const at = handler.indexOf(`d.${branch} !== undefined`);
      expect(at, branch).toBeGreaterThan(-1);
      const next = handler.slice(at, at + 900);
      const says = next.includes("admBarTouched()") || next.includes("toast(");
      expect(says, `${branch} edits the draft and says nothing`).toBe(true);
    }
  });
});
