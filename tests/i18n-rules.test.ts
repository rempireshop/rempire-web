/**
 * The storefront's translation tables are hand-written JS literals inside
 * public/shop2/app.js: `UI = { ET: {...}, EN: {...} }` and the regex rule
 * list `UI_RX = [[/^…$/, { ET, EN }], …]`. A merge once dropped the comma
 * between two UI_RX entries; JS then read the next rule as an *index into the
 * previous one* (`[…][ /re/, {…} ]` — comma operator, member access), which
 * left an `undefined` slot in the array and made trText() throw on every
 * ET/EN page — the SPA never booted, while RU (no table) worked fine.
 *
 * Here the two literals are sliced out of app.js by source text and evaluated
 * in a bare VM, so the shape is checked the way the browser sees it, not the
 * way the source reads.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  if (end < 0) throw new Error(`${marker} in public/shop2/app.js has no terminator ${JSON.stringify(terminator)}`);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Rule = [RegExp, { ET: string; EN: string }];
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as { ET: Record<string, string>; EN: Record<string, string> };
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<Rule | undefined>;

describe("UI_RX — the regex translation rules", () => {
  it("has no holes and every entry is [RegExp, {ET, EN}]", () => {
    expect(UI_RX.length).toBeGreaterThan(50);
    const bad: string[] = [];
    UI_RX.forEach((e, i) => {
      const prev = UI_RX[i - 1]?.[0]?.source ?? "(start)";
      if (!e) return bad.push(`#${i} is ${String(e)} (after ${prev}) — a missing comma between two entries?`);
      const [rx, t] = e;
      if (!rx || typeof (rx as RegExp).test !== "function") bad.push(`#${i}: first element is not a RegExp (after ${prev})`);
      if (!t || typeof t.ET !== "string" || typeof t.EN !== "string") bad.push(`#${i} ${rx?.source}: needs string ET and EN`);
    });
    expect(bad).toEqual([]);
  });

  it("never asks for a capture group the regex does not have", () => {
    const bad: string[] = [];
    for (const e of UI_RX) {
      if (!e) continue;
      const groups = new RegExp(e[0].source + "|").exec("")!.length - 1;
      for (const lang of ["ET", "EN"] as const) {
        for (const m of e[1][lang].matchAll(/\$(\d)/g)) {
          if (+m[1] < 1 || +m[1] > groups) bad.push(`${e[0].source} ${lang} uses ${m[0]} but the regex has ${groups} group(s)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("anchors every rule so it cannot fire on a substring", () => {
    const loose = UI_RX.filter((e) => e && !e[0].source.startsWith("^")).map((e) => e![0].source);
    expect(loose).toEqual([]);
  });
});

describe("UI — the ET and EN dictionaries", () => {
  it("are plain string-to-string tables of comparable size", () => {
    for (const lang of ["ET", "EN"] as const) {
      const table = UI[lang];
      expect(Object.keys(table).length).toBeGreaterThan(500);
      const nonString = Object.entries(table).filter(([, v]) => typeof v !== "string").map(([k]) => k);
      expect(nonString).toEqual([]);
    }
    const onlyEt = Object.keys(UI.ET).filter((k) => !(k in UI.EN));
    const onlyEn = Object.keys(UI.EN).filter((k) => !(k in UI.ET));
    expect({ onlyEt, onlyEn }).toEqual({ onlyEt: [], onlyEn: [] });
  });
});
