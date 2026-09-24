/**
 * The phone's Back over the panel's sub-screens.
 *
 * Dim, 24.09.2026, on /test «stock-edit»:
 *
 *   «Using phone / back button should also go back from "История приёмок и
 *   продаж" currently it goes back to dashboard.»
 *
 * Back inside the panel closes the topmost layer admLayers() reports, and the
 * section trail is the floor under all of them. The stock history under
 * «Склад» was never a layer, so the top of the stack was the trail itself and
 * one press walked from the history straight back to «Обзор». The letter
 * editor under «Рассылка» had the same hole. Both are layers now, each only on
 * its own tab, and the letter asks about unsaved work before it closes — the
 * question «← Рассылка» asks.
 *
 * The functions are sliced out of public/shop2/app.js by source text and run
 * over stubs, as tests/blog-panel-shop.test.ts does for the article editor.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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

function decl(name: string): string {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return `${src.slice(start, i + 1)};`;
  }
  throw new Error(`unbalanced braces around ${name} in app.js`);
}

type Panel = {
  S: Record<string, unknown>;
  /** A render(): the trail notices where the owner has moved to. */
  paint: () => void;
  /** The phone's Back, as the popstate handler spends it: close the top layer. */
  back: () => boolean;
  layers: () => string[];
  closedNews: () => number;
};

function panel(opts: { dirtyNews?: boolean } = {}): Panel {
  const S: Record<string, unknown> = {
    screen: "admin", adminTab: "over", adminEdit: "", adminOrder: 0, admCustOpen: "", mailOpen: false,
    admSetPage: "", adminBlogEdit: null, admMore: false, scanOpen: false, scanApp: false,
    stockMovesOpen: false, newsEdit: null, newsConfirmBack: false,
  };
  let closed = 0;
  const body = `
    var ADM_TRAIL = [], ADM_SEEN = "", pendingAction = null;
    ${decl("ADM_SECTION_OF")}
    function closeScannerState() {}
    function goodsBackToRow() {}
    function newsDirty() { return DIRTY; }
    function newsCloseEditor() { S.newsEdit = null; S.newsConfirmBack = false; onClose(); }
    window = { scrollTo: function () {} };
    ${slice("admSection")}
    ${slice("admTrailSync")}
    ${slice("admTrailBack")}
    ${slice("admLayers")}
    ${slice("admCloseTop")}
    return { paint: admTrailSync, back: admCloseTop, layers: admLayers };
  `;
  const made = new Function("S", "DIRTY", "onClose", "window", body)(S, !!opts.dirtyNews, () => { closed++; }, {}) as {
    paint: () => void; back: () => boolean; layers: () => string[];
  };
  made.paint();
  return { S, paint: made.paint, back: () => { const r = made.back(); made.paint(); return r; }, layers: made.layers, closedNews: () => closed };
}

describe("Back from «История приёмок и продаж» returns to «Склад»", () => {
  it("one Back closes the history and stays on «Склад»; the next leaves for «Обзор»", () => {
    const p = panel();
    p.S.adminTab = "stock"; p.paint();           // «Обзор» → «Склад»
    p.S.stockMovesOpen = true; p.paint();        // «История приёмок и продаж →»

    expect(p.back()).toBe(true);
    expect(p.S.stockMovesOpen, "Back left the history open").toBe(false);
    expect(p.S.adminTab, "Back skipped «Склад» and went to the section before").toBe("stock");

    // …and only now is the section itself what Back takes
    expect(p.back()).toBe(true);
    expect(p.S.adminTab).toBe("over");
  });

  it("is a layer only on «Склад» — a history left open behind another tab does not eat Back", () => {
    const p = panel();
    p.S.adminTab = "stock"; p.paint();
    p.S.stockMovesOpen = true; p.paint();
    p.S.adminTab = "orders"; p.paint();          // a nav tap elsewhere; the flag is still set

    expect(p.layers()).not.toContain("moves");
  });
});

describe("Back from a letter under «Рассылка» returns to the list", () => {
  it("closes a saved letter at once and stays on «Рассылка»", () => {
    const p = panel();
    p.S.adminTab = "news"; p.paint();
    p.S.newsEdit = { id: "n1", status: "draft" }; p.paint();

    expect(p.back()).toBe(true);
    expect(p.S.newsEdit, "Back walked past the letter").toBeNull();
    expect(p.S.adminTab).toBe("news");
    expect(p.closedNews()).toBe(1);
  });

  it("asks once before it throws an unsaved letter away, like «← Рассылка»", () => {
    const p = panel({ dirtyNews: true });
    p.S.adminTab = "news"; p.paint();
    p.S.newsEdit = { id: "n1", status: "draft" }; p.paint();

    expect(p.back()).toBe(true);
    expect(p.S.newsEdit, "the unsaved letter was closed without asking").not.toBeNull();
    expect(p.S.newsConfirmBack).toBe(true);

    expect(p.back()).toBe(true);
    expect(p.S.newsEdit).toBeNull();
    expect(p.S.adminTab).toBe("news");
  });
});

describe("every «← …» sub-screen of the panel is a Back layer", () => {
  /* The back links the panel draws, and the state each one closes. A new
     sub-screen with a back link and no layer is this bug again. */
  const layers = slice("admLayers");
  it.each([
    ["data-admorder=\"\"", "S.adminOrder"],
    ["data-admcustclose", "S.admCustOpen"],
    ["data-mailback", "S.mailOpen"],
    ["data-admsetback", "S.admSetPage"],
    ["data-admblogback", "S.adminBlogEdit"],
    ["data-admclose", "S.adminEdit"],
    ["data-newsback", "S.newsEdit"],
    ["data-stockmovesopen=\"\"", "S.stockMovesOpen"],
  ])("%s → %s", (link, state) => {
    expect(src, `the panel no longer draws ${link}`).toContain(link);
    expect(layers, `${state} is not a Back layer`).toContain(state);
  });
});
