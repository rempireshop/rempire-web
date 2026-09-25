/**
 * The shop's details save field by field, reset page by page — and
 * «Вернуть» puts back only what its change touched.
 *
 * The shop's own details are ONE document (DEMO.content → settings.content)
 * shown on two settings pages: the black strip above the header on «Главная
 * страница», everything else — company, IBAN, hours, socials, the «Контакты»
 * paragraph, the e-mail footer — on «О компании».
 *
 *   · «Вернуть стандартный текст полоски» / «Вернуть стандартные данные»
 *     (map of the panel, 23.09.2026, #15): each resets its own page's part —
 *     the strip's reset used to put back the default company name, an empty
 *     IBAN, the default phone and socials, and wipe the e-mail footer.
 *   · Since 1a (25.09.2026) every box saves itself — ONE field per save
 *     (admContentCommit), so what is typed on the other page is never carried
 *     along, and stays typed.
 *   · «Вернуть» on a change of the strip used to restore the WHOLE document
 *     as it was before it (`prev.whole`), so every later «О компании» edit —
 *     the phone typed after the strip — went back with it. The journal line
 *     keeps only what the change's own fields held now (contentPrevPatch).
 *
 * The real functions are sliced out of public/shop2/app.js and run over a
 * stub of the rest.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** From `start` to the bracket that closes the first `{` or `[` after it. */
