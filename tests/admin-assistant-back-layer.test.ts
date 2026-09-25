/**
 * The assistant on a phone is a sheet over the panel — and Back, like
 * Escape, closes it first.
 *
 * On a phone (≤ 899 px) «Помощник» is a 75 % sheet with a scrim over the
 * section. It was not a layer in admLayers(), so the phone's Back walked the
 * section trail UNDER it: the owner pressed Back to put the sheet away and
 * landed on the previous section with the sheet still up. Escape passed it
 * by too. And the open state is remembered per device (admPanesSave), so a
 * sheet left up came back by itself, over «Обзор», on the next visit (map of
 * the panel, 23.09.2026, #8).
 *
 * Now, on a phone: the sheet is a Back layer above the section and the cards,
 * Escape closes it, and a reload opens the panel without it. On a desktop the
 * assistant is a docked column the owner keeps open while he works — it stays
 * out of Back, and Escape closes it only from inside it.
 *
 * The functions are sliced out of public/shop2/app.js and run over stubs, as
 * tests/admin-back-subscreens.test.ts does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
const fn = (name: string) => block(src.indexOf(`function ${name}(`), `function ${name}()`);
const maybe = (name: string) => (src.includes(`function ${name}(`) ? fn(name) : "");
function decl(name: string): string {
  return `${block(src.indexOf(`var ${name} = {`), `var ${name}`)};`;
}

type Panel = {
  S: Record<string, any>;
  paint: () => void;
  back: () => boolean;
  layers: () => string[];
  escape: (focusInside?: boolean) => void;
  saved: () => number;
};

function panel(phone: boolean): Panel {
  const S: Record<string, any> = {
    screen: "admin", adminTab: "over", adminEdit: "", adminOrder: 0, admCustOpen: "", mailOpen: false,
    admSetPage: "", adminBlogEdit: null, admMore: false, scanOpen: false, scanApp: false,
    stockMovesOpen: false, newsEdit: null, newsConfirmBack: false, admAi: false, pointOpen: false,
    cartOpen: false, filterOpen: false, langOpen: false,
  };
  let saves = 0;
  let inside = false;
  const doc = {
    get activeElement() { return inside ? { closest: (s: string) => (s === ".adm-asst" ? {} : null) } : { closest: () => null }; },
    querySelector: () => null,
  };
  // the page's own Escape listener — the one that closes the scanner, the sheets and the confirm card
  const head = 'document.addEventListener("keydown", ';
  const escAt = src.lastIndexOf(head, src.indexOf("the scanner's viewfinder covers the whole panel"));
  const keydown = block(escAt + head.length, "the Escape listener");
  const made = new Function(
    "S", "window", "document", "admPanesSave", "ADM_PHONE_MQ",
    `var ADM_TRAIL = [], ADM_SEEN = "", pendingAction = null;
     ${decl("ADM_SECTION_OF")}
     function closeScannerState() {}
     function closeScanner() {}
     function goodsBackToRow() {}
     function newsDirty() { return false; }
     function newsCloseEditor() { S.newsEdit = null; }
     function mailDirty() { return false; }
     function render() {}
     function refocus() {}
     // 1a: Back and the nav send what a field still owes first (admAutosaveFlush) — nothing is owed here
     function admAutosaveFlush() {}
     // …and the product card closing: its fields forget, «Новый товар» keeps its draft
     function edAsForget() {}
     function goodsNewSave() {}
     function admAiRefocus() {}
     function repaintPicker() {}
     function closeDrawers() {}
     function patchHeader() {}
     function topModal() { return null; }
     ${maybe("admAsstSheet")}
     ${fn("admSection")}
     ${fn("admTrailSync")}
     ${fn("admTrailBack")}
     ${fn("admLayers")}
     ${fn("admCloseTop")}
     return { paint: admTrailSync, back: admCloseTop, layers: admLayers, key: ${keydown} };`,
  )(S, { scrollTo() {} }, doc, () => { saves++; }, { matches: phone }) as {
    paint: () => void; back: () => boolean; layers: () => string[]; key: (e: { key: string }) => void;
  };
  made.paint();
  return {
    S,
    paint: made.paint,
    back: () => { const r = made.back(); made.paint(); return r; },
    layers: made.layers,
    escape: (focusInside = false) => { inside = focusInside; made.key({ key: "Escape" }); },
    saved: () => saves,
  };
}

describe("on a phone the assistant sheet is the top layer", () => {
  it("Back closes the sheet and leaves the section where it was", () => {
    const p = panel(true);
    p.S.adminTab = "orders"; p.paint();          // «Обзор» → «Заказы»
    p.S.admAi = true; p.paint();                 // «Помощник»

    expect(p.layers()).toContain("asst");
    expect(p.back()).toBe(true);
    expect(p.S.admAi, "Back left the sheet up").toBe(false);
    expect(p.S.adminTab, "Back walked the section under the sheet").toBe("orders");
    expect(p.saved(), "the closed state was not remembered").toBeGreaterThan(0);

    // …and only the next Back is the section's
    expect(p.back()).toBe(true);
    expect(p.S.adminTab).toBe("over");
  });

  it("sits above an open card: the sheet goes first, the card next", () => {
    const p = panel(true);
    p.S.adminTab = "orders"; p.paint();
    p.S.adminOrder = 100042; p.paint();
    p.S.admAi = true; p.paint();
    p.back();
    expect(p.S.admAi).toBe(false);
    expect(p.S.adminOrder, "the card went with the sheet").toBe(100042);
  });

  it("Escape closes it", () => {
    const p = panel(true);
    p.S.admAi = true;
    p.escape();
    expect(p.S.admAi).toBe(false);
  });
});

describe("on a desktop the docked assistant stays out of Back", () => {
  it("is not a layer, so Back still walks the sections", () => {
    const p = panel(false);
    p.S.adminTab = "orders"; p.paint();
    p.S.admAi = true; p.paint();
    expect(p.layers()).not.toContain("asst");
    p.back();
    expect(p.S.admAi).toBe(true);
    expect(p.S.adminTab).toBe("over");
  });

  it("Escape closes it only from inside it", () => {
    const p = panel(false);
    p.S.admAi = true;
    p.escape(false);
    expect(p.S.admAi, "Escape anywhere on the page closed the docked pane").toBe(true);
    p.escape(true);
    expect(p.S.admAi).toBe(false);
  });
});

describe("a phone does not reopen the sheet by itself", () => {
  function load(phone: boolean, stored: Record<string, unknown>): Record<string, any> {
    const S: Record<string, any> = { admNav: true, admAi: false, mailLang: "RU", voiceLang: "", mailTo: "" };
    new Function(
      "S", "localStorage", "window", "ADM_PANES_LS",
      `var admPanesMailTo = "";
       ${fn("admPanesLoad")}
       admPanesLoad();`,
    )(
      S,
      { getItem: () => JSON.stringify(stored) },
      { matchMedia: (q: string) => ({ matches: phone && /max-width:\s*899px/.test(q) }) },
      "rempire-admin-panes",
    );
    return S;
  }

  it("a sheet left open on the phone is closed on the next visit", () => {
    expect(load(true, { ai: true }).admAi).toBe(false);
  });

  it("…while a desktop keeps its docked pane open as it was left", () => {
    expect(load(false, { ai: true }).admAi).toBe(true);
    expect(load(false, { ai: false }).admAi).toBe(false);
  });
});
