/**
 * «Назад» walks the panel's sections — in Chrome, whose Back button skips.
 *
 * Dim, 25.09.2026, on /test «panel-back»:
 *
 *   «Обзор → Заказы → Клиенты — IS OK. «Клиенты» → «Заказы» throws out.»
 *
 * The panel kept ONE parked history entry and, after every press of Back
 * that left something open, parked it again from inside the popstate
 * handler. Chrome's history-manipulation intervention stops honouring the
 * owner's earlier taps for new entries after any same-document back/forward
 * (chromium/src docs/history_manipulation_intervention.md): an entry made
 * then marks every entry of the page «skip on the Back button», and the next
 * press jumps over the whole panel — out to the shop in a tab, out of the app
 * on the home-screen panel. The second press of any walk was that press.
 * Playwright's goBack() moves by index and skips nothing, which is why
 * e2e/admin-back.spec.ts stayed green.
 *
 * Now every press of Back that is due has its own entry, parked by the tap
 * that opened it (admSteps / admSyncHistory in public/shop2/app.js), Back only
 * spends them, and nothing is parked after a Back until the next tap
 * (ADM_HOLD). The functions are sliced out of app.js by source text, as the
 * other admin-back tests do, and run over a history that behaves like
 * Chrome's: taps are user activations, a same-document traversal stops
 * honouring them, an entry pushed unhonoured marks the page skippable, a tap
 * clears the marks, and the Back BUTTON skips marked entries while
 * history.back()/go() from script do not.
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
function decl(name: string): string {
  return `${block(src.indexOf(`var ${name} = {`), `var ${name}`)};`;
}
const maybeDecl = (name: string) => (src.includes(`var ${name} = {`) ? decl(name) : "");
const popHead = 'window.addEventListener("popstate", ';
const popstate = block(src.indexOf(popHead) + popHead.length, "the popstate listener");
/* firstPaint()'s own lines about the history: from the stamp of the entry the
   page opened on (and, since 25.09.2026, what it does about parked entries
   under it) to its first render() */
const bootFrom = src.includes("var bootParked = 0;")
  ? src.indexOf("var bootParked = 0;")
  : src.lastIndexOf("try {", src.indexOf('if ("scrollRestoration" in history)'));
const boot = src.slice(bootFrom, src.indexOf("render();", bootFrom) + "render();".length);

