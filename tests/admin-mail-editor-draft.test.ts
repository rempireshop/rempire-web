/**
 * The letter editor: what is on the screen is what is tested, kept and
 * thrown away.
 *
 * «Маркетинг → Письма» edits the subject, intro and signature of fifteen
 * letters on ONE draft (S.mailDraft, all letters × three languages). The map
 * of the panel, 23.09.2026, #14, found three ways that draft and the screen
 * came apart:
 *   · «Отправить мне тест» mailed the SAVED text — the request carried the
 *     template and the language, never the words in the fields above it;
 *   · «← Все письма» (and Back, and the nav) left unsaved words behind in the
 *     draft, unseen, to go out with the next «Сохранить» of another letter;
 *   · «Отменить правки» dropped the whole draft — every letter's edits at
 *     once, not the one on the screen.
 * Now the test sends the open letter's words, and discarding is scoped to
 * the open letter. Since 1a (25.09.2026) a letter saves itself (Dim, q6), so
 * the way out no longer asks: what the letter still owes goes first
 * (admAutosaveFlush), and a text the letter refused — an unfinished «{…}» —
 * is dropped with a toast that says so, never in silence.
 *
 * The handlers are sliced out of public/shop2/app.js and run over stubs; the
 * route's half is tests/mail-test-draft.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced brackets around ${what} in app.js`);
}
const fromBrace = (start: number, what: string) => block(src.indexOf("{", start), what);
const fn = (name: string) => {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  return src.slice(at, src.indexOf("{", at)) + fromBrace(at, name);
};
const maybe = (name: string) => (src.includes(`function ${name}(`) ? fn(name) : "");
const arr = (name: string) => {
  const at = src.indexOf(`var ${name} = [`);
  return `var ${name} = ${block(src.indexOf("[", at), name)};`;
};
const objv = (name: string) => {
  const at = src.indexOf(`var ${name} = {`);
  return `var ${name} = ${fromBrace(at, name)};`;
};
const branch = (head: string) => {
  const at = src.indexOf(head);
  if (at < 0) return "";
  return src.slice(at, src.indexOf("{", at)) + fromBrace(at, head);
};

type Env = {
  S: Record<string, any>;
  flushed: () => number;
  toasts: string[];
  press: (d: Record<string, string>) => void;
  back: () => boolean;
  type: (field: string, value: string, tpl?: string, lang?: string) => void;
  sent: Array<Record<string, any>>;
  draft: () => Record<string, any>;
};

/** What the server already has: «Заказ принят» with its own subject. */
const SAVED = { "order-confirmed": { ru: { subject: "Ваш заказ {order} принят" } } };

function editor(loaded = true): Env {
  const S: Record<string, any> = {
    screen: "admin", adminTab: "mail", mailOpen: true, mailTpl: "order-confirmed", mailLang: "RU",
    mailDraft: null, mailTo: "dim@example.com", mailConfirmBack: false,
    adminEdit: "", adminOrder: 0, admCustOpen: "", admSetPage: "", adminBlogEdit: null, admMore: false,
    scanOpen: false, stockMovesOpen: false, newsEdit: null,
  };
  const sent: Array<Record<string, any>> = [];
  const toasts: string[] = [];
  let flushes = 0;
  const fetchStub = (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
  };
  const made = new Function(
    "S", "fetch", "document", "window", "SAVED", "LOADED", "TOASTS", "FLUSH",
    `var MAIL_TEXTS = LOADED ? { texts: SAVED, defaults: {}, limits: {}, samples: { "order-confirmed": { name: "Renat", order: "R-100042", total: "95 €", track: "", code: "", product: "", shop: "Rempire", percent: "" } } } : null;
     var ADM_AS = {}, ADM_FOLD = {};
     var MAIL_TO_RX = /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i;
     var ADM_TRAIL = [], ADM_SEEN = "", pendingAction = null, GAL = { id: "" }, AI_UNDO = null;
     ${arr("ADM_MAIL_ROWS")}
     ${arr("MAIL_LANGS")}
     ${arr("MAIL_FIELDS")}
     ${objv("MAIL_LIMITS")}
     ${objv("ADM_SECTION_OF")}
     function render() {}
     function refocus() {}
     function toast(m) { TOASTS.push(m); }
     function admPanesSave() {}
     // 1a: Back and the nav send what a field still owes first — counted here
     function admAutosaveFlush() { FLUSH(); }
     function admAutosaveSpec() {}
     function admFoldToggle() {}
     // …and the product card closing: its fields forget, «Новый товар» keeps its draft
     function edAsForget() {}
     function goodsNewSave() {}
     function mailSendToast() {}
     function vidReset() {}
     function goodsEditDirty() { return false; }
     function blogReadForm() {}
     function blogDirty() { return false; }
     function newsDirty() { return false; }
     function newsCloseEditor() {}
     function closeScannerState() {}
     function goodsBackToRow() {}
     function admAsstSheet() { return false; }
     ${fn("keepMailTo")}
     ${fn("mailTpl")}
     ${fn("mailLang")}
     ${fn("mailLangCode")}
     ${fn("mailLimit")}
     ${fn("mailSaved")}
     ${fn("mailDraft")}
     ${fn("mailDefault")}
     ${fn("objKeys")}
     ${fn("setMailDraftField")}
     ${fn("mailSig")}
     ${maybe("mailOne")}
     ${fn("mailDirty")}
     ${arr("MAIL_PH")}
     ${fn("mailTokensOf")}
     ${fn("mailTextProblem")}
     ${fn("mailFieldAs")}
     ${fn("mailDropRefused")}
     var MAIL_PH_UNFINISHED = "u", MAIL_PH_UNKNOWN = "k";
     ${maybe("mailRevertOne")}
     ${maybe("mailCloseEditor")}
     ${fn("admSection")}
     ${fn("admTrailSync")}
     ${fn("admTrailBack")}
     ${fn("admLayers")}
     ${fn("admCloseTop")}
     ${maybe("admLeaveAsks")}
     ${maybe("admLeaveGo")}
     ${maybe("admGoTab")}
     return {
       press: function (d) {
         var t = { disabled: false };
         ${branch("if (d.admtab) {")}
         ${branch("if (d.mailtpl !== undefined)")}
         ${branch("if (d.mailback !== undefined || d.mailbackyes !== undefined)")}
         ${branch("if (d.mailbackno !== undefined)")}
         ${branch("if (d.mailtest !== undefined)")}
         ${branch("if (d.mailrevert !== undefined)")}
       },
       back: admCloseTop,
       type: setMailDraftField,
       draft: mailDraft,
       sync: admTrailSync
     };`,
  )(S, fetchStub, { querySelector: () => null }, { scrollTo() {} }, SAVED, loaded, toasts, () => { flushes += 1; }) as {
    press: (d: Record<string, string>) => void; back: () => boolean; draft: () => Record<string, any>;
    type: (tpl: string, lang: string, field: string, v: string) => void; sync: () => void;
  };
  made.sync();
  return {
    S, sent, toasts,
    flushed: () => flushes,
    press: made.press,
    back: made.back,
    draft: made.draft,
    type: (field, value, tpl = "order-confirmed", lang = "RU") => made.type(tpl, lang, field, value),
  };
}

