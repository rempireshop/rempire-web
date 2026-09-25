/**
 * «Есть несохранённые изменения» — one look, and one you can see.
 *
 * The owner's /test pass of 23.09.2026 (blog-cover-frame, blog-langs): «The
 * "Есть несохранённые изменения — нажмите «Сохранить»." is hard to see.» It
 * was a 13-px line in the warn ink, the same size and weight as every grey
 * hint around it; the save bars said the same thing with one muted word, and
 * on a desktop not at all.
 *
 * Now the state is one thing drawn one way wherever a draft can be lost:
 *   · `.adm-dirty` — the notice over the form (admDirtyNoteHTML);
 *   · `.is-dirty` on the save bar — warm ground, a warn rule, a solid status
 *     chip and «Сохранить» ringed as THE button;
 *   · `.is-dirty` on a Save button outside any bar (the blog's «Публикация»).
 * Put there by the render AND by the in-place paints that run under a caret,
 * so this checks both halves: the class arrives with the first unsaved
 * keystroke and leaves with the save.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8");

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

/** Just enough of an element: a class list, `hidden`, innerHTML, closest(). */
class El {
  cls = new Set<string>();
  hidden = false;
  innerHTML = "";
  constructor(public parent: El | null = null, public tag = "div") {}
  get classList() {
    const s = this.cls;
    return {
      toggle: (c: string, on?: boolean) => { const v = on === undefined ? !s.has(c) : on; if (v) s.add(c); else s.delete(c); return v; },
      contains: (c: string) => s.has(c),
      add: (c: string) => s.add(c),
      remove: (c: string) => s.delete(c),
    };
  }
  set className(v: string) { this.cls = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.cls].join(" "); }
  textContent = "";
  getAttribute(n: string) { return n === "data-barnote" ? "touch" : null; }
  closest(sel: string) { return sel === ".adm-savebar" ? this.parent : null; }
}

const shared = ["admDirtyCls", "admDirtyMark"].map(slice).join("\n");

describe("the notice over the form", () => {
  const note = new Function(`${slice("admDirtyNoteHTML")}\nreturn admDirtyNoteHTML;`)() as (a: string, d: boolean) => string;

  it("is the one shared block, shown while the draft differs", () => {
    const html = note("data-blogdirty", true);
    expect(html).toContain('class="adm-dirty"');
    expect(html).toContain("data-blogdirty");
    expect(html).toContain("Есть несохранённые изменения — нажмите «Сохранить».");
    expect(html).not.toMatch(/\bhidden\b/);
  });

  /* The e2e run of 24.09.2026: with `role="status"` on the note, every check
     that reads the toast by its role (sweep-helpers toastText/clearToast, the
     blog's «Статья готова…») read the note instead while a draft was unsaved —
     «Черновик сохранён» came back as «Есть несохранённые изменения». The role
     is the toast's alone (paintToast); the note is still announced. */
  it("is announced, but leaves `role=\"status\"` to the toast", () => {
    const html = note("data-newsdirty", true);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/role="status"/);
    const roles = src.match(/<[a-z]+ [^>]*role="status"/g) ?? [];
    expect(roles.length, "something other than the two toasts took role=\"status\"").toBe(2);
    for (const tag of roles) expect(tag).toMatch(/class="(adm-toast|toast)"/);
  });

  it("…and hidden, not removed, once saved — the paints only flip `hidden`", () => {
    expect(note("data-blogdirty", false)).toMatch(/\shidden>/);
  });

  it("every editor that had its own line uses it now", () => {
    for (const attr of ["data-blogdirty", "data-maildirty", "data-newsdirty"]) {
      expect(src, `${attr} is still drawn by hand`).toContain(`admDirtyNoteHTML("${attr}"`);
    }
    // the component's own copy is the only one left
    expect(src.match(/Есть несохранённые изменения — нажмите «Сохранить»\.<\/p>/g) ?? [], "a hand-drawn copy is left").toHaveLength(1);
    expect(slice("admDirtyNoteHTML")).toContain("Есть несохранённые изменения — нажмите «Сохранить».</p>");
    expect(src, "the photo strip's notice is drawn by hand").toContain('admDirtyNoteHTML("data-galdirty"');
  });

  /* display:flex on a class beats the UA's [hidden] rule — a notice that is
     «hidden» and still on screen would say «not saved» over a saved form. */
  it("stays hidden when hidden, whatever its display", () => {
    expect(css).toMatch(/\.adm-dirty\[hidden\]\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.adm-dirty\s*\{[^}]*background:/);
  });
});