const page = new Function(
  "S", "history", "location", "window", "PHONE", "DIRTY", "setTimeout",
  `var ADM_TRAIL = [], ADM_SEEN = "", ADM_POP = false, ADM_HOLD = false, pendingAction = null;
   var GAL = { id: "" }, AI_UNDO = null, BLOGSEL = null, BLOGCARET = null, ADM_PHONE_MQ = { matches: PHONE };
   ${decl("ADM_SECTION_OF")}
   ${maybeDecl("ADM_ASKS")}
   function render() { admSyncHistory(); }
   function refocus() {}
   function vidReset() {}
   function goodsEditDirty() { return !!S.adminEdit && DIRTY.goods; }
   function blogReadForm() {}
   function blogDirty() { return false; }
   function mailDirty() { return false; }
   function newsDirty() { return false; }
   function newsCloseEditor() { S.newsEdit = null; }
   function mailCloseEditor() { S.mailOpen = false; }
   function mailRevertOne() {}
   function mailTpl() { return null; }
   function goodsBackToRow() {}
   function closeScannerState() { S.scanOpen = false; }
   function admPanesSave() {}
   function admShipClear() {}
   function ensureMedia() {}
   function acctFlush() {}
   function acctRefresh() {}
   function trackNav() {}
   function track() {}
   function pathFor() { return S.screen === "admin" ? "/shop2/admin/" : "/shop2/"; }
   function routeFromPath() { S.screen = location.pathname === "/shop2/admin/" ? "admin" : "home"; }
   ${fn("admSection")}
   ${fn("admTrailSync")}
   ${fn("admTrailBack")}
   ${maybe("admParked")}
   ${maybe("admDepth")}
   ${maybe("admAsstSheet")}
   ${fn("admLayers")}
   ${maybe("admSteps")}
   ${fn("admCloseTop")}
   ${fn("admLeaveAsks")}
   ${maybe("admLeaveGo")}
   ${fn("admGoTab")}
   ${fn("here")}
   ${fn("stamp")}
   ${fn("navTo")}
   ${fn("go")}
   ${fn("admSyncHistory")}
   ${maybe("admUnhold")}
   var onPop = ${popstate};
   // firstPaint(): the route, then its history lines as app.js has them
   routeFromPath();
   ${boot}
   return {
     pop: onPop,
     layers: admLayers,
     trail: function () { return ADM_TRAIL.slice(); },
     /** The browser's own word that the owner's hand did something. */
     unhold: function (e) { if (typeof admUnhold === "function") admUnhold(e); },
     click: function (d, t) {
       t = t || { closest: function () { return null; } };
       if (d.go) { go(d.go); return; }
       // something the page redraws for by itself (an answer landing)
       if (d.render !== undefined) { render(); return; }
       // a confirm card over whatever is open («Отправлен», «Снять с продажи»…)
       if (d.confirm !== undefined) { pendingAction = { overlay: true }; render(); return; }
       if (d.scanopen !== undefined) { S.scanOpen = true; render(); return; }
       // «Помощник»: the phone's floating button, or its row in «Ещё»
       if (d.admai !== undefined) { S.admAi = !S.admAi; if (d.fromMore) S.admMore = false; render(); return; }
       ${branch("if (d.admmore !== undefined)")}
       ${branch("if (d.admmoreclose !== undefined)")}
       ${branch("if (d.admtab) {")}
       ${branch("if (d.admcancel !== undefined)")}
       ${branch("if (d.admorder !== undefined) {")}
       ${branch("if (d.admgoods !== undefined) {")}
       ${branch("if (d.admbackno !== undefined)")}
       ${branch("if (d.admclose !== undefined || d.admbackyes !== undefined) {")}
       ${branch("if (d.admcustopen) {")}
       ${branch("if (d.admcustclose !== undefined)")}
     }
   };`,
) as (...a: unknown[]) => {
  pop: (e: { state: unknown }) => void;
  layers: () => string[];
  trail: () => string[];
  unhold: (e: { type: string; key?: string; pointerType?: string }) => void;
  click: (d: Record<string, string>) => void;
};

type Entry = { state: any; url: string; doc: number; skip: boolean };

function freshS(): Record<string, any> {
  return {
    screen: "admin", adminTab: "over", adminEdit: "", adminOrder: 0, admCustOpen: "", mailOpen: false,
    admSetPage: "", adminBlogEdit: null, adminBlogConfirmBack: false, adminBlogConfirmDelete: false,
    admMore: false, goodsConfirmBack: false, goodsTab: "goods", goodsNew: null, goodsSizes: null,
    goodsErr: "", goodsEditTab: "main", goodsVidKind: "", admOrderFilter: "all", scanOpen: false, scanApp: false,
    stockMovesOpen: false, newsEdit: null, admAi: false, shown: 12, cartOpen: false, filterOpen: false,
    histDrawer: false, pointFor: "",
  };
}

/**
 * A phone, keeping its history the way Chrome does. `standalone`: the panel
 * on the home screen, whose window opens on ONE entry — Back with nothing
 * behind it closes the app. Otherwise a browser tab that came into the panel
 * from the shop.
 */