describe("«Отправить мне тест» sends the letter on the screen", () => {
  it("carries the unsaved subject of the open letter in its language", () => {
    const e = editor();
    e.type("subject", "Спасибо, {name}! Заказ {order} у нас");
    e.press({ mailtest: "" });
    expect(e.sent).toHaveLength(1);
    expect(e.sent[0].template).toBe("order-confirmed");
    expect(e.sent[0].texts, "the test mailed the saved text, not the one on the screen")
      .toEqual({ subject: "Спасибо, {name}! Заказ {order} у нас" });
  });

  it("…and a letter typed back to the standard text sends {} — the standard text", () => {
    const e = editor();
    e.type("subject", "");
    e.press({ mailtest: "" });
    expect(e.sent[0].texts).toEqual({});
  });
});

describe("«← Все письма» closes at once — the letter saves itself (1a)", () => {
  it("closes without a question, and what was typed goes to the server first — it is not thrown away", () => {
    const e = editor();
    e.type("subject", "Новая тема");
    const before = e.flushed();
    e.press({ mailback: "" });
    expect(e.S.mailOpen).toBe(false);
    expect(e.S.mailConfirmBack, "the old question came back").toBeFalsy();
    expect(e.flushed(), "the owed save did not go before the letter closed").toBeGreaterThan(before);
    // the words stay in the draft the autosave sends — nothing reverts behind the owner's back
    expect(e.draft()["order-confirmed"].ru.subject).toBe("Новая тема");
    expect(e.toasts).toEqual([]);
  });

  it("a text the letter refused — an unfinished «{…}» — goes, and the toast says so (q6)", () => {
    const e = editor();
    e.type("subject", "Заказ {ord");
    e.press({ mailback: "" });
    expect(e.S.mailOpen).toBe(false);
    expect(e.draft()["order-confirmed"], "a half-typed «{…}» stayed in the draft").toEqual(SAVED["order-confirmed"]);
    expect(e.toasts).toEqual(["Не сохранено: в тексте была незаконченная вставка «{…}»"]);
  });

  it("a letter with nothing unsaved closes at once", () => {
    const e = editor();
    e.press({ mailback: "" });
    expect(e.S.mailOpen).toBe(false);
    expect(e.S.mailConfirmBack).toBe(false);
  });

  /* The editor draws three grey bars until the texts land; leaving it then
     must not make a draft out of the empty «saved» — the owner's own texts
     would read as edits once they arrive, and «Сохранить» would write the
     defaults over them. */
  it("leaving before the texts have landed makes no draft of nothing", () => {
    const e = editor(false);
    e.press({ mailback: "" });
    expect(e.S.mailOpen).toBe(false);
    expect(e.S.mailDraft, "an empty draft was made before the texts came").toBeNull();
    const b = editor(false);
    b.back();
    expect(b.S.mailDraft).toBeNull();
  });

  it("the phone's Back closes it with one press, the words kept for the save", () => {
    const e = editor();
    e.type("intro", "Абзац");
    expect(e.back()).toBe(true);
    expect(e.S.mailOpen).toBe(false);
    expect(e.draft()["order-confirmed"].ru.intro).toBe("Абзац");
  });

  it("the tab strip above it goes where it was tapped, at once", () => {
    const e = editor();
    e.type("subject", "Новая тема");
    e.press({ admtab: "promos" });
    expect(e.S.adminTab).toBe("promos");
    expect(e.S.mailOpen).toBe(false);
    expect(e.draft()["order-confirmed"].ru.subject).toBe("Новая тема");
  });
});

describe("«Отменить правки» is about the open letter", () => {
  it("puts this letter back and leaves another letter's edits alone", () => {
    const e = editor();
    e.type("subject", "Отправлен, ура", "order-shipped");   // another letter, typed earlier
    e.type("subject", "Новая тема");                         // the open one
    e.press({ mailrevert: "" });
    expect(e.draft()["order-confirmed"], "this letter was not put back").toEqual(SAVED["order-confirmed"]);
    expect(e.draft()["order-shipped"], "«Отменить правки» threw another letter's edits away")
      .toEqual({ ru: { subject: "Отправлен, ура" } });
  });
});
