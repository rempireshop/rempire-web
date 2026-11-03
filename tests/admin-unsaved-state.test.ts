/**
 * «Есть несохранённые изменения» — what is left of the unsaved state.
 *
 * The owner's /test pass of 23.09.2026 (blog-cover-frame, blog-langs) found
 * the line too hard to see, and it was redrawn as one notice and one save-bar
 * look. Since 1a (25.09.2026) every editor saves itself (README § 2): the
 * notice, the save bars and their look are gone from app.js and admin.css.
 * What stays is the wiring that replaced them — each editor's in-place paint
 * hands the draft to its autosave — and the rule the notice taught: the
 * toast's `role="status"` is the toast's alone.
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

/** Just enough of an element: `hidden` and innerHTML. */
class El {
  hidden = false;
  innerHTML = "";
  textContent = "";
}

/* The e2e run of 24.09.2026: with `role="status"` on the unsaved notice,
   every check that reads the toast by its role (sweep-helpers
   toastText/clearToast, the blog's «Статья готова…») read the notice instead
   — «Черновик сохранён» came back as «Есть несохранённые изменения». */
describe("`role=\"status\"` is the toasts' alone", () => {
  it("only the two toasts carry it", () => {
    const roles = src.match(/<[a-z]+ [^>]*role="status"/g) ?? [];
    expect(roles.length, "something other than the two toasts took role=\"status\"").toBe(2);
    for (const tag of roles) expect(tag).toMatch(/class="(adm-toast|toast)"/);
  });
});

describe("the letters and the newsletter save themselves (1a)", () => {
  it("typing repaints the letter's preview and hands the change to the autosave, nothing else", () => {
    expect(slice("paintMailState")).toContain("paintMailPreview()");
    expect(slice("newsPaintState")).toContain('newsAutosave(typing ? "input" : "change")');
  });
});

/* 1a (screen 16; Dim 25.09.2026, q5): the blog has no Save button and no
   unsaved notice any more — every in-place paint hands the draft to the
   shared autosave, which says «Сохраняем… / Сохранено ✓» in the header only
   after the server's 2xx (README § 2). */
describe("the blog saves itself", () => {
  it("every in-place paint redraws the article's line and hands the draft to autosave", () => {
    const pub = new El();
    const err = new El();
    const asked: string[] = [];
    const paint = new Function(
      "S", "LANGS", "document", "translateTree", "admLangStateHTML", "blogLangWords", "blogPubStateHTML", "blogAutosave", "trText",
      `${slice("blogPaintState")}\n${slice("blogPaintErr")}\nreturn blogPaintState;`,
    )(
      { adminBlogEdit: {}, adminBlogErr: "" }, [],
      { querySelector: (s: string) => (s === "[data-blogpubstate]" ? pub : s === "[data-blogerr]" ? err : null) },
      () => {}, () => "", () => ({}), () => "○ Черновик — в магазине не видно",
      (ev: string) => { asked.push(ev); return true; }, (t: string) => t,
    ) as () => void;
    paint();
    expect(pub.innerHTML).toBe("○ Черновик — в магазине не видно");
    expect(err.hidden, "an empty error line is on screen").toBe(true);
    expect(asked, "a paint did not hand the draft to autosave").toEqual(["input"]);
  });
});
