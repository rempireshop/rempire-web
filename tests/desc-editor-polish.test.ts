/**
 * The product description editor, polished after Dim's note of 02.11.2026
 * (a screenshot of the ENGLISH panel):
 *
 *   «Although my admin is in english — texts are in russian. Also I do not
 *    see what «Разбить на разделы» really does, what becomes bold and what
 *    doesn't. This needs a polish.»
 *
 * Held here:
 *   · every line of the block — labels, tooltips, the (?) help, the toasts of
 *     the format bar and of «Разбить на разделы» — is in both dictionaries
 *     (tools/i18n-gaps.mjs, the same static check the whole shop has), and
 *     the toolbar reads «B / Heading / • List» on the ET and EN panels, each
 *     with the mark it writes in its tooltip;
 *   · «Так увидит покупатель» draws the owner's words with the page's own
 *     renderer and keeps the panel's dictionary off them ([data-notr]);
 *   · «Разбить на разделы» proposes, «Применить» applies to the language the
 *     proposal was made for, «Вернуть как было» puts the old text back, and a
 *     box changed in between is never overwritten;
 *   · the card opens «Описание» on the panel's language when that text exists.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { descFormatBlock } from "../tools/lib/seo-copy-block.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const CSS = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const CYRILLIC = /[А-Яа-яЁё]/;

function slice(name: string): string {
  const start = APP.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP.indexOf("{", start); i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}" && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
/** A `var NAME = [ … ];` / `{ … };` declaration, as source. */
function decl(name: string): string {
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = APP.indexOf(`var ${name} = ${open}`);
    if (start < 0) continue;
    let depth = 0;
    for (let i = APP.indexOf(open, start); i < APP.length; i++) {
      if (APP[i] === open) depth++;
      else if (APP[i] === close && --depth === 0) return `${APP.slice(start, i + 1)};`;
    }
    throw new Error(`unbalanced ${open}${close} around ${name}`);
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}
/** One `if (d.<hook> !== undefined) { … }` block of the click handler, as source. */
function handler(hook: string): string {
  const start = APP.indexOf(`if (d.${hook} !== undefined) {`);
  if (start < 0) throw new Error(`the click handler no longer answers d.${hook}`);
  let depth = 0;
  for (let i = APP.indexOf("{", start); i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}" && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around d.${hook}`);
}
const lineOf = (needle: string) => APP.slice(0, APP.indexOf(needle)).split("\n").length;

/* The panel's own translator with its own two tables — as admin-chip-labels does it. */
const tr = new Function("S", "LANG", `
  ${decl("UI")}
  ${decl("UI_RX")}
  ${slice("trName")}
  ${decl("TAIL_EXACT")}
  ${decl("NAME_TAILS")}
  ${decl("NAME_FRAGS")}
  ${slice("trText")}
  return trText(S, LANG, false);
`) as (s: string, lang: string) => string;

/* ---------- 1. the block reads in the panel's language ---------- */

