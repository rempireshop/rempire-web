/**
 * A product card inside an article can be taken out of the text with a
 * cross — ai-blog-cards e6 (verification pass on staging, 25.09.2026: «no ×
 * on inline cards in the editor DOM — × exists only in «Товары в статье»,
 * which removes from that list and leaves the inline card»).
 *
 * The assistant puts two to four cards into the text by itself, and a card
 * in the editor is an underlined name: the only way out was the caret and
 * backspace. A picture in the same box already has its controls — tap it,
 * it is ringed and a bar opens under it (admFigOpen) — so a card gets the
 * same: tapped, a bar with «Убрать карточку»; pressed, the card leaves the
 * text (and its line, when the line held nothing else), and the article
 * saves itself like any edit (blogSync). The bar is the pictures' own
 * layer, `data-figui`, which blogBoxHtml() keeps out of everything that
 * reads the box.
 *
 * The panel's functions are cut out of public/shop2/app.js and run against a
 * few lines of fake DOM — enough of Node for what they touch, nothing more.
 * e2e/admin-blog-pictures.spec.ts drives the same thing in a browser.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
function braces(start: number, what: string): string {
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  return braces(start, name);
}
/** The document-level click listener that owns the picture controls. */
function pictureClicks(): string {
  const at = src.indexOf('var set = t.closest("[data-figset]");');
  if (at < 0) throw new Error("the picture click listener is gone from app.js");
  const start = src.lastIndexOf('document.addEventListener("click", function (e) {', at);
  return braces(start, "the picture click listener") + ");";
}

/* ---- a few lines of DOM ---------------------------------------------------- */

