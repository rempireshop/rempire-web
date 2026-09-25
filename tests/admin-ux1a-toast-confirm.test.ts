/**
 * Direction 1a, README rules 3 and 4 — the toast's «Вернуть» and the one
 * confirm sheet.
 *
 * The toast: the word and the time are ADM_UNDO_WORD / ADM_UNDO_MS, one
 * place each (Dim, 25.09.2026, q2: «Вернуть», 6 s). The mechanism under the
 * button is the journal's, unchanged — admUndoToast → demoUndo — and ✕ and
 * `role="status"` stay.
 *
 * The confirm sheet: every existing confirm (pendingAction.overlay) now draws
 * as the design's sheet — the question, the consequence, the verb on the LEFT
 * (rust for what cannot be walked back, ink otherwise) and an outlined
 * «Не надо» on the right — with every data-* hook it had.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");

function fn(name: string): string {
  const head = app.indexOf(`function ${name}(`);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has function ${name}`);
  let depth = 0;
  for (let i = app.indexOf("{", head); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(head, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}
function decl(name: string): string {
  const m = new RegExp(`^  var ${name} = .*;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name} on one line`);
  return m[0].trim();
}
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("the toast's undo — one word, one time, one place", () => {
  const undo = new Function(`${decl("ADM_UNDO_WORD")}; ${decl("ADM_UNDO_MS")}; return { word: ADM_UNDO_WORD, ms: ADM_UNDO_MS };`)();

  it("«Вернуть», six seconds (Dim, 25.09.2026)", () => {
    expect(undo).toEqual({ word: "Вернуть", ms: 6000 });
  });

  function paint(toastUndo: unknown) {
    const slot = { innerHTML: "" };
    const S = { screen: "admin", toast: "R-100042 отправлен · письмо ушло", toastUndo };
    new Function("S", "toastSlot", "esc", "translateTree", "document",
      `var toastPainted = ""; ${decl("ADM_UNDO_WORD")}; ${fn("paintToast")}; paintToast();`,
    )(S, slot, esc, () => {}, { body: { classList: { toggle() {} } } });
    return slot.innerHTML;
  }

  it("the button says ADM_UNDO_WORD and keeps its hook; ✕ and role=status stay", () => {
    const html = paint({ txt: "x", prev: 1 });
    expect(html).toContain('<button class="adm-toast__undo" data-admtoastundo>Вернуть</button>');
    expect(html).toContain('data-closetoast aria-label="Закрыть">✕</button>');
    expect(html).toMatch(/^<div class="adm-toast" role="status">/);
    expect(html, "the old word is back").not.toContain("Отменить");
  });

  it("no undo, no button — and still the ✕", () => {
    const html = paint(null);
    expect(html).not.toContain("data-admtoastundo");
    expect(html).toContain("data-closetoast");
  });

  it("an undoable toast stays ADM_UNDO_MS, any other 2.6 s", () => {
    const timers: number[] = [];
    const S: Record<string, unknown> = {};
    const toast = new Function("S", "setTimeout", "clearTimeout",
      `${decl("ADM_UNDO_MS")}; function paintToast() {} function patchHeader() {} function patchNav() {} ${fn("toast")}; return toast;`,
    )(S, (_f: () => void, ms: number) => { timers.push(ms); return 0; }, () => {}) as (m: string, u?: unknown) => void;
    toast("Сохранено ✓", { txt: "x", prev: 1 });
    toast("Готово");
    // an entry with nothing to put back is no offer (map defect 12)
    toast("Уже партнёр", { txt: "x", prev: null });
    expect(timers).toEqual([6000, 2600, 2600]);
  });
});

describe("admConfirmHTML — the one confirm sheet", () => {
  type A = Record<string, unknown>;
  const confirm = new Function("esc", "txt", "actionText", "admDetailHTML",
    `${fn("admConfirmHTML")}; return admConfirmHTML;`,
  )(esc, (s: unknown) => (s == null ? "" : String(s)), (a: A) => `action ${a.type}`, (s: string) => esc(s)) as (a: A) => string;

  const acts = (html: string) => html.slice(html.indexOf('<div class="adm-confirm__acts">'));

  it("the verb on the LEFT, «Не надо» outlined on the RIGHT, both hooks as they were", () => {
    const html = acts(confirm({ type: "order_status", title: "Отметить отправленным?", detail: "R-1", ok: "Отправлен" }));
    const apply = html.indexOf("data-admapply"), cancel = html.indexOf("data-admcancel");
    expect(apply).toBeGreaterThan(0);
    expect(cancel, "«Не надо» is not to the right of the verb").toBeGreaterThan(apply);
    expect(html).toContain('<button class="adm-btn adm-btn--ghost" data-admcancel>Не надо</button>');
    expect(html).not.toContain(">Отмена<");
  });

  it("rust for what cannot be walked back (`danger`), ink for everything else", () => {
    expect(acts(confirm({ type: "order_refund", title: "Вернуть деньги?", ok: "Вернуть деньги", danger: true })))
      .toContain('<button class="adm-btn adm-btn--warn" data-admapply>Вернуть деньги</button>');
    expect(acts(confirm({ type: "order_manual", title: "Отметить оплаченным?", ok: "Оплачен" })))
      .toContain('<button class="adm-btn" data-admapply>Оплачен</button>');
  });

  it("the title is the question and names the dialog; a modal still", () => {
    const html = confirm({ type: "delete_promo", title: "Удалить промокод SUMMER?", detail: "Покупатели больше не смогут его ввести." });
    expect(html).toMatch(/^<div class="adm-confirm" role="dialog" aria-modal="true" aria-labelledby="admconfirm-t">/);
    expect(html).toContain('<div class="adm-confirm__t" id="admconfirm-t">Удалить промокод SUMMER?</div>');
    expect(html).toContain('<div class="adm-confirm__d">Покупатели больше не смогут его ввести.</div>');
  });

  it("the refund's amount and a letter's preview are still inside it", () => {
    const html = confirm({ type: "order_refund", title: "Вернуть деньги?", amount: 18.84, preview: "Здравствуйте!", danger: true });
    expect(html).toContain('data-admrefundamt value="18.84"');
    expect(html).toContain('<div class="adm-propose__prev">Здравствуйте!</div>');
  });

  it("with nothing to say it still says something", () => {
    const html = confirm({ type: "x" });
    expect(html).toContain(">Подтвердите изменение</div>");
    expect(html).toContain(">action x</div>");
    expect(html).toContain(">Применить</button>");
  });
});

describe("the confirm sheet's look (admin.css)", () => {
  const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
  it("two equal buttons, the verb first; a bottom sheet with the inset on a phone", () => {
    expect(css).toContain(".adm-confirm__acts { display: grid; grid-template-columns: 1fr 1fr;");
    expect(css).toMatch(/@media \(max-width: 899px\) \{[\s\S]*?\.adm-confirm \{ align-items: flex-end; padding: 0; \}/);
    expect(css).toMatch(/\.adm-confirm__card \{\n\s*max-width: none; border: 0;\n\s*padding: 22px 16px calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });
});
