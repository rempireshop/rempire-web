/**
 * The nav asks before it throws an unsaved product or article away.
 *
 * «← Товары», «← Блог» and the phone's Back have asked since 12.09.2026 —
 * «Правки не сохранены — если выйти, они пропадут.» with «Выйти без
 * сохранения» and «Остаться». The other way out did not: every
 * `data-admtab` button — the phone's bottom bar, the desktop sidebar, the
 * section tab strips, the «Ещё» sheet, the assistant's «Открыть …» — set
 * S.adminTab and closed the product editor and the article editor on the
 * spot (map of the panel, 23.09.2026, #2). One tap on «Заказы» with a new
 * price typed was a price gone.
 *
 * Now the nav asks the same question, and «Выйти без сохранения» goes on to
 * the section that was tapped. The handlers are sliced out of
 * public/shop2/app.js and run over stubs.
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
const branch = (head: string) => block(src.indexOf(head), head);

type Panel = {
  S: Record<string, any>;
  click: (d: Record<string, string>) => void;
  dirty: { goods: boolean; blog: boolean; blogSaves: boolean; autosaved: number };
  rows: string[];
};

function panel(): Panel {
  const S: Record<string, any> = {
    screen: "admin", adminTab: "over", adminEdit: "", adminOrder: 0, admCustOpen: "", mailOpen: false,
    admSetPage: "", adminBlogEdit: null, adminBlogConfirmBack: false, adminBlogConfirmDelete: false,
    admMore: false, goodsConfirmBack: false, goodsTab: "goods", goodsNew: null, goodsSizes: null,
    goodsErr: "", goodsEditTab: "main", goodsVidKind: "", admOrderFilter: "all",
  };
  /* `blogSaves`: the article on screen could be saved as it is (it has a
     Russian title) — since 1a it then saves itself and the nav just goes;
     only an article that cannot be saved yet is asked about. */
  const dirty = { goods: false, blog: false, blogSaves: false, autosaved: 0 };
  const rows: string[] = [];
  const click = new Function(
    "S", "DIRTY", "ROWS", "window", "PHONE",
    `var GAL = { id: "" }, AI_UNDO = null, BLOGSEL = null, BLOGCARET = null;
     function render() {}
     function refocus() {}
     // 1a: Back and the nav send what a field still owes first (admAutosaveFlush) — nothing is owed here
     function admAutosaveFlush() {}
     function vidReset() {}
     function goodsEditDirty() { return !!S.adminEdit && DIRTY.goods; }
     function blogReadForm() {}
     function blogDirty() { return !!S.adminBlogEdit && DIRTY.blog; }
     function blogSavesItself() { return DIRTY.blogSaves; }
     function blogAutosave() { DIRTY.autosaved++; }
     function blogStartNew() {}
     function openBlogEditor() {}
     function blogCloseEditor() {
       S.adminBlogEdit = null; S.adminBlogTool = ""; S.adminBlogConfirmBack = false;
       S.adminBlogConfirmPublish = ""; S.adminBlogPlaced = null; render();
     }
     function goodsBackToRow(id) { ROWS.push(id); }
     function admAsstSheet() { return PHONE; }
     ${maybe("admLeaveAsks")}
     ${maybe("admLeaveGo")}
     ${maybe("admGoTab")}
     return function (d) {
       ${branch("if (d.admtab) {")}
       ${branch("if (d.admbackno !== undefined)")}
       ${branch("if (d.admclose !== undefined || d.admbackyes !== undefined)")}
       ${branch("if (d.admblogbackyes !== undefined)")}
       ${branch("if (d.admblogbackno !== undefined)")}
     };`,
  )(S, dirty, rows, { scrollTo() {} }, true) as (d: Record<string, string>) => void;
  return { S, click, dirty, rows };
}

function editing(p: Panel) {
  p.S.adminTab = "goods"; p.S.adminEdit = "azur";
}
function writing(p: Panel) {
  p.S.adminTab = "blog"; p.S.adminBlogEdit = { slug: "post" };
}

