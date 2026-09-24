/**
 * public/shop2/admin.css — two things a CSS read found (map-defects #20,
 * 24.09.2026):
 *
 *   · `--a-shell` and `--a-num` were read and never defined. A var() with no
 *     definition is not an error anywhere, it is simply nothing: the push
 *     box «Оповещения на телефон» had no ground at all, and the scanner's
 *     zoom figure fell back to whatever it inherited. Now every custom
 *     property the panel's CSS reads is declared in admin.css or styles.css,
 *     or written at run time by app.js.
 *   · the phone's bottom sheets — «Ещё», the confirm card, the assistant's
 *     compose row — stand on the bottom edge of the screen and had no
 *     safe-area inset, so on an iPhone their last row ran under the home
 *     indicator. The bar has had one since the start (--a-barh).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const css = noComments(read("../public/shop2/admin.css"));
const shopCss = noComments(read("../public/shop2/styles.css"));
const app = read("../public/shop2/app.js");

/** Every `@media (max-width: 899px)` block of admin.css, joined — the phone. */
function phone(): string {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = css.indexOf("@media (max-width: 899px)", at);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    let depth = 0, i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    out.push(css.slice(open + 1, i));
    at = i;
  }
  return out.join("\n");
}

/** The body of the first rule whose selector list is exactly `selector`, at the top of `text`. */
function rule(text: string, selector: string): string {
  const rx = new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = rx.exec(text);
  if (!m) throw new Error(`admin.css has no rule «${selector}» here`);
  return m[2];
}

describe("every custom property admin.css reads is defined", () => {
  it("in admin.css, in styles.css, or by app.js at run time", () => {
    const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    const defined = new Set([
      ...[...(css + "\n" + shopCss).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
      ...[...app.matchAll(/setProperty\("(--[\w-]+)"/g)].map((m) => m[1]),
    ]);
    const missing = [...used].filter((n) => !defined.has(n)).sort();
    expect(missing, "read with var() and never defined — drawn as nothing").toEqual([]);
  });
});

describe("the phone's bottom sheets clear the home indicator", () => {
  const INSET = "env(safe-area-inset-bottom";

  it("«Ещё»: the sheet's last row", () => {
    expect(rule(css, ".adm-sheet__foot")).toContain(INSET);
  });

  it("the confirm card, which is a bottom sheet on a phone", () => {
    expect(rule(phone(), ".adm-confirm__card")).toContain(INSET);
  });

  it("the assistant's compose row — and not with the keys up, when the sheet stands on them", () => {
    const p = phone();
    expect(rule(p, ".adm-asst__foot")).toContain(INSET);
    expect(rule(p, "body.adm-typing .adm-asst__foot")).not.toContain(INSET);
  });
});