type Attrs = Record<string, string>;
class El {
  tagName: string;
  attrs: Attrs;
  kids: Array<El | Txt> = [];
  parentNode: El | null = null;
  style: Record<string, string> = {};
  offsetTop = 40;
  offsetHeight = 24;
  html = "";
  constructor(tag: string, attrs: Attrs = {}, kids: Array<El | Txt> = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    for (const k of kids) this.appendChild(k);
  }
  get nodeType() { return 1; }
  get textContent(): string { return this.kids.map((k) => k.textContent).join(""); }
  get firstChild() { return this.kids[0] ?? null; }
  set innerHTML(v: string) {
    // what admCardOpen() writes into its holder: one bar, kept as the markup it is
    this.kids = [];
    const bar = new El("div", /data-figui/.test(v) ? { "data-figui": "" } : {});
    bar.html = v;
    this.appendChild(bar);
  }
  getAttribute(n: string) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n: string, v: string) { this.attrs[n] = String(v); }
  removeAttribute(n: string) { delete this.attrs[n]; }
  hasAttribute(n: string) { return n in this.attrs; }
  appendChild<T extends El | Txt>(k: T): T {
    if (k.parentNode) k.parentNode.removeChild(k);
    k.parentNode = this;
    this.kids.push(k);
    return k;
  }
  removeChild(k: El | Txt) {
    const i = this.kids.indexOf(k);
    if (i < 0) throw new Error("not a child");
    this.kids.splice(i, 1);
    k.parentNode = null;
    return k;
  }
  contains(n: El | Txt | null): boolean {
    for (let x: El | Txt | null = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  matches(sel: string): boolean {
    return sel.split(",").some((one) => {
      const m = one.trim().match(/^([a-z]*)((?:\[[a-z-]+\])*)((?:\.[a-z-]+)*)$/i);
      if (!m) throw new Error(`the fake DOM does not know the selector ${one}`);
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      for (const a of m[2].match(/[a-z-]+/gi) || []) if (!(a in this.attrs)) return false;
      for (const c of m[3].split(".").filter(Boolean)) if (!(this.attrs.class || "").split(" ").includes(c)) return false;
      return true;
    });
  }
  closest(sel: string): El | null {
    for (let x: El | null = this; x; x = x.parentNode) if (x.matches(sel)) return x;
    return null;
  }
  querySelectorAll(sel: string): El[] {
    const out: El[] = [];
    const walk = (e: El) => { for (const k of e.kids) if (k instanceof El) { if (k.matches(sel)) out.push(k); walk(k); } };
    walk(this);
    return out;
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  scrollIntoView() {}
}
class Txt {
  parentNode: El | null = null;
  constructor(public textContent: string) {}
  get nodeType() { return 3; }
}
const card = (id: string, name = "Bio Botanical Shampoo — шампунь") =>
  new El("a", { "data-product": id, "data-price": "live", href: `/shop2/p/${id}/` }, [new Txt(name)]);

/** The editor's box with two cards: one alone on its line, one inside a sentence. */
function article() {
  const alone = card("system-4-bio-botanical-shampoo");
  const inline = card("system-4-bio-botanical-serum", "Bio Botanical Serum — сыворотка");
  const box = new El("div", { "data-blogbody": "RU", contenteditable: "true", class: "adm-canvas" }, [
    new El("p", {}, [new Txt("Осенью волосы сохнут.")]),
    new El("p", {}, [alone]),
    new El("p", {}, [new Txt("Капля "), inline, new Txt(" на кончики.")]),
  ]);
  return { box, alone, inline };
}

/** admCardOpen / admCardRemove / admFigClose, bound to one fake box and a record of what they called. */
function panel(box: El, kind = "blog") {
  const calls = { sync: 0, translated: 0 };
  const doc = { createElement: (t: string) => new El(t) };
  const S = { adminTab: "blog", adminBlogEdit: { body: { RU: "" } }, adminBlogLang: "RU" };
  const fns = new Function(
    "S", "document", "blogBox", "richDraft", "blogSync", "translateTree",
    `var FIGSEL = null, CARDSEL = null;
     ${slice("admFigClose")}
     ${slice("admCardBarHTML")}
     ${slice("admCardOpen")}
     ${slice("admCardRemove")}
     return { open: admCardOpen, remove: admCardRemove, close: admFigClose, bar: admCardBarHTML, sel: function () { return CARDSEL; } };`,
  )(
    S, doc, () => box, () => ({ body: S.adminBlogEdit.body, lang: "RU", kind }),
    () => { calls.sync++; }, () => { calls.translated++; },
  ) as { open: (a: El) => void; remove: () => void; close: () => void; bar: () => string; sel: () => El | null };
  return { ...fns, calls };
}

describe("a product card in the article's text has a cross", () => {
  it("the bar is the pictures' own layer — kept out of the article — with one button, «Убрать карточку»", () => {
    const { bar } = panel(new El("div"));
    const html = bar();
    expect(html).toMatch(/^<div class="adm-fig[^"]*" data-figui contenteditable="false">/);
    expect(html).toMatch(/<button type="button" class="adm-fig__b[^"]*" data-cardx>/);
    expect(html).toContain("<span>Убрать карточку</span>");
  });

  it("a tap on a card rings it and opens the bar under it, inside the box", () => {
    const { box, alone } = article();
    const p = panel(box);
    p.open(alone);
    expect(p.sel()).toBe(alone);
    expect(alone.getAttribute("class")).toBe("is-figon");
    const bars = box.querySelectorAll("[data-figui]");
    expect(bars).toHaveLength(1);
    expect(bars[0].html).toContain("data-cardx");
    expect(bars[0].style.top).toBe(`${40 + 24 + 8}px`);
    expect(p.calls.translated, "the bar's words go through the dictionary like the picture bar's").toBe(1);
    // a second tap elsewhere replaces it — never two bars
    const { inline } = { inline: box.querySelectorAll("a[data-product]")[1] };
    p.open(inline);
    expect(box.querySelectorAll("[data-figui]")).toHaveLength(1);
    expect(alone.getAttribute("class"), "the first card kept its ring").toBeNull();
  });

  it("«Убрать карточку» takes a card that stood alone out together with its line, and the article saves", () => {
    const { box, alone } = article();
    const p = panel(box);
    p.open(alone);
    p.remove();
    expect(box.querySelectorAll("a[data-product]").map((a) => a.getAttribute("data-product"))).toEqual(["system-4-bio-botanical-serum"]);
    expect(box.querySelectorAll("p"), "the empty line the card stood on stayed behind").toHaveLength(2);
    expect(box.querySelectorAll("[data-figui]"), "the bar outlived its card").toHaveLength(0);
    expect(p.sel()).toBeNull();
    expect(p.calls.sync, "the removal never reached the draft — nothing would save").toBe(1);
  });

  it("…and a card inside a sentence leaves the sentence where it was", () => {
    const { box, inline } = article();
    const p = panel(box);
    p.open(inline);
    p.remove();
    expect(box.querySelectorAll("a[data-product]")).toHaveLength(1);
    expect(box.querySelectorAll("p")).toHaveLength(3);
    expect(box.querySelectorAll("p")[2].textContent).toBe("Капля  на кончики.");
    expect(p.calls.sync).toBe(1);
  });

  it("a bar left over from a repaint removes nothing", () => {
    const { box, alone } = article();
    const p = panel(box);
    p.open(alone);
    alone.parentNode!.removeChild(alone);   // render() rebuilt the box: the ringed card is not in it any more
    p.remove();
    expect(box.querySelectorAll("a[data-product]")).toHaveLength(1);
    expect(p.calls.sync).toBe(0);
  });

  it("the click listener sends a tap on a card to the bar, and the cross to the removal", () => {
    const { box, alone } = article();
    const seen: string[] = [];
    let listener: ((e: unknown) => void) | null = null;
    const doc = { addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === "click") listener = fn; } };
    new Function(
      "document", "admFigApply", "admFigMove", "admFigOpen", "admFigClose", "admCardOpen", "admCardRemove", "FIGSEL", "CARDSEL",
      pictureClicks(),
    )(
      doc, () => seen.push("apply"), () => seen.push("move"), () => seen.push("fig"), () => seen.push("close"),
      (a: El) => seen.push("card:" + a.getAttribute("data-product")), () => seen.push("remove"), null, null,
    );
    expect(listener, "no click listener was registered").not.toBeNull();
    let prevented = 0;
    const click = (target: El | Txt) => listener!({ target, preventDefault: () => { prevented++; } });
    click(alone);
    expect(seen).toEqual(["card:system-4-bio-botanical-shampoo"]);
    expect(prevented).toBe(1);
    const bar = box.appendChild(new El("div", { "data-figui": "" }, [new El("button", { "data-cardx": "" })]));
    click(bar.kids[0] as El);
    expect(seen).toEqual(["card:system-4-bio-botanical-shampoo", "remove"]);
    // a card outside the editor (the shop's own article page) is not the editor's business
    click(card("x-outside"));
    expect(seen).toHaveLength(2);
    /* a double or triple click on a card is the owner selecting its words or
       its line — e2e/admin-blog.spec.ts deletes a placed card that way — so
       the bar makes way and the browser's own selection is left alone */
    prevented = 0;
    listener!({ target: alone, detail: 2, preventDefault: () => { prevented++; } });
    listener!({ target: alone, detail: 3, preventDefault: () => { prevented++; } });
    expect(seen).toEqual(["card:system-4-bio-botanical-shampoo", "remove", "close", "close"]);
    expect(prevented, "a multi-click was stopped — the line could not be selected").toBe(0);
  });

  it("pressing the cross does not take the caret out of the box (mousedown is stopped, like the picture bar's)", () => {
    // the listener that keeps the toolbar's and the picture bar's presses from blurring the box
    const figset = src.indexOf("[data-figset],[data-figmove]");
    expect(figset).toBeGreaterThan(0);
    const at = src.lastIndexOf('document.addEventListener("mousedown", function (e) {', figset);
    expect(at).toBeGreaterThan(0);
    expect(braces(at, "the mousedown listener")).toContain("[data-cardx]");
  });
});
