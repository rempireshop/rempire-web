/**
 * The panel has ONE confirm slot, and two things write to it.
 *
 * `pendingAction` in public/shop2/app.js is both the assistant's proposal and
 * the overlay card every money-touching flow raises — «Оформить продажу?»,
 * «Вернуть деньги», «Одобрить Pro», «Удалить набор». screenAdmin() lifts that
 * very object onto the scrim, and `data-admapply` applies whatever is in the
 * variable when it is pressed.
 *
 * So an assistant answer that landed while such an overlay was up overwrote
 * it — and askAdminAI() repaints only the answer box (admPaintAnswer), never
 * the overlay. The sale's own words stayed on the screen with its «Применить»
 * button under them, and that button applied the assistant's action instead.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so askAdminAI() is sliced
 * out of app.js by source text and run against stubs — the idiom of
 * tests/admin-toship.test.ts and tests/checkout-parity.test.ts. Retyping it
 * would test this file instead of the panel, and the slice fails loudly the
 * day app.js renames it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
function sliceFn(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

type Answer = { reply?: string; action?: unknown; tab?: string; retry?: boolean; ask?: string };
type Out = {
  pending: Record<string, unknown> | null;
  ans: { reply: string; action: Record<string, unknown> | null; retry: boolean } | undefined;
  bundlesLoaded: number;
};

/** askAdminAI() with the panel around it stubbed: what is in the confirm slot
 *  when the answer lands, and what the answer box was given. */
function ask(onScreen: unknown, answer: Answer): Promise<Out> {
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  const body = `
    var pendingAction = ON_SCREEN;
    var S = { adminAsk: "подними скидку для салонов", lang: "RU", adminAtt: [] };
    var admConvo = [];
    // r21: the question whose request is in the air — askAdminAI() reads it to
    // ignore the same question twice (see tests/assistant-probe.test.ts)
    var admAskFlight = "";
    var AI_UNREADABLE = "Не получилось разобрать ответ помощника — спросите ещё раз, можно короче.";
    var AI_SILENT = "Помощник не ответил — попробуйте ещё раз через минуту.";
    var bundlesLoaded = 0;
    function replyLooksLikeJson() { return false; }
    function admPaintAnswer() {}
    function loadAdminBundles() { bundlesLoaded += 1; }
    function heroForAI() { return []; }
    function contentForAI() { return {}; }
    function analyticsForAI() { return null; }
    function attachmentsForAI() { return []; }
    function fetch() {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(ANSWER); } });
    }
    ${sliceFn("askAdminAI")}
    askAdminAI(S.adminAsk);
    return new Promise(function (done) {
      setTimeout(function () {
        done({ pending: pendingAction, ans: S.adminAns, bundlesLoaded: bundlesLoaded });
      }, 0);
    });
  `;
  const run = new Function("ON_SCREEN", "ANSWER", body) as (o: unknown, a: Answer) => Promise<Out>;
  return run(onScreen, answer);
}

const SALE = { type: "pos_sale", overlay: true, title: "Оформить продажу?", detail: "Наличными · 48,00 €" };
const PRICE = { type: "set_price", id: "kevin-muprhy-plumping-wash", value: 9 };

describe("the assistant's answer and the confirm card on the scrim", () => {
  it("does not re-point an overlay the owner is looking at", async () => {
    const out = await ask({ ...SALE }, { reply: "Ставлю скидку 25 % — подтвердите.", action: PRICE, tab: "people" });
    expect(out.pending, "«Применить» on «Оформить продажу?» would have applied the assistant's action").toEqual(SALE);
    // …and the proposal is not offered under a card that belongs to something else
    expect(out.ans!.action).toBeNull();
    // the owner still gets a way back to it without retyping the question
    expect(out.ans!.retry).toBe(true);
    expect(out.ans!.reply).toBe("Ставлю скидку 25 % — подтвердите.");
  });

  it("takes the slot as it always did when nothing is on the scrim", async () => {
    const out = await ask(null, { reply: "Ставлю цену 9 € — подтвердите.", action: PRICE, tab: "goods" });
    expect(out.pending).toEqual(PRICE);
    expect(out.ans!.action).toBe(out.pending);
  });

  /* An earlier answer's own inline card is not an overlay: it lives inside
     the answer box and is redrawn by the same paint. A new answer replaces
     it, exactly as before. */
  it("replaces an earlier proposal of its own", async () => {
    const out = await ask({ ...PRICE }, { reply: "Теперь цена 12 €.", action: { ...PRICE, value: 12 } });
    expect(out.pending).toEqual({ ...PRICE, value: 12 });
    expect(out.ans!.retry).toBe(false);
  });

  it("still dresses «Удалить набор» as the destructive card, and fetches the set's name", async () => {
    const out = await ask(null, { reply: "Удаляю набор.", action: { type: "delete_bundle", id: "beard-start" } });
    expect(out.pending).toMatchObject({ type: "delete_bundle", danger: true, ok: "Да, удалить" });
    expect(out.bundlesLoaded).toBe(1);
  });
});