function block(start: number, what: string, open = "{"): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = src.indexOf(open, start); i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced brackets around ${what} in app.js`);
}
const fn = (name: string) => block(src.indexOf(`function ${name}(`), `function ${name}()`);
const decl = (name: string) => {
  const at = src.indexOf(`var ${name} =`);
  const eq = src.indexOf("=", at);
  const open = /\s*\[/.test(src.slice(eq + 1, eq + 4)) ? "[" : "{";
  return block(at, `var ${name}`, open) + ";";
};
const branch = (head: string) => block(src.indexOf(head), head);
/** The set_content arm of demoApply() — the one that writes entry.prev. */
function applyArm(): string {
  const at = src.indexOf('entry.prev = { type: "set_content"');
  const head = 'else if (a.type === "set_content")';
  const start = src.lastIndexOf(head, at);
  return block(start + "else ".length, "demoApply's set_content arm");
}
/** …and demoUndo()'s, which puts a line's `prev` back. */
function undoArm(): string {
  const at = src.indexOf("DEMO.content = a.whole || null");
  const head = 'else if (a.type === "set_content")';
  const start = src.lastIndexOf(head, at);
  return block(start + "else ".length, "demoUndo's set_content arm");
}

type Panel = {
  S: Record<string, any>;
  DEMO: Record<string, any>;
  press: (d: Record<string, string>) => void;
  apply: (a: Record<string, any>) => any;
  undo: (prev: Record<string, any>) => void;
  commit: (paths: string[]) => void;
  draftSet: (path: string, v: unknown) => void;
  applied: any[];
  toasts: string[];
};

function panel(page: string): Panel {
  const S: Record<string, any> = { admSetPage: page, lang: "RU" };
  const toasts: string[] = [];
  const applied: any[] = [];
  /* What the shop really has stored: real company details, a real IBAN,
     a footer, a custom strip — nothing like the built-in defaults. */
  const DEMO: Record<string, any> = {
    content: {
      company: { legalName: "Renat OÜ", regCode: "99999999", vatNumber: "EE999", address: "Tallinn 1",
        email: "renat@example.com", phone: "+372 5000 0000", iban: "EE382200221020145685", bankName: "Swedbank" },
      hours: { mon: "10:00–18:00", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "closed", note: { RU: "", ET: "", EN: "" } },
      social: { instagram: "https://www.instagram.com/renat/", tiktok: "", facebook: "", youtube: "" },
      announcement: { on: true, text: { RU: "Скидки всю неделю", ET: "", EN: "" }, short: { RU: "", ET: "", EN: "" }, link: "" },
      contactPage: { RU: "Звоните", ET: "", EN: "" },
      emailFooter: { RU: "Спасибо, что вы с нами", ET: "", EN: "" },
      legal: {},
    },
  };
  const made = new Function(
    "S", "DEMO", "toast", "render", "refocus", "applied",
    `var entry = {};
     ${decl("CONTENT_DEFAULT")}
     ${decl("CONTENT_DAYS")}
     ${decl("CONTENT_SOCIALS")}
     ${fn("triCopy")}
     ${fn("contentLoaded")}
     ${fn("contentConf")}
     ${fn("contentDraft")}
     ${fn("cPathGet")}
     ${fn("cPathSet")}
     ${fn("cDraftGet")}
     ${fn("cDraftSet")}
     ${fn("cHoursNorm")}
     ${fn("cTriDiff")}
     ${fn("contentDiff")}
     ${fn("contentApply")}
     ${fn("contentPart")}
     ${fn("contentKeepOther")}
     ${fn("contentOnPage")}
     ${fn("contentPrevPatch")}
     ${fn("admContentCommit")}
     function apply(a) { entry = {}; ${applyArm()} return entry; }
     /* the page's own door: the journal line and the local state (demoApply's arm) */
     function admSetApply(a, text) { applied.push(a); toast(text); return apply(a); }
     return {
       press: function (d) {
         ${branch("if (d.contentreset !== undefined)")}
       },
       apply: apply,
       undo: function (a) { ${undoArm()} },
       commit: function (paths) { admContentCommit(paths); },
       draftSet: cDraftSet
     };`,
  )(S, DEMO, (s: string) => { toasts.push(s); }, () => {}, () => {}, applied) as Omit<Panel, "S" | "DEMO" | "toasts" | "applied">;
  return { S, DEMO, toasts, applied, ...made };
}

describe("«Вернуть стандартный текст полоски» on «Главная страница» resets the strip only", () => {
  it("saves the announcement and nothing else", () => {
    const p = panel("home");
    p.press({ contentreset: "home" });
    expect(p.applied, "the reset did not save").toHaveLength(1);
    expect(Object.keys(p.applied[0].value), "the reset reaches past the strip").toEqual(["announcement"]);
  });

  it("…and leaves the company, the IBAN, the hours, the socials and the footer as they were", () => {
    const p = panel("home");
    p.press({ contentreset: "home" });
    expect(p.DEMO.content.company.iban).toBe("EE382200221020145685");
    expect(p.DEMO.content.company.legalName).toBe("Renat OÜ");
    expect(p.DEMO.content.hours.mon).toBe("10:00–18:00");
    expect(p.DEMO.content.social.instagram).toBe("https://www.instagram.com/renat/");
    expect(p.DEMO.content.emailFooter.RU).toBe("Спасибо, что вы с нами");
    expect(p.DEMO.content.announcement.text.RU, "the strip itself was not reset").toMatch(/Бесплатная доставка/);
  });

  it("on «О компании» it resets that page's details and leaves the strip alone", () => {
    const p = panel("company");
    p.press({ contentreset: "company" });
    const keys = Object.keys(p.applied[0].value);
    expect(keys).not.toContain("announcement");
    expect(keys).toContain("company");
    expect(p.DEMO.content.announcement.text.RU).toBe("Скидки всю неделю");
  });

  it("nothing to reset — nothing saved, and it says so", () => {
    const p = panel("home");
    p.press({ contentreset: "home" });
    p.press({ contentreset: "home" });
    expect(p.applied).toHaveLength(1);
    expect(p.toasts.at(-1)).toBe("Уже стандартные значения");
  });
});

describe("a box saves its own field — and only its own", () => {
  it("the strip's text saves without the phone half-typed on «О компании», which stays typed", () => {
    const p = panel("home");
    p.draftSet("company.phone", "+372 5111 1111");      // typed on «О компании», box not left yet
    p.draftSet("announcement.text.RU", "Новая полоска");  // the strip's box, left
    p.commit(["announcement.text.RU"]);
    expect(p.applied).toHaveLength(1);
    expect(p.applied[0].value, "the strip's save carried more than the strip").toEqual({ announcement: { text: { RU: "Новая полоска" } } });
    expect(p.DEMO.content.announcement.text.RU).toBe("Новая полоска");
    expect(p.DEMO.content.company.phone, "the phone was saved from the other box").toBe("+372 5000 0000");
    expect(p.S.contentDraft.company.phone, "the typing on «О компании» was thrown away").toBe("+372 5111 1111");
  });

  it("a box left unchanged saves nothing", () => {
    const p = panel("company");
    p.commit(["company.phone"]);
    expect(p.applied).toHaveLength(0);
  });

  it("an assistant's set_content (no `keep`) still replaces the draft as before", () => {
    const p = panel("company");
    p.draftSet("company.phone", "+372 5111 1111");
    p.apply({ type: "set_content", value: { company: { phone: "+372 5222 2222" } } });
    expect(p.DEMO.content.company.phone).toBe("+372 5222 2222");
    expect(p.S.contentDraft).toBeNull();
  });
});

describe("«Вернуть» puts back only what its change touched (the whole-document bug)", () => {
  it("undoing the strip leaves the phone saved after it", () => {
    const p = panel("home");
    // «Главная страница»: the strip's text, saved — the line it writes
    const strip = p.apply({ type: "set_content", value: { announcement: { text: { RU: "Новая полоска" } } }, keep: true });
    // …then «О компании»: a new phone, saved
    p.draftSet("company.phone", "+372 5333 3333");
    p.commit(["company.phone"]);
    expect(p.DEMO.content.company.phone).toBe("+372 5333 3333");
    // «Вернуть» on the strip's line
    p.undo(strip.prev);
    expect(p.DEMO.content.announcement.text.RU, "the strip did not come back").toBe("Скидки всю неделю");
    expect(p.DEMO.content.company.phone, "undoing the strip took the later phone with it").toBe("+372 5333 3333");
  });

  it("the line keeps what the fields held, not the document", () => {
    const p = panel("company");
    const entry = p.apply({ type: "set_content", value: { company: { phone: "+372 5444 4444" } }, keep: true });
    expect(entry.prev).toEqual({ type: "set_content", value: { company: { phone: "+372 5000 0000" } } });
  });

  it("a line written before 25.09.2026 (the whole document) still goes back as it was", () => {
    const p = panel("company");
    const was = JSON.parse(JSON.stringify(p.DEMO.content));
    p.apply({ type: "set_content", value: { company: { phone: "+372 5444 4444" } } });
    p.undo({ type: "set_content", whole: was });
    expect(p.DEMO.content.company.phone).toBe("+372 5000 0000");
  });
});
