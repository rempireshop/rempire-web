/**
 * Every Russian text the shop and the panel paint has its ET and its EN.
 *
 * 09.11.2026, Dim, on an English panel: «I have admin in english (same
 * issue in estonian) but I have russian text here». The ads fold in
 * «Аналитика» (05.11), the whole «Новая статья» from materials (02.11), the
 * Помощник's answers about a saved file and the pickup toast (06.11) had
 * shipped with no dictionary entries. tools/i18n-gaps.mjs listed every one of
 * them — nothing ran it. This file runs it: a new Russian string without its
 * ET and EN (or a reason in the tool for staying Russian) fails here.
 *
 * The tool reads source, so a line glued together at run time is only as
 * good as the rule that reads it whole. The second half of this file feeds
 * the real shapes of this round's composed lines through the dictionary.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const TOOL = fileURLToPath(new URL("../tools/i18n-gaps.mjs", import.meta.url));
const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));

type Row = { file: string; fn: string; kind: string; text: string; lines: number[] };

describe("tools/i18n-gaps.mjs", () => {
  it("finds no Russian interface text without its ET and EN", () => {
    const out = execFileSync(process.execPath, [TOOL, "--json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const report = JSON.parse(out) as { missing: number; rows: Row[] };
    const list = report.rows.map((r) =>
      `${r.file}:${r.lines[0]} ${r.fn}${r.kind === "text" ? "" : " [@" + r.kind + "]"} «${r.text.replace(/\u0001/g, "{…}")}»`);
    expect(list, "add the ET and EN to UI / UI_RX in public/shop2/app.js — or, when it is never shown, the reason to tools/i18n-gaps.mjs").toEqual([]);
    expect(report.missing).toBe(0);
  });
});

/* ---------- the composed lines, the way the panel paints them ---------- */
const src = readFileSync(APP_JS, "utf8");
function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}
type Lang = "ET" | "EN";
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as Record<Lang, Record<string, string>>;
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<[RegExp, Record<Lang, string>] | undefined>;
const own = (d: Record<string, string>, k: string) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : "");
/** trText() from app.js without its product-name branch: a whole key, else the first rule. */
function trText(s: string, lang: Lang): string {
  const d = UI[lang];
  const exact = own(d, s);
  if (exact) return exact;
  for (const e of UI_RX) {
    if (!e) continue;
    const m = s.match(e[0]);
    if (m) return e[1][lang].replace(/\$(\d)/g, (_, n: string) => own(d, m[+n]) || m[+n]);
  }
  return s;
}
const CYR = /[А-Яа-яЁё]/;

/* Text nodes as the browser has them. Data holes carry Latin samples, so any
   Russian left in an answer is ours. */
const NODES: Array<[string, string]> = [
  ["ads row, with a sum", "переходов 12 · заказов 1 · 34,90 €"],
  ["ads row, no order", "переходов 3 · заказов 0"],
  ["ads fold summary after the first row's name", "· переходов 12 · заказов 2 · 59,80 €"],
  ["ads fold summary, no order", "· переходов 3 · заказов 0"],
  ["a PDF material, one page", "1 страница · картинок: 2"],
  ["a PDF material", "24 страницы · картинок: 9"],
  ["a PDF material, no pictures", "5 страниц · без картинок"],
  ["a PDF with no page count", "PDF · без картинок"],
  ["a PDF with no page count, pictures", "PDF · картинок: 3"],
  ["a PDF to tick", "12 страниц · страниц с фото: 4 · отмечено: 2"],
  ["reading a PDF", "Читаю PDF: страница 3 из 12"],
  ["its pictures going up", "Загружаю картинки: 2 из 4"],
  ["photos going up", "Загружаю фото: 1 из 3"],
  ["phrases not in the materials, one", "1 фраза не нашлась в материалах — отмечены жёлтым в тексте. Проверьте или уберите."],
  ["phrases not in the materials", "3 фразы не нашлись в материалах — отмечены жёлтым в тексте. Проверьте или уберите."],
  ["a placed picture, page and heading", "· стр. 4 — под заголовком «"],
  ["a placed picture, page only", "· стр. 4"],
  ["a placed picture, heading only", "— под заголовком «"],
  ["the article's products", "Товары статьи — 6"],
  ["more material than one draft", "Материалов больше, чем помещается в один черновик: прочитано 60 тыс. знаков из 140 тыс. — страницы по теме и к отмеченным картинкам."],
  ["the blog's top is full", "На главной блога уже три статьи: «Kevin Murphy guide», «Beard oil», «AHA BHA». Снимите одну из них, чтобы поставить эту."],
  ["photos sent with no words, one", "📎 1 фото"],
  ["photos sent with no words", "📎 3 фото"],
  ["a source row's field", "Материал 2"],
  ["pickup order ready", "R-100042 готов к выдаче · письмо уйдёт через 10 с"],
  ["journal: a subsection", "Подраздел «Bio Botanical Shampoo»: без подраздела"],
  ["journal: an article from materials, with its topic", "Новая статья из материалов (3) на тему «Fine hair in winter»"],
  ["journal: an article from materials", "Новая статья из материалов (2)"],
];

