/**
 * «Клиенты»: a list or a card that did not load says so — with «Повторить».
 *
 * Every other screen of the panel answers a failed read with the same block:
 * `.adm-error`, one line, and «Повторить» (`data-admreload=<key>`), so the
 * owner never has to reload the page. «Клиенты» was the one left out. The list
 * printed a grey note and then, under it, «Никого не нашлось» — a failed read
 * shown as a shop with no customers — and the customer card printed a note
 * with no way to ask again but going back and opening it anew (admin-functions
 * map, defect 7, 24.09.2026).
 *
 * The drawing functions and the click handler's `data-admreload` branch are
 * cut out of app.js by source text and run over stubs.
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
const slice = (name: string) => block(`function ${name}(`);

type Calls = Array<[string, ...unknown[]]>;

function panel(S: Record<string, unknown>) {
  const calls: Calls = [];
  const log = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const body = `
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function partnersOn() { return false; }
    function admCustLeadHTML() { return "<p>lead</p>"; }
    function admPartnerFormHTML() { return ""; }
    function fakeCustomers() { return []; }
    function admOrdersLabel(n) { return n + " заказов"; }
    function eur(n) { return n + " €"; }
    function admCustTag() { return ["quiet", "Клиент"]; }
    function admTagHTML(kind, text) { return '<span class="adm-tag">' + text + "</span>"; }
    var ADM_ROW_OPEN = "";
    var ADM_CUST_TIERS = [["", "Все"], ["news", "Подписаны"]];
    function admPageBackCls() { return ""; }   // the phone top bar is not drawn here
    ${slice("admBackHTML")}
    ${slice("admCustInTier")}
    ${slice("admCustMatch")}
    ${slice("filteredAdminCustomers")}
    ${slice("admCustRowHTML")}
    ${slice("admCustRowsHTML")}
    ${slice("admCustChipsHTML")}
    ${slice("admCustomerCardHTML")}
    ${slice("admCustomersHTML")}
    function reload(d) { ${block("if (d.admreload) {")} }
    return { list: admCustomersHTML, rows: admCustRowsHTML, reload: reload };
  `;
  const names = [
    "S", "SRV", "render", "loadAdminCustomers", "loadAdminCustomerDetail",
    "loadOverview", "loadSrvOrders", "loadOrderSearch", "loadOrderOne", "reloadStock", "reloadStockMoves",
    "loadAdminBundles", "loadAdminPromos", "loadAdminGiftCards", "loadAdminBlog", "loadAdminReviews",
    "loadAnalytics", "statsRange", "ANALYTICS", "AUDIT", "loadAudit", "loadAdminPricing",
  ];
  const fns = new Function(...names, body)(
    S, { admin: true }, log("render"), log("loadAdminCustomers"), log("loadAdminCustomerDetail"),
    log("loadOverview"), log("loadSrvOrders"), log("loadOrderSearch"), log("loadOrderOne"), log("reloadStock"), log("reloadStockMoves"),
    log("loadAdminBundles"), log("loadAdminPromos"), log("loadAdminGiftCards"), log("loadAdminBlog"), log("loadAdminReviews"),
    log("loadAnalytics"), () => "30d", {}, {}, log("loadAudit"), log("loadAdminPricing"),
  ) as { list: () => string; rows: () => string; reload: (d: Record<string, string>) => void };
  return { ...fns, calls };
}

const failedList = () => ({
  admCustomers: [] as unknown[], admCustErr: "Список клиентов не загрузился.", admCustOpen: "",
  admCustTier: "", admCustQ: "", partnerForm: null,
});

describe("«Все клиенты» that did not load", () => {
  it("offers «Повторить», the way every other screen of the panel does", () => {
    const html = panel(failedList()).list();
    expect(html).toContain('<div class="adm-error"><span>Список клиентов не загрузился.</span>');
    expect(html, "no «Повторить» under the error").toContain('data-admreload="customers">Повторить</button>');
  });

  it("does not say «Никого не нашлось» under the error", () => {
    const html = panel(failedList()).list();
    expect(html, "a failed read drawn as a shop with no customers").not.toContain("Никого не нашлось");
    // …nor as «Все 0» on the chips (1a: every chip carries a count)
    expect(html, "the chips counted a list that never came").not.toContain("adm-chip__n");
  });

  it("still says «Никого не нашлось» when the list loaded and nobody matches", () => {
    const S = { ...failedList(), admCustErr: "", admCustomers: [{ id: "c1", email: "a@example.com", name: "Anna", ordersCount: 1, revenue: 10 }], admCustQ: "zzz" };
    expect(panel(S).rows()).toContain("Никого не нашлось");
  });

  it("«Повторить» asks again, with the grey bars while it does", () => {
    const S: Record<string, unknown> = failedList();
    const p = panel(S);
    p.reload({ admreload: "customers" });
    expect(p.calls).toContainEqual(["loadAdminCustomers", true]);
    expect(S.admCustErr, "the old error stays up over the new attempt").toBe("");
    expect(S.admCustomers, "the failed read's empty list stays instead of the grey bars").toBeNull();
    expect(p.calls.at(-1)).toEqual(["render"]);
  });
});

describe("A customer card that did not load", () => {
  const failedCard = () => ({
    ...failedList(), admCustErr: "", admCustOpen: "c7", admCustDetail: null, admCustDetailErr: "Карточка клиента не загрузилась.",
  });

  it("offers «Повторить» under the way back", () => {
    const html = panel(failedCard()).list();
    // «← Клиенты» since 1a (screen 15)
    expect(html).toContain("<span>Клиенты</span>");
    expect(html).toContain('<div class="adm-error"><span>Карточка клиента не загрузилась.</span>');
    expect(html, "no «Повторить» on the card").toContain('data-admreload="customer">Повторить</button>');
  });

  it("«Повторить» asks for the same card again, forced past the remembered error", () => {
    const p = panel(failedCard());
    p.reload({ admreload: "customer" });
    expect(p.calls).toContainEqual(["loadAdminCustomerDetail", "c7", true]);
  });
});