function phone(opts: { standalone: boolean }) {
  let doc = 1;
  let docs = 1;
  const entries: Entry[] = [];
  let index = -1;
  let activated = false;   // the current document has had the owner's hand on it
  let honor = true;        // …and Chrome still honours that for new entries
  let left = false;
  const queue: number[] = [];
  const timers: Array<() => void> = [];
  const dirty = { goods: false };
  if (!opts.standalone) { entries.push({ state: { y: 0, shown: 12 }, url: "/shop2/", doc, skip: false }); index = 0; }
  entries.push({ state: null, url: "/shop2/admin/", doc, skip: false }); index++;

  const markDoc = (skip: boolean) => { for (const e of entries) if (e.doc === doc) e.skip = skip; };
  const history = {
    get state() { return entries[index].state; },
    pushState(state: unknown, _t: string, url?: string) {
      entries.length = index + 1;
      entries.push({ state: JSON.parse(JSON.stringify(state)), url: url || entries[index].url, doc, skip: false });
      index++;
      // an entry the browser does not believe the owner asked for
      if (!(activated && honor)) markDoc(true);
    },
    replaceState(state: unknown, _t: string, url?: string) {
      const e = entries[index];
      entries[index] = { state: JSON.parse(JSON.stringify(state)), url: url || e.url, doc: e.doc, skip: e.skip };
    },
    back() { queue.push(-1); },
    go(n: number) { queue.push(n); },
  };
  const location = { get pathname() { return entries[index].url; }, search: "" };
  const win = { scrollY: 0, scrollTo() {}, addEventListener() {} };
  let S = freshS();
  let app!: ReturnType<typeof page>;

  function load() {
    S = freshS();
    activated = false; honor = true;
    app = page(S, history, location, win, true, dirty, (f: () => void) => { timers.push(f); });
  }
  function traverse(target: number) {
    if (entries[target].doc === doc) {
      index = target;
      honor = false;   // a same-document back/forward
      app.pop({ state: entries[index].state });
      return;
    }
    // an entry of a page that is gone: loading it is a new page
    index = target;
    doc = entries[index].doc = ++docs;
    load();
  }
  function settle() {
    for (let guard = 0; queue.length || timers.length; guard++) {
      if (guard > 100) throw new Error("the history never settles");
      if (timers.length) { timers.shift()!(); continue; }
      const target = index + queue.shift()!;
      if (target < 0 || target >= entries.length) continue;   // go() past the end does nothing
      traverse(target);
    }
  }
  load();
  settle();

  return {
    get S() { return S; },
    layers: () => app.layers(),
    trail: () => app.trail(),
    /** A tap on a control carrying these data-attributes. */
    tap(d: Record<string, string>) {
      activated = true; honor = true; markDoc(false);
      app.unhold({ type: "pointerup", pointerType: "touch" });
      app.unhold({ type: "click" });
      app.click(d);
      settle();
    },
    /** Typing into the open product editor: keys are the owner's hand too. */
    type() {
      activated = true; honor = true; markDoc(false);
      app.unhold({ type: "keydown", key: "5" });
      dirty.goods = true;
      settle();
    },
    /** Something the page does by itself — an answer landing, a notification's link. */
    later(change: (s: Record<string, any>) => void) {
      change(S);
      app.click({ render: "" });
      settle();
    },
    /** The phone's Back BUTTON (or gesture): it skips what Chrome marked. */
    back() {
      let target = -1;
      for (let i = index - 1; i >= 0; i--) if (!entries[i].skip) { target = i; break; }
      if (target < 0) { left = true; return; }
      traverse(target);
      settle();
    },
    /** A reload, or the phone waking a panel it had put to sleep. */
    reload() {
      doc = entries[index].doc = ++docs;
      load();
      settle();
    },
    /** The app is open and what is on screen is the panel. */
    inPanel() { return !left && S.screen === "admin" && entries[index].url === "/shop2/admin/"; },
    where() { return left ? "left" : S.screen === "admin" ? S.adminTab : S.screen; },
  };
}
type Phone = ReturnType<typeof phone>;

/** Presses Back and says where it landed: the section, and what is still open over it. */
function back(p: Phone): string {
  p.back();
  if (!p.inPanel()) return "out";
  const over = p.layers().filter((l) => l !== "section");
  return p.S.adminTab + (over.length ? "+" + over.join("+") : "");
}
function walk(p: Phone, presses: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < presses; i++) seen.push(back(p));
  return seen;
}