describe("this round's composed lines", () => {
  for (const lang of ["ET", "EN"] as const) {
    it(`come out in ${lang} with no Russian left`, () => {
      const left = NODES.map(([what, ru]) => [what, ru, trText(ru, lang)] as const)
        .filter(([, ru, out]) => out === ru || CYR.test(out))
        .map(([what, ru, out]) => `${what}: «${ru}» → «${out}»`);
      expect(left).toEqual([]);
    });
  }

  it("say 1 page / 1 photo / 1 phrase in English, and the plural for every other count", () => {
    expect(trText("1 страница · картинок: 2", "EN")).toBe("1 page · pictures: 2");
    expect(trText("21 страница · картинок: 2", "EN")).toBe("21 pages · pictures: 2");
    expect(trText("📎 1 фото", "EN")).toBe("📎 1 photo");
    expect(trText("21 фраза не нашлась в материалах — отмечены жёлтым в тексте. Проверьте или уберите.", "EN"))
      .toMatch(/^21 phrases were not found/);
  });

  it("keep the data a line carries: the sum, the order number, the product's name", () => {
    expect(trText("переходов 12 · заказов 1 · 34,90 €", "EN")).toBe("visits: 12 · orders: 1 · 34,90 €");
    expect(trText("R-100042 готов к выдаче · письмо уйдёт через 10 с", "ET")).toBe("R-100042 valmis üleandmiseks · kiri läheb 10 s pärast");
    expect(trText("Подраздел «Bio Botanical Shampoo»: без подраздела", "EN")).toBe("Subsection «Bio Botanical Shampoo»: no subsection");
  });
});

/* The Помощник draws every answer data-notr (admReplyHTML) — a model's answer
   is in the panel's language already — so the panel's OWN answers about a
   file have to be put in that language when they are made, or an English
   panel reads «Сохранил в материалы блога…» whatever the dictionary says. */
describe("the panel's own answers in the Помощник", () => {
  it("go through trText() where they are made", () => {
    const locals = src.match(/reply: [^\n]*local: true/g) || [];
    expect(locals.length).toBeGreaterThanOrEqual(4);
    for (const l of locals) {
      if (/reply: reply,/.test(l)) continue;   // admMatConfirm builds `reply` from T() pieces, checked below
      expect(l, l).toMatch(/reply: trText\(/);
    }
    const confirm = src.slice(src.indexOf("function admMatConfirm("), src.indexOf("function admLocalChipsHTML("));
    expect(confirm).toMatch(/var reply = T\("Сохранил в материалы блога:"\)/);
    expect(confirm).toMatch(/T\(bnewItemNote\(/);
  });

  it("and the PDF's progress line under the strip is ours, so it is translated too", () => {
    expect(src).not.toMatch(/data-admattnote data-notr/);
    const paint = src.slice(src.indexOf("function admAttNotePaint("), src.indexOf("function admAttNotePaint(") + 400);
    expect(paint).toMatch(/textContent = trText\(att\.note/);
  });
});
