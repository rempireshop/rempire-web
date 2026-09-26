/**
 * Product names in the panel's own language — the Russian type tail too.
 *
 * Seen on staging with the panel in English (24.09.2026), «Обзор → Сделать
 * сегодня», the row about products running out:
 *   «Repair.Me.Wash — шампунь · Beard balm — бальзам для бороды · BHA 2%
 *    Gentle Exfoliating Toner — тоник»
 * The storefront turns «— шампунь» into «— shampoo» with trName(), but it does
 * so on a whole text node (translateTree(): the Russian tail anchored at the
 * END of the node). Four names glued into one node with « · » leave three
 * tails in the middle, where nothing ever looks — so the panel now names each
 * product through trName() itself, before the names are joined (admProdName).
 *
 * The functions are the panel's own, sliced out of app.js by source text and
 * run in a sandbox (tests/admin-order-pay-i18n.test.ts's technique); the text
 * nodes they draw are then put through the storefront's trText() the way
 * translateTree() meets a node inside NAME_CTX.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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
function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Lang = "RU" | "ET" | "EN";
const CYR = /[А-Яа-яЁё]/;

/** The storefront's translation machinery, closed over its own tables. */
const I18N = `
  var UI = ${sliceLiteral("var UI = ", "\n  };")};
  var UI_RX = ${sliceLiteral("var UI_RX = ", "\n  ];")};
  var NAME_TAILS = ${sliceLiteral("var NAME_TAILS = ", "\n  };")};
  var NAME_FRAGS = ${sliceLiteral("var NAME_FRAGS = ", "\n  ];")};
  var TAIL_EXACT = ${sliceLiteral("var TAIL_EXACT = ", "\n  };")};
  ${slice("trName")}
  ${slice("trText")}
`;
const STUBS = `
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pl(n, a, b, c) { return n === 1 ? a : n < 5 ? b : c; }
  function eur(n) { return n + " €"; }
`;

