/**
 * «Рассылка»: the send button in the panel's language when the letter takes
 * more than a day (map-defects #21, 24.09.2026).
 *
 * With a plan longer than one day the button read «Отправить 40 подписчикам
 * · 3 дня» — ONE text node. translateTree() rewrites whole nodes, and the
 * only rule for the button is anchored at «…подписчикам$», while «· 3 дня»
 * has rules of its own that never saw a node starting with «·». So on an ET
 * or EN panel the button stayed Russian exactly when the daily limit was in
 * play. The two halves are two nodes now.
 *
 * The «Отправка» card is cut out of public/shop2/app.js and run over stubs;
 * its text nodes go through the panel's own translator, because
 * tools/i18n-gaps.mjs cannot see a label assembled at run time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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

function decl(name: string): string {
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = src.indexOf(`var ${name} = ${open}`);
    if (start < 0) continue;
    let depth = 0;
    for (let i = src.indexOf(open, start); i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close && --depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

const CYR = /[А-Яа-яЁё]/;
// This repository's own source only.
const trText = new Function(`
  ${decl("UI")}
  ${decl("UI_RX")}
  ${slice("trName")}
  ${decl("TAIL_EXACT")}
  ${decl("NAME_TAILS")}
  ${decl("NAME_FRAGS")}
  ${slice("trText")}
  return trText;
`)() as (s: string, lang: string, allowName: boolean) => string;

/** The draft's «Отправка» card for `total` subscribers and a plan of `days`. */
function card(total: number, days: number): string {
  // This repository's own source plus fixed stub text; the numbers are arguments.
  const body = `
    var S = { newsSend: null, newsBusy: false, newsBudget: null, newsAudience: { total: TOTAL, RU: TOTAL, ET: 0, EN: 0 }, newsPlan: { days: DAYS } };
    ${slice("esc")}
    function newsCountsHTML() { return ""; }
    function newsFallbackHTML() { return ""; }
    ${slice("newsBudgetLineHTML")}
    ${slice("plainDays")}
    ${slice("newsPlanWord")}
    ${slice("newsSendLabel")}
    ${src.includes("function newsSendHTML(") ? slice("newsSendHTML") : ""}
    var ADM_UNDO_WORD = "Вернуть";
    ${slice("admPinnedHTML")}
    ${slice("admNewsSendCardHTML")}
    return admNewsSendCardHTML({ id: "n1", status: "draft", title: "Осень", subject: { RU: "Осень" } });
  `;
  return new Function("TOTAL", "DAYS", body)(total, days) as string;
}

/** The send button's text nodes, as translateTree() leaves them in `lang`. */
function button(html: string, lang: "RU" | "ET" | "EN"): string[] {
  // 1a: the send is the editor's one dark button (admPinnedHTML)
  const m = /<button [^>]*data-newssend[^>]*>([\s\S]*?)<\/button>/.exec(html);
  if (!m) throw new Error("no send button on the card");
  const nodes = m[1].split(/<[^>]*>/).map((t) => t.trim()).filter(Boolean);
  return lang === "RU" ? nodes : nodes.map((t) => (CYR.test(t) ? trText(t, lang, false) : t));
}

describe("«Отправить N подписчикам · 3 дня» in the panel's language", () => {
  it("RU: reads as before — the label, then the plan", () => {
    expect(button(card(40, 3), "RU").join(" ")).toBe("Отправить 40 подписчикам · 3 дня");
    expect(button(card(40, 5), "RU").join(" ")).toBe("Отправить 40 подписчикам · 5 дней");
  });

  it("EN: every piece translated", () => {
    expect(button(card(40, 3), "EN")).toEqual(["Send to 40 subscribers", "· 3 days"]);
    expect(button(card(40, 5), "EN")).toEqual(["Send to 40 subscribers", "· 5 days"]);
  });

  it("ET: every piece translated", () => {
    expect(button(card(40, 3), "ET")).toEqual(["Saada 40 tellijale", "· 3 päeva"]);
  });

  it("a one-day plan is the plain label, as before", () => {
    const html = card(40, 1);
    expect(button(html, "RU")).toEqual(["Отправить 40 подписчикам"]);
    expect(button(html, "EN")).toEqual(["Send to 40 subscribers"]);
  });
});
