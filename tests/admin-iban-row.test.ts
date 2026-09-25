/**
 * «Обзор» → «Заполните IBAN — счета не уходят» opens «Настройки → О компании».
 *
 * The row appears when a company is waiting for an invoice and the shop has no
 * IBAN — the one missing setting that silently stops a letter. It carried
 * `data-admtab="settings"`, and there is no section called that: the key of
 * «Настройки» is `setup` (ADM_SECTION_OF). The tap set S.adminTab to a key
 * screenAdmin() does not know, which falls back to «Обзор» — so the row that
 * tells the owner where to go redrew the screen he was already on
 * (admin-functions map, defect 1, 24.09.2026).
 *
 * The row's attributes are read off admOverviewHTML() and fed to the
 * `data-admtab` branch of the click handler, both cut out of app.js by source
 * text — the handler is one long function, so the branch is sliced by its
 * opening line and brace matching.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** `<head> { … }` cut out of app.js by brace matching, `head` included. */
function block(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after «${head}» in app.js`);
}

/** The attributes the «Заполните IBAN» row is drawn with, as a dataset. */
function ibanRowDataset(): Record<string, string> {
  const overview = block("function admOverviewHTML(");
  const at = overview.indexOf('"Заполните IBAN — счета не уходят"');
  expect(at, "the IBAN row is gone from «Обзор»").toBeGreaterThan(0);
  const attrs = /'(data-adm[^']*)'/.exec(overview.slice(at));
  expect(attrs, "the IBAN row has no data-* attributes").not.toBeNull();
  const d: Record<string, string> = {};
  for (const m of attrs![1].matchAll(/data-([a-z]+)="([^"]*)"/g)) d[m[1]] = m[2];
  return d;
}

/** Runs the click handler's `data-admtab` branch over `d`, the way a tap does. */
function tap(d: Record<string, string>) {
  const S: Record<string, unknown> = {
    adminTab: "over", adminOrder: 0, adminEdit: "", adminBlogEdit: null, adminBlogConfirmDelete: false,
    admMore: false, admSetPage: "", mailOpen: false, admCustOpen: "",
  };
  const body = `
    ${block("var ADM_SECTION_OF = {")};
    // 1a: Back and the nav send what a field still owes first (admAutosaveFlush) — nothing is owed here
    function admAutosaveFlush() {}
    ${block("function admLeaveAsks(")}
    ${block("function admGoTab(")}
    (function () { ${block("if (d.admtab) {")} })();
    return ADM_SECTION_OF;
  `;
  const sections = new Function("S", "d", "window", "render", body)(
    S, d, { scrollTo() {} }, () => {},
  ) as Record<string, string>;
  return { S, sections };
}

describe("«Заполните IBAN» on «Обзор»", () => {
  it("names a section the panel has", () => {
    const d = ibanRowDataset();
    const { sections } = tap(d);
    expect(sections[d.admtab], `data-admtab="${d.admtab}" is no section — the tap falls back to «Обзор»`).toBe("setup");
  });

  it("opens «Настройки» on «О компании», where the IBAN is typed", () => {
    const { S } = tap(ibanRowDataset());
    expect(S.adminTab).toBe("setup");
    expect(S.admSetPage, "«Настройки» opened on its index, not on «О компании»").toBe("company");
  });

  it("still opens every other section on its front door", () => {
    const { S } = tap({ admtab: "setup" });
    expect(S.adminTab).toBe("setup");
    expect(S.admSetPage).toBe("");
  });
});