/** translateTree() on a node inside NAME_CTX: trText with allowName. */
function translated(html: string, lang: Lang): string[] {
  const nodes = html
    .split(/<[^>]*>/)
    .map((t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim())
    .filter(Boolean);
  if (lang === "RU") return nodes;
  const trText = runInNewContext(`${I18N}\ntrText`) as (s: string, l: string, allowName: boolean) => string;
  return nodes.map((t) => (CYR.test(t) ? trText(t, lang, true) : t));
}

const LOW = [
  { id: "a", brand: "Kevin.Murphy", name: "Repair.Me.Wash — шампунь", stock: "low" },
  { id: "b", brand: "Rempire", name: "Beard balm — бальзам для бороды", stock: "low" },
  { id: "c", brand: "Paula's Choice", name: "BHA 2% Gentle Exfoliating Toner — тоник", stock: "out" },
];
const HIDDEN = [{ id: "d", brand: "Davines", name: "OI Oil — масло для волос", stock: "out" }];

/** «Обзор» with three products running out and one hidden one. */
function overview(lang: Lang): string {
  const data = {
    lowStock: { items: LOW, total: LOW.length, hidden: HIDDEN.length, hiddenItems: HIDDEN },
    attention: { reviewsPending: 0, proRequests: 0, returnRequests: 0, ordersToShip: 0 },
    revenue7d: null, revenueByDay: [],
  };
  const code = `
    var S = { lang: ${JSON.stringify(lang)} };
    var SRV = { admin: true, orders: [] };
    var OVERVIEW = { data: ${JSON.stringify(data)}, err: null };
    var ANALYTICS = {};
    ${I18N}
    ${STUBS}
    function loadOverview() {}
    function admOrders() { return []; }
    function admOrderVM(o) { return o; }
    function admLiveToShip() { return []; }
    function lowStock() { return []; }
    function admWaitingCount() { return 0; }
    function admReturnsAsked() { return []; }
    function admInvoicesWaiting() { return []; }
    function companyIban() { return "EE00"; }
    function admHeldOrders() { return []; }
    function admTodayTakings() { return { sum: 0, n: 0, pos: 0 }; }
    function admShopDay() { return "2026-09-24"; }
    function admShopDayAdd(d) { return d; }
    function admHead() { return ""; }
    function admDateLine() { return ""; }
    function admOrdersLabel(n) { return String(n); }
    function admRecentRow() { return ""; }
    // 1a: the section headers, the one dark button and the first-open bars
    function admSecHeadHTML(t, k, h, extra) { return "<h2>" + t + "</h2>" + (extra || ""); }
    function admPinnedHTML(a, l) { return "<button " + a + ">" + l + "</button>"; }
    function admShipAllLabel(n) { return "Отправить " + n; }
    function admSkelHTML() { return ""; }
    function admReviewWho(r) { return r.name; }
    function admCatalogList() { return []; }
    ${slice("admLowRows")}
    ${slice("admProdName")}
    ${slice("admTaskRow")}
    ${slice("admOverviewHTML")}
    admOverviewHTML();
  `;
  return runInNewContext(code, {}) as string;
}

describe("«Обзор → Сделать сегодня»: the products running out, named in the panel's language", () => {
  it("EN: every name of the row loses its Russian tail, not only the last one", () => {
    const nodes = translated(overview("EN"), "EN");
    expect(nodes).toContain("Repair.Me.Wash — shampoo · Beard balm — balm for beard · BHA 2% Gentle Exfoliating Toner — toner");
    expect(nodes).toContain("OI Oil — oil for hair");
    expect(nodes.filter((t) => CYR.test(t))).toEqual([]);
  });

  it("ET: the same row in Estonian", () => {
    const nodes = translated(overview("ET"), "ET");
    expect(nodes).toContain("Repair.Me.Wash — šampoon · Beard balm — palsam habemele · BHA 2% Gentle Exfoliating Toner — toonik");
    expect(nodes).toContain("OI Oil — õli juustele");
    expect(nodes.filter((t) => CYR.test(t))).toEqual([]);
  });

  it("RU: the names stay exactly as the catalogue writes them", () => {
    const nodes = translated(overview("RU"), "RU");
    expect(nodes).toContain("Repair.Me.Wash — шампунь · Beard balm — бальзам для бороды · BHA 2% Gentle Exfoliating Toner — тоник");
    expect(nodes).toContain("OI Oil — масло для волос");
  });
});

describe("the other panel lists that print a product name", () => {
  const row = { productId: "a", variant: "250 мл", brand: "Kevin.Murphy", name: "Repair.Me.Wash — шампунь", tracked: true, qty: 2, state: "low", ean: "" };
  /* 1a (q24): «Склад» names a product once, in the head of its group, and
     lists its sizes under it — so the name to check is the group's. The size
     rows carry no name at all and are stubbed out. */
  function stockRow(lang: Lang): string {
    return runInNewContext(`
      var S = { lang: ${JSON.stringify(lang)}, stockEdit: "" };
      ${I18N}
      ${STUBS}
      function byIdOrNull() { return null; }
      function media() { return ""; }
      function admTagHTML(kind, text) { return "<span>" + esc(text) + "</span>"; }
      function stockRowHTML() { return ""; }
      ${slice("admProdName")}
      ${slice("stockGroupHTML")}
      var r = ${JSON.stringify(row)};
      stockGroupHTML({ id: r.productId, brand: r.brand, name: r.name, rows: [r], off: false });
    `, {}) as string;
  }
  function custOrderRow(lang: Lang): string {
    return runInNewContext(`
      var S = { lang: ${JSON.stringify(lang)} };
      ${I18N}
      ${STUBS}
      function admOrderById() { return null; }
      function admInvoiceOverdue() { return 0; }
      function shortDate() { return "22.09"; }
      function admOrderBadge() { return ""; }
      ${slice("admItemsLabel")}
      ${slice("admProdName")}
      ${slice("admCustOrderRowHTML")}
      admCustOrderRowHTML({ id: 1, number: "R-100042", createdAt: "2026-09-22", itemsCount: 3, firstItem: "Beard balm — бальзам для бороды", total: 30, status: "paid" });
    `, {}) as string;
  }

  for (const lang of ["EN", "ET"] as const) {
    it(`${lang}: «Склад» and a customer's order row carry no Russian tail`, () => {
      const nodes = [...translated(stockRow(lang), lang), ...translated(custOrderRow(lang), lang)];
      expect(nodes.join("\n")).not.toMatch(/шампунь|бальзам|для бороды/);
      expect(nodes.join("\n")).toContain(lang === "EN" ? "Repair.Me.Wash — shampoo" : "Repair.Me.Wash — šampoon");
      expect(nodes.join("\n")).toContain(lang === "EN" ? "Beard balm — balm for beard" : "Beard balm — palsam habemele");
    });
  }

  it("RU: the stock row keeps the Russian name", () => {
    const nodes = translated(stockRow("RU"), "RU");
    expect(nodes).toContain("Kevin.Murphy");
    expect(nodes).toContain("Repair.Me.Wash — шампунь");
  });
});