describe("«Описание» on an ET or EN panel — no Russian left in the block", () => {
  type Row = { text: string; fn: string; lines: number[]; kind: string };
  const gaps = JSON.parse(execFileSync(process.execPath, ["tools/i18n-gaps.mjs", "--json"], { cwd: ROOT, encoding: "utf8" })) as { rows: Row[] };
  const FNS = new Set([
    "edSecDesc", "edDescBody", "edTrLabel", "edFmtBarHTML", "edDescPrevHTML", "edDescPrevPaint", "edDescShopHTML", "edDescShopOpen",
    "edDescSplitHTML", "edDescSplitPaint", "edDescSplitApply", "edDescSplitUndo", "edDescSplitCheck", "edFmt", "edFmtBold", "edFmtHead",
    "edFmtList", "edLangShow", "edLangStatePaint",
  ]);
  /* the click handler's three description buttons (the tool files them
     under whatever function it last saw, so they are taken by their lines) */
  const from = lineOf("if (d.admdescgen !== undefined) {");
  const to = lineOf("if (d.edfmt !== undefined) {");

  it("finds the block at all — an empty sweep proves nothing", () => {
    expect(gaps.rows.length).toBeGreaterThan(50);
    expect(to - from).toBeGreaterThan(40);
    for (const f of FNS) expect(APP, f).toContain(`function ${f}(`);
  });
  it("tools/i18n-gaps.mjs finds nothing untranslated in it", () => {
    const left = gaps.rows.filter((r) => FNS.has(r.fn) || r.lines.some((l) => l >= from && l <= to))
      .map((r) => `${r.lines.join(",")} ${r.fn}: ${r.text.slice(0, 90)}`);
    expect(left).toEqual([]);
  });

  const LITERALS = [
    "Разбить на разделы", "Оформление описания", "Жирный", "Так увидит покупатель", "Как в магазине", "Закрыть",
    "Так описание выглядит на странице товара", "Пусто — на странице товара будет стандартный текст магазина.",
    "Сейчас в поле", "После разбивки", "Пока вы не нажмёте «Применить», текст в поле не меняется.", "Применить", "Отмена",
    "Вернуть как было", "Вернули как было", "Описание на весь экран — так, как его покажет страница товара",
  ];
  const tables = new Function(`${decl("ED_SPLIT_WHO")}\nreturn ED_SPLIT_WHO;`)() as Record<string, string[]>;
  const tip = /var ED_SPLIT_TIP = "([^"]+)";/.exec(APP)![1];
  for (const lang of ["ET", "EN"]) {
    it(`every label, tooltip and notice of the block in ${lang}`, () => {
      const all = [...LITERALS, tip, ...Object.values(tables).flat()];
      for (const s of all) expect(tr(s, lang), `«${s}» in ${lang}`).not.toMatch(CYRILLIC);
    });
  }

  it("the toolbar reads B / Heading / • List, each tooltip naming the mark it writes", () => {
    const bar = new Function(`${slice("edFmtBarHTML")}\nreturn edFmtBarHTML();`)() as string;
    expect(tr("Ж", "EN")).toBe("B");
    expect(tr("Ж", "ET")).toBe("B");
    // «Заголовок» alone is a banner's «Title»: the bar's button is looked up as a section's heading
    expect(bar).toContain('data-edfmt="head" data-trkey="Заголовок раздела"');
    expect(tr("Заголовок раздела", "EN")).toBe("Heading");
    expect(tr("• Список", "EN")).toBe("• List");
    const titles = [...bar.matchAll(/title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toHaveLength(3);
    const en = titles.map((t) => tr(t, "EN"));
    expect(en[0]).toBe("Bold: **text**");
    expect(en[1]).toMatch(/^Heading: .*“:”/);
    expect(en[2]).toMatch(/^List point: “— ” at the start of a line$/);
    for (const t of titles) expect(tr(t, "ET"), t).not.toMatch(CYRILLIC);
    // the Russian tooltips carry the same marks
    expect(titles[0]).toContain("**");
    expect(titles[1]).toContain("«:»");
    expect(titles[2]).toContain("«— »");
  });

  it("the heading refusal names the real limit, as one whole sentence", () => {
    const words = new Function(`${descFormatBlock(APP)}\nreturn DESC_HEAD_WORDS;`)() as number;
    expect(slice("edFmtHead")).toContain(`"Заголовок — короткая строка, до ${words} слов. Выделите слова для него и нажмите ещё раз."`);
  });
});

/* ---------- 2. «Так увидит покупатель» ---------- */

