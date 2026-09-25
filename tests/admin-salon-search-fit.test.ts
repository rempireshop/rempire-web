/**
 * «Салон»: the search box's words show whole beside «Сканировать», with the
 * magnifier, on every phone from 360 px up — in RU, ET and EN.
 *
 * Verification pass on staging, 25.09.2026 (panel-phone-fit, e2): at 390 px
 * «Название, бренд, штрихкод» (219 px in 16-px Golos Text) ran out of a box
 * that had 207 px for text, and under 390 px admin.css took the magnifier
 * away to make room. Measured here with the panel's own font file, the way
 * the phone draws it (fontkit's advance widths agree with Chromium to 0.1 px),
 * against the row's own CSS numbers.
 */
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../public/shop2/app.js");
const css = read("../public/shop2/admin.css").replace(/\r\n/g, "\n");
const golos = fontkit.create(readFileSync(fileURLToPath(new URL("../public/fonts/GolosText-Regular.ttf", import.meta.url))));
const px = (text: string, size = 16) => (golos.layout(text).advanceWidth / golos.unitsPerEm) * size;

/** The salon box's placeholder, and what the ET and EN dictionaries make of it. */
function placeholders(): Record<string, string> {
  const m = src.match(/data-posq value="[\s\S]{0,120}?placeholder="([^"]+)"/);
  if (!m) throw new Error("the salon search box has no placeholder");
  const ru = m[1];
  const tr = [...src.matchAll(new RegExp(`\\n\\s+"${ru.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": "([^"]+)",`, "g"))].map((x) => x[1]);
  expect(tr, "an ET and an EN entry for the placeholder").toHaveLength(2);
  return { RU: ru, ET: tr[0], EN: tr[1] };
}

/** A number out of the first rule in `block` that sets `prop`. */
function num(block: string, re: RegExp): number {
  const m = block.match(re);
  if (!m) throw new Error(`admin.css: ${re} not found`);
  return Number(m[1]);
}
function mediaBlock(query: string): string {
  const i = css.indexOf(`@media (${query}) {\n  .adm-salon__grid`);
  if (i < 0) throw new Error(`admin.css: @media (${query}) for the salon not found`);
  return css.slice(i, css.indexOf("\n}\n", i));
}

/** Room for the words at `vw` px: the phone page, minus the gap and «Сканировать», minus the box's own padding. */
function room(vw: number, glass: boolean): number {
  const phone = css.slice(css.indexOf("  .adm-page { padding: 20px 16px"));
  const gutter = num(phone, /\.adm-page \{ padding: \d+px (\d+)px/);
  const narrow = mediaBlock("max-width: 1180px");
  const gap = num(narrow, /\.adm-salon__find \{ gap: (\d+)px; \}/);
  const scan = num(narrow, /\.adm-posscan \{\s*width: (\d+)px/);
  const right = num(narrow, /\.adm-input--find \{ padding: 0 (\d+)px; \}/);
  const left = glass ? num(css, /\.adm2 \.adm-search > \.adm-input, \.adm-search > \.scan__find \{ padding-left: (\d+)px; \}/) : right;
  const border = 2;
  return vw - 2 * gutter - gap - scan - left - right - border;
}

/** The widest viewport at which admin.css still takes the salon's magnifier away. */
function glassGoneBelow(): number {
  const m = css.match(/@media \(max-width: (\d+)px\) \{\n\s+\.adm-salon__q \.adm-search__i \{ display: none; \}/);
  return m ? Number(m[1]) : 0;
}

describe("«Салон»: the search box's words fit, with the magnifier", () => {
  it("the magnifier stays on every phone from 360 px up", () => {
    expect(glassGoneBelow()).toBeLessThan(360);   // before: 389
  });

  it("the words fit whole at 360, 375, 390 and 414 px in all three languages", () => {
    const ph = placeholders();
    /* 15 px of slack: a desktop browser's classic scrollbar, which is how the
       verification pass measured it (a 390-px frame) — a phone's overlay
       scrollbar takes nothing, so on the phone itself there is more room */
    const SLACK = 15;
    for (const vw of [360, 375, 390, 414]) {
      for (const [L, text] of Object.entries(ph)) {
        const w = px(text);
        expect(w, `${L} «${text}» is ${w.toFixed(1)} px, the box has ${room(vw, true) - SLACK} at ${vw} px`)
          .toBeLessThanOrEqual(room(vw, true) - SLACK);
      }
    }
  });

  it("…and under 360 px, where the magnifier steps aside, they still fit at 320", () => {
    for (const text of Object.values(placeholders())) expect(px(text)).toBeLessThanOrEqual(room(320, false));
  });

  it("the measure is the panel's: «Название, бренд, штрихкод» is the 219 px the pass found", () => {
    expect(px("Название, бренд, штрихкод")).toBeCloseTo(219.7, 0);
  });
});
