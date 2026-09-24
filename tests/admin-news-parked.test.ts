/**
 * «Рассылка» stopped at the daily limit — what the panel says about the rest.
 *
 * Dim, 24.09.2026, on /test «mail-daily-limit»:
 *
 *   «Will the newsletters send themselves automatically, when I get this
 *   message? When I added more letters again with 100 and 30, then I had to
 *   click "send" .. also I was notified anywhere that I need to send the
 *   letter again.. so I'm not sure.»
 *
 * The rest DID go by itself — the morning job (/api/cron/flows) sends every
 * letter left half-sent — but the letter's card said «Отправка прервалась —
 * нажмите «Продолжить», и письмо уйдёт остальным», which is an instruction to
 * press a button. The card now says «Отправлено N из M — остальные уйдут
 * автоматически завтра», and offers «Продолжить» only on a day that still has
 * room, as a way not to wait (after raising the limit, say).
 *
 * The card is cut out of public/shop2/app.js and run over stubs; the two
 * assembled lines go through the panel's own translator, because i18n-gaps
 * cannot see a sentence built at run time.
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

type Budget = { known?: boolean; blocked?: boolean; marketingRoom: number; cap: number; sent: { total: number } } | null;

/** The «Отправка» card for a letter left half-sent, with this day's budget. */
function card(budget: Budget, extra: Record<string, unknown> = {}): string {
  // This repository's own source plus fixed stub text — no outside input.
  const body = `
    var S = { newsSend: null, newsAudience: null, newsBudget: BUDGET };
    ${slice("esc")}
    ${slice("newsProgressHTML")}
    ${slice("newsBudgetLineHTML")}
    ${slice("newsWaitLine")}
    ${slice("newsRoomNow")}
    ${slice("admNewsSendCardHTML")}
    return admNewsSendCardHTML(D);
  `;
  const d = { id: "n1", status: "sending", sentCount: 2, failedCount: 0, audienceCount: 5, ...extra };
  return new Function("BUDGET", "D", body)(budget, d) as string;
}

const SPENT: Budget = { known: true, blocked: false, marketingRoom: 0, cap: 4, sent: { total: 4 } };
const ROOM: Budget = { known: true, blocked: false, marketingRoom: 68, cap: 100, sent: { total: 2 } };

describe("a letter stopped at the limit", () => {
  it("says how far it got and that the rest goes by itself tomorrow", () => {
    const html = card(SPENT);
    expect(html).toContain("Отправлено 2 из 5 — остальные уйдут автоматически завтра.");
    expect(html, "the card still tells the owner to press a button").not.toContain("Отправка прервалась");
  });

  it("offers no «Продолжить» on a day with no room left — there is nothing to press", () => {
    const html = card(SPENT);
    expect(html).not.toContain("data-newsresume");
    // …and says why, in the budget line's own words
    expect(html).toContain("продолжится завтра сама");
  });

  it("offers «Продолжить» as a way not to wait once the day has room again (the limit raised)", () => {
    const html = card(ROOM);
    expect(html).toContain("Отправлено 2 из 5 — остальные уйдут автоматически завтра.");
    expect(html).toContain("Можно не ждать — «Продолжить» отправит остальным сейчас.");
    expect(html).toContain("data-newsresume");
  });

  it("with the budget not read yet the button stays — the server decides", () => {
    expect(card(null)).toContain("data-newsresume");
  });

  it("the toast and the journal line when it parks say the same", () => {
    const step = slice("newsSendStep");
    expect(step).toContain('"Рассылка: отправлено " + (st.sent + st.failed) + " из " + st.total + " — остальные уйдут автоматически завтра"');
  });
});

describe("the assembled lines survive the translator", () => {
  const BODY = `
    ${decl("UI")}
    ${decl("UI_RX")}
    ${slice("trName")}
    ${decl("TAIL_EXACT")}
    ${decl("NAME_TAILS")}
    ${decl("NAME_FRAGS")}
    ${slice("trText")}
    return trText(S, LANG, false);
  `;
  const tr = new Function("S", "LANG", BODY) as (s: string, lang: string) => string;

  for (const lang of ["ET", "EN"]) {
    it(`the card's line and the toast in ${lang}`, () => {
      for (const s of [
        "Отправлено 2 из 5 — остальные уйдут автоматически завтра.",
        "Рассылка: отправлено 2 из 5 — остальные уйдут автоматически завтра",
        "Можно не ждать — «Продолжить» отправит остальным сейчас.",
      ]) {
        const got = tr(s, lang);
        expect(got, `«${s}» stayed Russian in ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
      }
      expect(tr("Отправлено 2 из 5 — остальные уйдут автоматически завтра.", lang)).toMatch(/2.*5/);
    });
  }
});
