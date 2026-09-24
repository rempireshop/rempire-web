/**
 * «Сохранить» and «Сбросить к стандартному» touch only the page they are on.
 *
 * The shop's own details are ONE document (DEMO.content → settings.content),
 * edited on ONE shared draft, but shown on two settings pages since the
 * settings redesign: the black strip above the header on «Главная страница»,
 * everything else — company, IBAN, hours, socials, the «Контакты» paragraph,
 * the e-mail footer — on «О компании». Each page's save bar already names only
 * its own card (contentDirtyFor) and «Отменить правки» already reverts only
 * its own part (contentRevert). The two buttons that WRITE did not (map of the
 * panel, 23.09.2026, #15):
 *   · «Главная страница» → «Верхняя полоска» → «Сбросить к стандартному»
 *     diffed the whole document against CONTENT_DEFAULT — so resetting the
 *     strip also put back the default company name, an empty IBAN, the
 *     default phone and socials, and wiped the e-mail footer;
 *   · one «Сохранить» on either page saved whatever the other page's form
 *     held too, and then threw the shared draft away.
 * Now both are scoped to the page, and a save or reset on one page leaves
 * what is still being typed on the other exactly where it was.
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

type Panel = {
  S: Record<string, any>;
  DEMO: Record<string, any>;
  press: (d: Record<string, string>) => void;
  apply: (a: Record<string, any>) => void;
  pending: () => any;
  toasts: string[];
};

function panel(page: string): Panel {
  const S: Record<string, any> = { admSetPage: page, lang: "RU" };
  const toasts: string[] = [];
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
    "S", "DEMO", "toast", "render", "refocus", "contentConfirmDetail",
    `var pendingAction = null, entry = {};
     ${decl("CONTENT_DEFAULT")}
     ${decl("CONTENT_DAYS")}
     ${decl("CONTENT_SOCIALS")}
     ${fn("triCopy")}
     ${fn("contentLoaded")}
     ${fn("contentConf")}
     ${fn("contentDraft")}
     ${fn("cHoursNorm")}
     ${fn("cTriDiff")}
     ${fn("contentDiff")}
     ${fn("contentDirtyFor")}
     ${fn("contentApply")}
     ${src.includes("function contentPart(") ? fn("contentPart") : ""}
     ${src.includes("function contentKeepOther(") ? fn("contentKeepOther") : ""}
     ${src.includes("function contentOnPage(") ? fn("contentOnPage") : ""}
     return {
       press: function (d) {
         ${branch("if (d.contentsave !== undefined)")}
         ${branch("if (d.contentreset !== undefined)")}
       },
       apply: function (a) { ${applyArm()} },
       pending: function () { return pendingAction; }
     };`,
  )(S, DEMO, (s: string) => { toasts.push(s); }, () => {}, () => {}, () => "") as Omit<Panel, "S" | "DEMO" | "toasts">;
  return { S, DEMO, toasts, ...made };
}

describe("«Сбросить к стандартному» on «Главная страница» resets the strip only", () => {
  it("asks about the announcement and nothing else", () => {
    const p = panel("home");
    p.press({ contentreset: "" });
    const act = p.pending();
    expect(act, "no confirm card").toBeTruthy();
    expect(Object.keys(act.value), "the reset reaches past the strip").toEqual(["announcement"]);
  });

  it("…and applying it leaves the company, the IBAN, the hours, the socials and the footer as they were", () => {
    const p = panel("home");
    p.press({ contentreset: "" });
    p.apply(p.pending());
    expect(p.DEMO.content.company.iban).toBe("EE382200221020145685");
    expect(p.DEMO.content.company.legalName).toBe("Renat OÜ");
    expect(p.DEMO.content.hours.mon).toBe("10:00–18:00");
    expect(p.DEMO.content.social.instagram).toBe("https://www.instagram.com/renat/");
    expect(p.DEMO.content.emailFooter.RU).toBe("Спасибо, что вы с нами");
    expect(p.DEMO.content.announcement.text.RU, "the strip itself was not reset").toMatch(/Бесплатная доставка/);
  });

  it("on «О компании» it resets that page's details and leaves the strip alone", () => {
    const p = panel("company");
    p.press({ contentreset: "" });
    const keys = Object.keys(p.pending().value);
    expect(keys).not.toContain("announcement");
    expect(keys).toContain("company");
  });
});

describe("«Сохранить» on one page saves that page's edits only", () => {
  it("a save on «Главная страница» does not carry the details half-typed on «О компании»", () => {
    const p = panel("company");
    // «О компании»: a new phone, typed and not saved
    p.S.contentDraft = null;
    const draft = (p as any).S;
    p.press({ contentsave: "" });          // nothing changed yet
    expect(p.pending()).toBeNull();

    const d = JSON.parse(JSON.stringify(p.DEMO.content));
    d.company.phone = "+372 5111 1111";   // typed on «О компании»
    d.announcement.text.RU = "Новая полоска"; // typed on «Главная страница»
    draft.contentDraft = d;
    draft.admSetPage = "home";
    p.press({ contentsave: "" });
    const act = p.pending();
    expect(Object.keys(act.value), "the strip's save carried the phone").toEqual(["announcement"]);

    p.apply(act);
    expect(p.DEMO.content.announcement.text.RU).toBe("Новая полоска");
    expect(p.DEMO.content.company.phone, "the phone was saved from the other page").toBe("+372 5000 0000");
    // …and it is still typed where it was: the other page's draft survived the save
    expect(p.S.contentDraft && p.S.contentDraft.company.phone, "the typing on «О компании» was thrown away")
      .toBe("+372 5111 1111");
  });

  it("a save on «О компании» leaves a strip being typed on «Главная страница» unsaved and kept", () => {
    const p = panel("company");
    const d = JSON.parse(JSON.stringify(p.DEMO.content));
    d.company.phone = "+372 5111 1111";
    d.announcement.text.RU = "Новая полоска";
    p.S.contentDraft = d;
    p.press({ contentsave: "" });
    const act = p.pending();
    expect(Object.keys(act.value)).toEqual(["company"]);
    p.apply(act);
    expect(p.DEMO.content.company.phone).toBe("+372 5111 1111");
    expect(p.DEMO.content.announcement.text.RU).toBe("Скидки всю неделю");
    expect(p.S.contentDraft && p.S.contentDraft.announcement.text.RU).toBe("Новая полоска");
  });

  it("an assistant's set_content (no page) still replaces the draft as before", () => {
    const p = panel("company");
    const d = JSON.parse(JSON.stringify(p.DEMO.content));
    d.company.phone = "+372 5111 1111";
    p.S.contentDraft = d;
    p.apply({ type: "set_content", value: { company: { phone: "+372 5222 2222" } } });
    expect(p.DEMO.content.company.phone).toBe("+372 5222 2222");
    expect(p.S.contentDraft).toBeNull();
  });
});