describe("Dim's report: Back through the sections on a phone", () => {
  it.each([true, false])("«Ещё» → «Клиенты» → «Заказы»: Back hands back «Клиенты», then «Обзор», then leaves (home screen: %s)", (standalone) => {
    const p = phone({ standalone });
    p.tap({ admmore: "" });
    p.tap({ admtab: "people" });          // the row in the «Ещё» sheet
    p.tap({ admtab: "orders" });          // the bottom bar
    expect(walk(p, 3), "Back threw the owner out of the panel on the way").toEqual(["people", "over", "out"]);
  });

  it.each([true, false])("«Обзор» → «Заказы» → «Клиенты»: two presses to «Обзор», the third leaves (home screen: %s)", (standalone) => {
    const p = phone({ standalone });
    p.tap({ admtab: "orders" });
    p.tap({ admmore: "" });
    p.tap({ admtab: "people" });
    expect(walk(p, 3)).toEqual(["orders", "over", "out"]);
  });

  it("a long walk comes back the whole way, one section per press", () => {
    const p = phone({ standalone: true });
    for (const s of ["orders", "goods", "pos"]) p.tap({ admtab: s });
    p.tap({ admmore: "" });
    p.tap({ admtab: "setup" });
    expect(walk(p, 5)).toEqual(["pos", "goods", "orders", "over", "out"]);
  });

  it("from a browser tab the last press lands on the shop the panel was opened from", () => {
    const p = phone({ standalone: false });
    p.tap({ admtab: "orders" });
    p.tap({ admmore: "" });
    p.tap({ admtab: "people" });
    walk(p, 2);
    p.back();
    expect(p.where(), "Back from «Обзор» did not return to the shop").toBe("home");
  });
});

describe("every other door into a section", () => {
  it("a «Сделать сегодня» row on «Обзор» (a section with its filter)", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "orders", admfilter: "new" });
    p.tap({ admmore: "" });
    p.tap({ admtab: "people", admfilter: "pending" });
    expect(walk(p, 3)).toEqual(["orders", "over", "out"]);
  });

  it("the assistant's «Открыть …» on a phone: its sheet first, then the sections", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "orders" });
    p.tap({ admai: "" });                 // «Помощник», a sheet over «Заказы»
    p.tap({ admtab: "people" });          // «Открыть клиентов» inside it
    expect(p.S.admAi, "the sheet stays up over the section it opened").toBe(true);
    expect(walk(p, 4)).toEqual(["people", "orders", "over", "out"]);
  });

  it("revisiting a section cuts the trail there — and its entries go with it", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "orders" });
    p.tap({ admmore: "" });
    p.tap({ admtab: "people" });
    p.tap({ admtab: "orders" });          // back to «Заказы» through the bar
    expect(walk(p, 2), "a spare entry was left behind: a press did nothing").toEqual(["over", "out"]);
    const q = phone({ standalone: true });
    q.tap({ admtab: "orders" });
    q.tap({ admtab: "goods" });
    q.tap({ admtab: "over" });            // «Обзор» itself: the trail is gone
    expect(walk(q, 1)).toEqual(["out"]);
  });

  it("a notification's ?order= link: the card opens by itself, and after the first tap Back walks it back", () => {
    const p = phone({ standalone: true });
    // pushOpenWanted(): the orders came and the number was found — no tap yet
    p.later((S) => { S.adminTab = "orders"; S.adminOrder = "o-1"; });
    p.tap({ admmore: "" });               // any tap: the «Ещё» sheet, say…
    expect(back(p)).toBe("orders+order"); // …which Back puts away
    expect(walk(p, 3)).toEqual(["orders", "over", "out"]);
  });

  it("a reload on a parked entry leaves no presses that change nothing", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "orders" });
    p.tap({ admtab: "goods" });
    p.tap({ admgoods: "azur" });
    p.reload();                           // the phone put the panel to sleep and woke it
    expect(p.S.adminTab).toBe("over");
    expect(walk(p, 1), "the entries of the page before the reload ate a press").toEqual(["out"]);
  });
});