describe("«Так увидит покупатель» — the owner's words, as the page draws them", () => {
  const prev = new Function(`${descFormatBlock(APP)}\n${slice("edDescPrevHTML")}\nreturn edDescPrevHTML;`)() as (t: string) => string;
  it("headings, points and bold drawn by descHtml(), inside [data-notr]", () => {
    const html = prev("Аромат:\n— пункт\nОчень **мягкий** текст.");
    expect(html.startsWith("<div data-notr>")).toBe(true);
    expect(html).toContain('<p class="desc-h"><strong>Аромат:</strong></p>');
    expect(html).toContain("<li>пункт</li>");
    expect(html).toContain("<strong>мягкий</strong>");
  });
  it("still escapes everything; an empty box says what the page will show instead", () => {
    expect(prev("<img src=x onerror=alert(1)>")).not.toContain("<img");
    const empty = prev("   ");
    expect(empty).not.toContain("data-notr");
    expect(empty).toContain("Пусто — на странице товара будет стандартный текст магазина.");
  });
  it("is always on the card (no toggle), follows every keystroke and «Как в магазине» opens it full screen", () => {
    const body = slice("edDescBody");
    expect(body).toContain("'<div class=\"acc__rich adm-descprev__v\" data-eddescprev>' + edDescPrevHTML(");
    expect(body).not.toMatch(/data-eddescprev[^>]*hidden/);
    expect(body).toContain('data-edfmt="preview" aria-haspopup="dialog"');
    expect(slice("edLangStatePaint")).toContain("edDescPrevPaint();");
    expect(slice("edDescPrevPaint")).toMatch(/pv\.innerHTML = edDescPrevHTML\(v\); translateTree\(pv\);/);
    expect(slice("edDescShopHTML")).toContain('role="dialog" aria-modal="true"');
    expect(slice("edDescShopHTML")).toContain('<details class="acc" open><summary data-notr>');
  });
  it("beside the box once the page has room, under it on a phone — tokens only", () => {
    expect(CSS).toContain("@container admpage (min-width: 700px) { .adm-descgrid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
    expect(CSS).toContain(".adm-descgrid { display: grid; grid-template-columns: minmax(0, 1fr);");
    const own = CSS.slice(CSS.indexOf(".adm-descgrid {"), CSS.indexOf(".adm-descshop__page {"));
    expect(own.length).toBeGreaterThan(500);
    expect(own, "a colour that is not one of the panel's tokens").not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

/* ---------- 3. «Разбить на разделы»: propose, apply, undo ---------- */

type El = { value: string };
type Split = { id: string; L: string; from?: string; to?: string; prev?: string; now?: string; done?: boolean } | null;
function rig(adminEdit = "p1", tab = "ru") {
  const boxes: Record<string, El> = { "[data-eddescru]": { value: "" }, "[data-eddescet]": { value: "" }, "[data-eddescen]": { value: "" } };
  const calls: string[] = [];
  const S: { goodsDescLang: string; adminEdit: string; goodsDescSplit: Split } = { goodsDescLang: tab, adminEdit, goodsDescSplit: null };
  const api = new Function(
    "S", "document", "toast", "admFill", "edLangStatePaint", "edDescSplitPaint", "goodsNewPaint", "edAsTextNow", "edLangShow",
    `${descFormatBlock(APP)}
     ${decl("DESC_HOOKS")}
     ${decl("ED_SPLIT_WHO")}
     ${slice("edDescPrevHTML")}
     ${slice("edDescSplitHTML")}
     ${slice("edDescSplitApply")}
     ${slice("edDescSplitUndo")}
     ${slice("edDescSplitCheck")}
     return { html: edDescSplitHTML, apply: edDescSplitApply, undo: edDescSplitUndo, check: edDescSplitCheck };`,
  )(
    S, { querySelector: (sel: string) => boxes[sel] ?? null },
    (m: string) => calls.push(`toast:${m}`),
    (el: El, v: string) => { el.value = v; },
    () => calls.push("statePaint"), () => calls.push("splitPaint"), () => calls.push("newPaint"),
    (f: string, t: string) => calls.push(`save:${f}:${t}`),
    (seo: boolean, L: string) => { calls.push(`tab:${L}`); S.goodsDescLang = L; },
  ) as { html: (id: string) => string; apply: () => void; undo: () => void; check: () => void };
  return { S, boxes, calls, api };
}
const OLD = "Масло для бороды. Преимущества: мягкость, блеск.";
const NEW = "Масло для бороды.\n\nПреимущества:\n— мягкость\n— блеск";

describe("«Разбить на разделы» — a proposal first, applied only when asked", () => {
  it("the AI's answer becomes a proposal; the box is not touched", () => {
    const h = handler("admdescsplit");
    expect(h).toContain("S.goodsDescSplit = { id: spFor, L: sL, from: sText, to: r.body.text.trim() };");
    expect(h).toContain("edDescSplitPaint();");
    expect(h).not.toContain("admFill(sEl");
    expect(h).not.toContain("edAsTextNow(");
  });

  it("names the language, draws now / after as the page will, and offers «Применить» / «Отмена»", () => {
    const { S, api } = rig();
    S.goodsDescSplit = { id: "p1", L: "ET", from: OLD, to: NEW };
    const html = api.html("p1");
    expect(html).toContain("Предложение для эстонского текста");
    expect(html).toContain("Сейчас в поле");
    expect(html).toContain("После разбивки");
    expect(html).toContain('<p class="desc-h"><strong>Преимущества:</strong></p>');
    expect(html).toContain('data-edfmt="splitok">Применить<');
    expect(html).toContain('data-edfmt="splitno">Отмена<');
    expect(api.html("p2"), "another product's card shows nothing").toBe("");
  });

  it("«Применить» fills that language's box and saves it; «Вернуть как было» puts the old text back and saves that", () => {
    const { S, boxes, calls, api } = rig();
    boxes["[data-eddescru]"].value = OLD + "\n";
    S.goodsDescSplit = { id: "p1", L: "RU", from: OLD, to: NEW };
    api.apply();
    expect(boxes["[data-eddescru]"].value).toBe(NEW);
    expect(S.goodsDescSplit).toMatchObject({ id: "p1", L: "RU", prev: OLD + "\n", now: NEW, done: true });
    expect(calls).toContain("save:desc:");
    expect(calls.some((c) => c.startsWith("tab:")), "the tab was already Russian").toBe(false);
    const done = api.html("p1");
    expect(done).toContain("Русский текст разбит на разделы");
    expect(done).toContain('data-edfmt="splitundo">Вернуть как было<');

    api.undo();
    expect(boxes["[data-eddescru]"].value).toBe(OLD + "\n");
    expect(S.goodsDescSplit).toBeNull();
    expect(calls).toContain("save:desc:Вернули как было");
  });

  it("a proposal made on another tab goes into ITS box, and that tab comes on screen", () => {
    const { S, boxes, calls, api } = rig("p1", "ru");
    boxes["[data-eddescru]"].value = "русский текст";
    boxes["[data-eddescen]"].value = OLD;
    S.goodsDescSplit = { id: "p1", L: "EN", from: OLD, to: NEW };
    api.apply();
    expect(boxes["[data-eddescen]"].value).toBe(NEW);
    expect(boxes["[data-eddescru]"].value).toBe("русский текст");
    expect(calls).toContain("tab:en");
  });

  it("a box changed since the proposal is not overwritten — the proposal goes, a toast says why", () => {
    const { S, boxes, calls, api } = rig();
    boxes["[data-eddescru]"].value = OLD + " И ещё строка.";
    S.goodsDescSplit = { id: "p1", L: "RU", from: OLD, to: NEW };
    api.apply();
    expect(boxes["[data-eddescru]"].value).toBe(OLD + " И ещё строка.");
    expect(S.goodsDescSplit).toBeNull();
    expect(calls).toContain("toast:Текст поменялся после разбивки — нажмите «Разбить на разделы» ещё раз");
    expect(calls.some((c) => c.startsWith("save:"))).toBe(false);
  });

  it("typing after «Применить» takes «Вернуть как было» away — it would throw the new words out", () => {
    const { S, boxes, api } = rig();
    boxes["[data-eddescru]"].value = OLD;
    S.goodsDescSplit = { id: "p1", L: "RU", from: OLD, to: NEW };
    api.apply();
    api.check();
    expect(S.goodsDescSplit, "the saved copy comes back trimmed — still the same text").not.toBeNull();
    boxes["[data-eddescru]"].value = NEW + "\n— запах";
    api.check();
    expect(S.goodsDescSplit).toBeNull();
    expect(slice("edLangStatePaint")).toContain("edDescSplitCheck();");
  });

  it("«Новый товар» keeps it in its draft, nothing is sent", () => {
    const { S, boxes, calls, api } = rig("new");
    boxes["[data-eddescru]"].value = OLD;
    S.goodsDescSplit = { id: "new", L: "RU", from: OLD, to: NEW };
    api.apply();
    api.undo();
    expect(calls.filter((c) => c === "newPaint")).toHaveLength(2);
    expect(calls).toContain("toast:Вернули как было");
    expect(calls.some((c) => c.startsWith("save:"))).toBe(false);
  });

  it("the notices are announced politely — role=\"status\" stays the toasts' alone", () => {
    const body = slice("edDescBody");
    expect(body).toMatch(/data-eddescsplit="' \+ esc\(id\) \+ '" aria-live="polite"/);
    expect(body + slice("edDescSplitHTML")).not.toContain('role="status"');
  });

  it("the tooltip and the (?) say what it does before it is pressed", () => {
    expect(slice("edDescBody")).toContain('data-admdescsplit="\' + esc(id) + \'" title="\' + ED_SPLIT_TIP + \'"');
    expect(APP).toMatch(/var ED_SPLIT_TIP = "Разложит текст открытого языка по разделам с заголовками и пунктами списка, не меняя слов\./);
    expect(slice("edSecDesc")).toContain("«Разбить на разделы» раскладывает текст открытого языка по разделам");
  });
});

/* ---------- 4. the tab «Описание» opens on ---------- */

describe("the card opens «Описание» on the panel's language when that text is there", () => {
  const start = (lang: string, descOv: Record<string, string> | undefined) =>
    (new Function("S", "admEditProduct", `${slice("edDescLangStart")}\nreturn edDescLangStart;`)(
      { lang }, (id: string) => (id === "x" ? { id, descOv } : null),
    ) as (id: string) => string)("x");
  it("EN / ET panel with that text: its tab", () => {
    expect(start("EN", { RU: "Текст", EN: "Text" })).toBe("en");
    expect(start("ET", { RU: "Текст", ET: "Tekst" })).toBe("et");
  });
  it("EN / ET panel without it, and the Russian panel always: Russian, as before", () => {
    expect(start("EN", { RU: "Текст", ET: "Tekst" })).toBe("ru");
    expect(start("ET", { EN: "   " })).toBe("ru");
    expect(start("RU", { EN: "Text", ET: "Tekst" })).toBe("ru");
    expect(start("EN", undefined)).toBe("ru");
  });
  it("is what opening a product uses", () => {
    expect(handler("admgoods")).toContain("S.goodsDescLang = edDescLangStart(d.admgoods);");
  });
});
