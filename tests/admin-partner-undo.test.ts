/**
 * «+ Партнёр» for an address that is already a partner: no «Отменить» that
 * cannot undo anything.
 *
 * applyAddPartner() journals every confirmed «+ Партнёр» and hands the entry
 * to the toast. The entry's way back is the tier switch to retail — but only
 * when the POST actually promoted somebody (`promoted`); for an address that
 * was a partner already there is nothing to put back, and demoApply() says so
 * with `prev: null`. The toast offered «Отменить» all the same, and pressing
 * it did nothing (demoUndo() returns on an entry with no `prev`), then said
 * «Отменено» and wrote «Отмена: Новый партнёр: …» into the journal
 * (admin-functions map, defect 12, 24.09.2026).
 *
 * The real toast(), admUndoToast(), journalNote(), demoApply() and
 * applyAddPartner() are cut out of app.js by source text and run over stubs.
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

/* How long an undoable toast stays — ADM_UNDO_MS, the one place it is set
   (direction 1a; Dim, 25.09.2026: six seconds). */
const UNDO_DECL = (/^  var ADM_UNDO_MS = .*;$/m.exec(src) || [""])[0].trim();
const UNDO_MS = Number(/= (\d+);/.exec(UNDO_DECL)?.[1]);

const flush = () => new Promise((r) => setTimeout(r, 0));

type Entry = { txt: string; prev: unknown };

function panel(answer: Record<string, unknown>) {
  const S: Record<string, unknown> = { lang: "RU", toast: null, toastUndo: null, partnerBusy: false, partnerErr: "", partnerForm: {} };
  const DEMO = { log: [] as Entry[] };
  const shown: string[] = [];
  const timers: number[] = [];
  const undone: unknown[] = [];
  const body = `
    function actionText(a) { return a.type === "add_partner" ? "Новый партнёр: " + (a.email || a.id) : a.type; }
    function byId() { return null; }
    function demoSave() {}
    function applyDemoOverrides() {}
    function srvPush() {}
    function paintToast() { if (S.toast) onShown(S.toast + (S.toastUndo ? " [Отменить]" : "")); }
    function patchHeader() {}
    function patchNav() {}
    function refocus() {}
    function demoUndo(i) { var e = DEMO.log[i]; if (!e || !e.prev) return; onUndo(e.prev); DEMO.log.splice(i, 1); }
    ${UNDO_DECL}
    ${slice("toast")}
    ${slice("admCancelLine")}
    ${slice("journalNote")}
    ${slice("admUndoToast")}
    ${slice("demoApply")}
    ${slice("applyAddPartner")}
    return { add: applyAddPartner, undo: admUndoToast };
  `;
  const fns = new Function(
    "S", "DEMO", "SRV", "PARTNER_ERRS", "apiSend", "render", "onShown", "onUndo", "setTimeout", "clearTimeout", body,
  )(
    S, DEMO, { admin: true }, { error: "Не получилось добавить — попробуйте ещё раз" },
    () => Promise.resolve({ status: 200, body: answer }), () => {},
    (t: string) => shown.push(t), (p: unknown) => undone.push(p),
    (_f: () => void, ms: number) => { timers.push(ms); return 0; }, () => {},
  ) as { add: (a: unknown) => void; undo: () => void };
  return { S, DEMO, shown, timers, undone, ...fns };
}

const ADD = { type: "add_partner", email: "salon@example.com", company: "", phone: "", overlay: true };

describe("«+ Партнёр» on an address that is a partner already", () => {
  const already = { ok: true, customer: { id: "c1", email: "salon@example.com", tier: "pro" }, created: false, promoted: false, mail: {} };

  it("says so, with no «Отменить» — there is nothing to take back", async () => {
    const p = panel(already);
    p.add(ADD);
    await flush();
    expect(p.shown.at(-1)).toBe("Уже партнёр · salon@example.com");
    expect(p.S.toastUndo, "the toast offers an undo that cannot undo anything").toBeNull();
    // …and it goes in the usual 2.6 s, not the 6 s an offer gets
    expect(p.timers.at(-1)).toBe(2600);
  });

  it("never says «Отменено» nor journals an «Отмена» for it", async () => {
    const p = panel(already);
    p.add(ADD);
    await flush();
    p.undo();
    expect(p.shown, "«Отменено» after an undo that did nothing").not.toContain("Отменено");
    expect(p.DEMO.log.map((e) => e.txt).filter((t) => t.startsWith("Отмена: ")), "a journal line for an undo that never happened").toEqual([]);
    expect(p.undone).toEqual([]);
  });
});

describe("«+ Партнёр» that really promoted somebody", () => {
  const promoted = { ok: true, customer: { id: "c2", email: "new@example.com", tier: "pro" }, created: true, promoted: true, mail: { sent: true } };

  it("keeps its «Отменить», and it switches the tier back", async () => {
    const p = panel(promoted);
    p.add({ ...ADD, email: "new@example.com" });
    await flush();
    expect(p.shown.at(-1)).toBe("Партнёр добавлен · письмо ушло [Отменить]");
    expect(UNDO_MS).toBe(6000);
    expect(p.timers.at(-1)).toBe(UNDO_MS);
    p.undo();
    expect(p.undone).toEqual([{ type: "set_tier", id: "c2", email: "new@example.com", value: "retail", prev: "pro" }]);
    expect(p.shown.at(-1)).toBe("Отменено");
    expect(p.DEMO.log[0].txt).toBe("Отмена: Новый партнёр: new@example.com");
  });
});