describe("the nav over an unsaved product", () => {
  it("asks instead of closing", () => {
    const p = panel(); editing(p); p.dirty.goods = true;
    p.click({ admtab: "orders" });
    expect(p.S.adminEdit, "the nav threw the product away without asking").toBe("azur");
    expect(p.S.adminTab).toBe("goods");
    expect(p.S.goodsConfirmBack, "the question is not up").toBeTruthy();
  });

  it("«Выйти без сохранения» goes on to the section that was tapped", () => {
    const p = panel(); editing(p); p.dirty.goods = true;
    p.click({ admtab: "orders" });
    p.click({ admbackyes: "" });
    expect(p.S.adminEdit).toBe("");
    expect(p.S.adminTab, "the owner was left in «Товары»").toBe("orders");
    expect(p.S.goodsConfirmBack).toBe(false);
  });

  it("«Остаться» keeps the product and forgets the section", () => {
    const p = panel(); editing(p); p.dirty.goods = true;
    p.click({ admtab: "orders" });
    p.click({ admbackno: "" });
    expect(p.S.adminEdit).toBe("azur");
    expect(p.S.goodsConfirmBack).toBe(false);
    // the next question comes from «← Товары» and its «Выйти» lands on the list, not on «Заказы»
    p.click({ admclose: "" });
    p.click({ admbackyes: "" });
    expect(p.S.adminEdit).toBe("");
    expect(p.S.adminTab).toBe("goods");
    expect(p.rows).toEqual(["azur"]);
  });

  it("a second tap on the nav while the question is up goes — like a second «←» or Back", () => {
    const p = panel(); editing(p); p.dirty.goods = true;
    p.click({ admtab: "orders" });
    p.click({ admtab: "orders" });
    expect(p.S.adminEdit).toBe("");
    expect(p.S.adminTab).toBe("orders");
    expect(p.S.goodsConfirmBack).toBe(false);
  });

  it("the question is in sight: the «Ещё» sheet and the phone's assistant sheet step aside", () => {
    const p = panel(); editing(p); p.dirty.goods = true;
    p.S.admMore = true;                          // a row of «Ещё» was tapped…
    p.click({ admtab: "people" });
    expect(p.S.goodsConfirmBack).toBeTruthy();
    expect(p.S.admMore, "the question is under the «Ещё» sheet").toBe(false);

    const q = panel(); editing(q); q.dirty.goods = true;
    q.S.admAi = true;                            // …or «Открыть …» in the assistant on a phone
    q.click({ admtab: "orders" });
    expect(q.S.goodsConfirmBack).toBeTruthy();
    expect(q.S.admAi, "the question is under the assistant sheet").toBe(false);
  });

  it("a product with nothing unsaved closes at once, as before", () => {
    const p = panel(); editing(p);
    p.click({ admtab: "orders" });
    expect(p.S.adminEdit).toBe("");
    expect(p.S.adminTab).toBe("orders");
  });
});

describe("the nav over an unsaved article", () => {
  /* An article that cannot be saved yet (no Russian title) — the one kind
     the 1a autosave cannot carry away with it. */
  it("asks, and «Выйти без сохранения» goes to the section tapped", () => {
    const p = panel(); writing(p); p.dirty.blog = true;
    p.click({ admtab: "stats" });
    expect(p.S.adminBlogEdit, "the nav threw the article away without asking").not.toBeNull();
    expect(p.S.adminBlogConfirmBack).toBeTruthy();
    p.click({ admblogbackyes: "" });
    expect(p.S.adminBlogEdit).toBeNull();
    expect(p.S.adminTab).toBe("stats");
  });

  it("«Остаться» keeps the article", () => {
    const p = panel(); writing(p); p.dirty.blog = true;
    p.click({ admtab: "stats" });
    p.click({ admblogbackno: "" });
    expect(p.S.adminBlogEdit).not.toBeNull();
    expect(p.S.adminTab).toBe("blog");
  });

  it("a saved article closes at once", () => {
    const p = panel(); writing(p);
    p.click({ admtab: "stats" });
    expect(p.S.adminBlogEdit).toBeNull();
    expect(p.S.adminTab).toBe("stats");
  });

  it("1a: an unsaved article that CAN be saved saves itself and goes — no question", () => {
    const p = panel(); writing(p); p.dirty.blog = true; p.dirty.blogSaves = true;
    p.click({ admtab: "stats" });
    expect(p.S.adminBlogConfirmBack, "a question over an article that saves itself").toBeFalsy();
    expect(p.dirty.autosaved, "what it owed was not sent").toBeGreaterThan(0);
    expect(p.S.adminBlogEdit).toBeNull();
    expect(p.S.adminTab).toBe("stats");
  });
});

describe("the door itself is unchanged", () => {
  it("a queue row's filter and settings page still come along", () => {
    const p = panel();
    p.click({ admtab: "orders", admfilter: "toship" });
    expect(p.S.adminTab).toBe("orders");
    expect(p.S.admOrderFilter).toBe("toship");
    p.click({ admtab: "setup", admsetpage: "company" });
    expect(p.S.admSetPage).toBe("company");
  });
});