describe("the save bar takes the state", () => {
  /* 1a (25.09.2026): the settings pages save themselves, so their bar — and
     its «not saved» state — is gone; what is not saved yet is a box's own
     rust edge and line (admAutosave), and the header says «Сохраняем…». */
  it("the settings pages: no save bar left to say it", () => {
    expect(src).not.toContain("data-setbar");
    expect(src).not.toContain("adm-savebar--set");
    expect(src).not.toContain("function paintSetBar(");
    expect(slice("admSetupHTML")).not.toContain("savebar");
  });

  it("the forms that keep no draft (product, promo, set, partner): the touch listener marks the bar", () => {
    const bar = new El();
    const noteEl = new El(bar, "span");
    let st = "dirty";
    const paint = new Function(
      "document", "translateTree", "admBarNoteState", "admBarNoteClass", "admBarNoteText",
      `${shared}\n${slice("admBarPaintNote")}\nreturn admBarPaintNote;`,
    )(
      { querySelector: (s: string) => (s === "[data-barnote]" ? noteEl : null) }, () => {},
      () => st, (s: string) => "adm-savebar__note" + (s === "dirty" ? " adm-savebar__note--warn" : ""), () => "",
    ) as () => void;
    paint();
    expect(bar.classList.contains("is-dirty")).toBe(true);
    st = "saved";
    paint();
    expect(bar.classList.contains("is-dirty")).toBe(false);
  });

  it("the letters and the newsletter repaint their bar with the state", () => {
    let dirty = true;
    const acts = new El();
    const noteEl = new El();
    const paint = new Function(
      "document", "translateTree", "admMailActsHTML", "mailDirty", "paintMailPreview",
      `${shared}\n${slice("paintMailState")}\nreturn paintMailState;`,
    )(
      { getElementById: (id: string) => (id === "mailacts" ? acts : null), querySelector: () => noteEl },
      () => {}, () => "", () => dirty, () => {},
    ) as () => void;
    paint();
    expect(acts.classList.contains("is-dirty")).toBe(true);
    dirty = false;
    paint();
    expect(acts.classList.contains("is-dirty")).toBe(false);
    expect(noteEl.hidden).toBe(true);

    // the newsletter's bar is drawn by the same two helpers
    expect(slice("newsPaintState")).toContain("admDirtyMark(acts, newsDirty())");
    expect(src).toMatch(/'<div class="adm-savebar' \+ admDirtyCls\(newsDirty\(\)\) \+ '" id="newsacts">'/);
    expect(src).toMatch(/'<div class="adm-savebar' \+ admDirtyCls\(mailDirty\(\)\) \+ '" id="mailacts">'/);
  });

  it("the bar's look: warm ground, a solid status chip, «Сохранить» ringed — phone and desktop", () => {
    expect(css).toMatch(/\.adm-savebar\.is-dirty\s*\{[^}]*background:/);
    expect(css).toMatch(/\.adm-savebar\.is-dirty \.adm-savebar__main:not\(\[disabled\]\)/);
    expect(css).toMatch(/\.adm-savebar__note--warn,\s*\.adm-dirtyword\s*\{[^}]*background:/);
    // the desktop used to hide the status word of these bars altogether
    expect(css).not.toMatch(/\.adm-savebar__note--phone, \.adm-savebar__note--short \{ display: none; \}/);
  });
});

describe("the blog's own Save buttons", () => {
  it("are ringed while the article differs and let go after the save", () => {
    let dirty = true;
    const btns = [new El(), new El()];
    const flag = new El();
    const paint = new Function(
      "S", "LANGS", "document", "translateTree", "admLangStateHTML", "blogLangWords", "blogDirty", "blogPubStateHTML",
      `${shared}\n${slice("blogPaintState")}\nreturn blogPaintState;`,
    )(
      { adminBlogEdit: {}, adminBlogBusy: false }, [],
      {
        querySelector: (s: string) => (s === "[data-blogdirty]" ? flag : null),
        querySelectorAll: (s: string) => (s === "[data-admblogsave]" ? btns : []),
      },
      () => {}, () => "", () => ({}), () => dirty, () => "",
    ) as () => void;
    paint();
    expect(btns.every((b) => b.classList.contains("is-dirty"))).toBe(true);
    expect(flag.hidden).toBe(false);
    dirty = false;
    paint();
    expect(btns.some((b) => b.classList.contains("is-dirty"))).toBe(false);
    expect(flag.hidden).toBe(true);
    expect(css).toMatch(/\.adm-btn\.is-dirty:not\(\[disabled\]\)/);
  });
});