describe("cards and questions on the way", () => {
  it("the checklist: an order card, «Отправлен»'s question, two presses — then the sections", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "orders" });
    p.tap({ admorder: "o-1" });
    p.tap({ confirm: "" });
    expect(walk(p, 4)).toEqual(["orders+order", "orders", "over", "out"]);
  });

  it("an order opened from a customer's card closes back to that customer", () => {
    const p = phone({ standalone: true });
    p.tap({ admmore: "" });
    p.tap({ admtab: "people" });
    p.tap({ admcustopen: "c-1" });
    p.tap({ admorder: "o-1" });           // drawn over the customer's card
    expect(walk(p, 4)).toEqual(["people+customer", "people", "over", "out"]);
  });

  it("an unsaved product: Back asks, Back closes, and the sections are all still there", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "orders" });
    p.tap({ admtab: "goods" });
    p.tap({ admgoods: "azur" });
    p.type();
    expect(back(p)).toBe("goods+edit");
    expect(p.S.goodsConfirmBack, "Back threw the typed price away without asking").toBe(true);
    expect(walk(p, 4)).toEqual(["goods", "orders", "over", "out"]);
  });

  it("…and «Остаться» after the question keeps every press", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "goods" });
    p.tap({ admgoods: "azur" });
    p.type();
    back(p);
    p.tap({ admbackno: "" });             // «Остаться»
    expect(back(p)).toBe("goods+edit");   // it asks again
    expect(walk(p, 3)).toEqual(["goods", "over", "out"]);
  });

  it("closed with its own button: the next press really moves", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "goods" });
    p.tap({ admgoods: "azur" });
    p.tap({ admclose: "" });              // «← Товары»
    expect(walk(p, 2)).toEqual(["over", "out"]);
  });

  it("the scanner over the product editor, then the editor, then the section", () => {
    const p = phone({ standalone: true });
    p.tap({ admtab: "goods" });
    p.tap({ admgoods: "azur" });
    p.tap({ scanopen: "" });
    expect(walk(p, 4)).toEqual(["goods+edit", "goods", "over", "out"]);
  });
});

describe("whatever the owner does, Back never leaves early and never does nothing", () => {
  it("random taps and presses on a phone that behaves like Chrome", () => {
    let seed = 25092026;
    const rnd = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
    };
    const BAR = ["over", "orders", "goods", "pos"];
    const MORE = ["people", "promos", "blog", "stats", "apps", "setup"];
    const fails: string[] = [];
    let presses = 0;
    for (let run = 0; run < 400 && !fails.length; run++) {
      const p = phone({ standalone: rnd(2) === 0 });
      const log: string[] = [];
      const act = (name: string, d: Record<string, string>) => { log.push(name); p.tap(d); };
      for (let step = 0; step < 40 && p.inPanel() && !fails.length; step++) {
        const S = p.S;
        const r = rnd(16);
        if (r < 2) { const s = BAR[rnd(4)]; act("bar:" + s, { admtab: s }); }
        else if (r < 3 && !S.admMore) act("more", { admmore: "" });
        else if (r < 4 && S.admMore) { const s = MORE[rnd(6)]; act("row:" + s, { admtab: s }); }
        else if (r < 5 && S.admMore) act("scrim", { admmoreclose: "" });
        else if (r < 6 && S.adminTab === "orders" && !S.adminOrder) act("order", { admorder: "o-1" });
        else if (r < 7 && S.adminOrder) act("order×", { admorder: "" });
        else if (r < 8 && S.adminTab === "goods" && !S.adminEdit) act("editor", { admgoods: "azur" });
        else if (r < 9 && S.adminEdit && !S.goodsConfirmBack) { log.push("type"); p.type(); }
        else if (r < 9 && S.adminEdit) act("←Товары", { admclose: "" });
        else if (r < 10) act("confirm", { confirm: "" });
        else if (r < 11) act("asst", S.admMore ? { admai: "", fromMore: "1" } : { admai: "" });
        else {
          presses++;
          const floor = S.adminTab === "over" && p.layers().length === 0;
          const before = p.where() + "|" + p.layers().join(",") + "|" + !!S.goodsConfirmBack;
          log.push("BACK@" + before);
          p.back();
          const after = p.where() + "|" + (p.inPanel() ? p.layers().join(",") : "") + "|" + !!p.S.goodsConfirmBack;
          if (!floor && !p.inPanel()) fails.push("left early: " + log.join(" "));
          else if (floor && p.inPanel()) fails.push("stayed on «Обзор»: " + log.join(" "));
          else if (!floor && after === before) fails.push("did nothing: " + log.join(" "));
        }
      }
    }
    expect(fails).toEqual([]);
    expect(presses, "the walk hardly pressed Back").toBeGreaterThan(1000);
  });
});
