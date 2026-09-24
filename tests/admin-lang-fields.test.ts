/**
 * A text typed in one language never stands in another language's box.
 *
 * The owner, /test pass of 23.09.2026, item blog-langs: «The subject from
 * Russian — I wrote "test" — travels also to English; it can be seen, but it
 * does not seem to be stored. When manually doing this it should not travel
 * from one language to another, especially a Russian subject should not
 * appear in English.»
 *
 * The panel is morph-patched, not rebuilt (admMorphNode). The title box is
 * ONE <input> in RU and in EN, told apart only by data-blogl, and the morph
 * keeps whatever the owner typed into a box unless the markup's own value
 * changed. A new article's title is empty in both languages, so the markup
 * said "" before the switch and "" after it — and the Russian «test» stayed
 * on screen under «EN». Not in the EN draft («not stored»)… until the next
 * switch or save read the box back and filed it as the English title.
 *
 * The newsletter's subject and its blocks' texts had the same box and no
 * language on it at all.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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
function block(head: string, from = 0): string {
  const start = src.indexOf(head, from);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in «${head}»`);
}

/** An <input>/<textarea> as far as the morph and the form readers look at it. */
class Box {
  nodeType = 1;
  attrs = new Map<string, string>();
  value = "";
  textContent = "";
  checked = false;
  constructor(public tagName: string, attrs: Record<string, string>, text = "") {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    if (tagName === "INPUT") this.value = attrs.value ?? "";
    else { this.textContent = text; this.value = text; }
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(n: string) { return this.attrs.has(n) ? this.attrs.get(n)! : null; }
  hasAttribute(n: string) { return this.attrs.has(n); }
  setAttribute(n: string, v: string) { this.attrs.set(n, String(v)); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  get dataset() {
    const out: Record<string, string> = {};
    for (const [k, v] of this.attrs) if (k.startsWith("data-")) out[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    return out;
  }
  get isContentEditable() { return false; }
}

const morphSrc = ["admFieldKey", "admMorphAttrs", "admSelectedIdx", "admMorphChildren", "admMorphNode"]
  .filter((n) => n !== "admFieldKey" || src.includes("function admFieldKey("))
  .map(slice).join("\n");
const morph = new Function(`${morphSrc}\nreturn admMorphNode;`)() as (from: Box, to: Box) => void;

const title = (L: string) => new Box("INPUT", { class: "adm-title-in", "data-blogf": "title", "data-blogl": L, value: "" });

describe("the morph gives a box that changed language that language's text", () => {
  it("the blog title typed in RU does not stand in the EN box", () => {
    const box = title("RU");
    box.value = "test";                           // typed, never rendered
    morph(box, title("EN"));
    expect(box.getAttribute("data-blogl")).toBe("EN");
    expect(box.value, "the Russian title is on screen under «EN»").toBe("");
  });

  it("the lead, the Google title and description too — a <textarea> the same as an <input>", () => {
    const ex = (L: string) => new Box("TEXTAREA", { "data-blogf": "excerpt", "data-blogl": L }, "");
    const box = ex("RU");
    box.value = "Русский анонс";
    morph(box, ex("EN"));
    expect(box.value).toBe("");
    const seo = (L: string) => new Box("INPUT", { "data-blogf": "seoTitle", "data-blogl": L, value: "" });
    const s = seo("RU");
    s.value = "Русский заголовок для Google";
    morph(s, seo("ET"));
    expect(s.value).toBe("");
  });

  it("…and the EN text is what the EN box shows when there is one", () => {
    const box = title("RU");
    box.value = "test";
    const en = title("EN");
    en.setAttribute("value", "Beard care in winter");
    morph(box, en);
    expect(box.value).toBe("Beard care in winter");
  });

  it("a background render of the SAME field still keeps what is being typed", () => {
    const box = title("RU");
    box.value = "tes";                            // mid-word, the order search just answered
    morph(box, title("RU"));
    expect(box.value).toBe("tes");
  });

  it("the app's own marks on a live box are not a new field (a salon price typed by hand)", () => {
    const cell = (auto: string) => new Box("INPUT", { "data-edpx": "0", "data-edauto": auto, value: "10" });
    const box = cell("0");
    box.value = "12";
    morph(box, cell("1"));
    expect(box.value).toBe("12");
  });
});

describe("the switch and the save file each language under its own name", () => {
  it("RU «test», switch to EN, back to RU: EN is still empty and RU still «test»", () => {
    const d = { title: { RU: "", ET: "", EN: "" }, excerpt: { RU: "", ET: "", EN: "" }, author: "" } as Record<string, unknown>;
    const box = title("RU");
    const read = new Function(
      "S", "document", "blogBox", "blogBoxLang", "blogBoxHtml",
      `${slice("blogFieldLang")}\n${slice("blogReadForm")}\nreturn blogReadForm;`,
    )(
      { adminBlogEdit: d, adminTab: "blog" },
      { querySelectorAll: (s: string) => (s === "[data-blogf]" ? [box] : []), querySelector: () => null },
      () => null, () => "", () => "",
    ) as () => void;

    box.value = "test";                           // the owner types the Russian title
    read();                                       // «EN» pressed: the language being left is read
    morph(box, title("EN"));                      // …and the screen becomes the English one
    read();                                       // «RU» pressed again (or «Сохранить»)
    expect((d.title as Record<string, string>).EN, "the Russian title was filed as the English one").toBe("");
    expect((d.title as Record<string, string>).RU).toBe("test");
  });
});

describe("the newsletter: its subject and its blocks say which language they hold", () => {
  // the newsletter's own `input` listener, whole — the anonymous function after its comment
  const listener = block("function (e) {", src.indexOf("The fields write straight into the draft"));

  function type(target: Record<string, unknown>, newsLang: string) {
    const nd = { title: "", subject: { RU: "", ET: "", EN: "" } };
    const blk = { k: "b1", t: "text", text: { RU: "", ET: "", EN: "" } };
    const run = new Function(
      "S", "newsPreviewSoon", "newsPaintState", "newsBlockByKey", "NEWS_SRC", "newsPickRows", "translateTree",
      `return (${listener});`,
    )(
      { newsEdit: nd, newsLang },
      () => {}, () => {}, () => blk, {}, () => "", () => {},
    ) as (e: unknown) => void;
    const ds = target.dataset as Record<string, string>;
    run({ target: { matches: (s: string) => (s === "[data-newsf]" ? "newsf" in ds : s === "[data-nbf]" ? "nbf" in ds : false), ...target } });
    return { nd, blk };
  }

  it("the subject box is marked with its language and filed by it", () => {
    expect(/data-newsf="subject" data-newsl="' \+ L \+ '"/.test(src), "the subject box does not say its language").toBe(true);
    // typed into the RU box while S already says EN (the tap on «EN» landed first)
    const { nd } = type({ dataset: { newsf: "subject", newsl: "RU" }, value: "test" }, "EN");
    expect(nd.subject).toEqual({ RU: "test", ET: "", EN: "" });
  });

  it("a text block's box too", () => {
    expect((src.match(/data-nbf="(?:text|label)" data-nbk="' \+ b\.k \+ '" data-nbl="' \+ L \+ '"/g) ?? []).length).toBe(3);
    const { blk } = type({ dataset: { nbf: "text", nbk: "b1", nbl: "RU" }, value: "Привет" }, "EN");
    expect(blk.text).toEqual({ RU: "Привет", ET: "", EN: "" });
  });

  it("the other one-box-per-language editors name their language as well", () => {
    for (const [re, what] of [
      [/data-herof="' \+ key \+ '" data-herol="' \+ L \+ '"/, "the banner's texts"],
      [/data-bundlef="title" data-bundlel="' \+ lang \+ '"/, "a set's name"],
      [/data-bundlef="desc" data-bundlel="' \+ lang \+ '"/, "a set's description"],
      [/data-mailtxt="' \+ field \+ '" data-maill="' \+ lang \+ '"/, "a letter's texts"],
    ] as const) expect(re.test(src), `${what}: the box does not say its language`).toBe(true);
  });
});
