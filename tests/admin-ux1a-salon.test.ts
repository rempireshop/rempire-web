/**
 * «Салон» in direction 1a (design_handoff_admin_ux README § 5, screens
 * 05-salon-*; Dim's answers of 25.09.2026, q29–q31 and the small items):
 *
 *   · ONE dark button — «К оплате · 42 €», pinned on a phone — which carries
 *     `data-possend` with the method picked above it, so a normal sale is a
 *     chip, «К оплате» and «Оформить» on the confirm sheet: three taps;
 *   · «Наличные» / «Терминал» a pick, the discount 0 / 5 / 10 / 20 % and
 *     «другая…», which opens the typed box the register always had;
 *   · «Часто продают» = the analytics top products by revenue, all channels,
 *     under the search while nothing is typed;
 *   · the receipt card in the basket's place, «Чек ↗» and «Новая продажа»;
 *   · the phone number kept beside the e-mail, «Сканировать» as on «Склад».
 *
 * The functions are cut out of public/shop2/app.js by source text and run
 * over stubs (the technique of tests/admin-ux1a-pieces.test.ts), so what is
 * tested is the shop's own code.
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
/** `var NAME = …;` up to the first `;` that ends a line — one line or several. */
function decl(name: string): string {
  const m = new RegExp(`^  var ${name} = [\\s\\S]*?;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  return m[0].trim();
}

type Line = { id: string; variant: string; qty: number };
type State = {
  posCart: Line[]; posQ: string; posEmail: string; posPhone: string; posPayment: string;
  posDiscount: string; posDiscOther: boolean; posBusy: boolean; posErr: string;
  posDone: null | { orderId: string; number: string; total: number; items: number; how: string; mailed: boolean };
  stockLevels: unknown[];
  lang?: string;
};
type Product = { id: string; brand: string; name: string; price: number; stock: string; sizes?: string[]; prices?: number[] };
type Analytics = Record<string, { data: null | { topProductsByRevenue: Array<{ id: string }> }; err: null | string; at: number }>;

const CAT: Product[] = [
  { id: "sys4", brand: "System 4", name: "Bio Botanical Shampoo — шампунь", price: 9, stock: "in", sizes: ["75 мл", "250 мл", "500 мл"], prices: [9, 16, 25] },
  { id: "touch", brand: "Kevin.Murphy", name: "Touchable — спрей", price: 27, stock: "in" },
  { id: "gone", brand: "Proraso", name: "Azur Lime — бальзам", price: 16, stock: "out" },
];

function salon(opts: { S?: Partial<State>; analytics?: Analytics; admin?: boolean } = {}) {
  const S: State = {
    posCart: [], posQ: "", posEmail: "", posPhone: "", posPayment: "cash", posDiscount: "", posDiscOther: false,
    posBusy: false, posErr: "", posDone: null, stockLevels: [], ...(opts.S || {}),
  };
  const loads: string[] = [];
  const api = new Function("S", "CATALOGUE", "ANALYTICS", "SRV", "loads", `
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function eur(n) { return String(n).replace(".", ",") + " €"; }
    function media() { return "<i class=ph></i>"; }
    function edStockFor() { return null; }
    function loadStockLevels() {}
    function stockRefreshOnEntry() {}
    function loadAnalytics(r) { loads.push(r); }
    var ADM_HELP = {}, ADM_FOLD = {};
    ${fn("byId")}
    ${fn("byIdOrNull")}
    ${fn("scanFold")}
    ${fn("scanWordHas")}
    ${decl("POS_EAN")}
    ${fn("posEanIndex")}
    ${fn("posCodeHit")}
    ${decl("ADM_ICON")}
    ${fn("admIcon")}
    ${fn("admHead")}
    ${fn("admDomId")}
    ${fn("admHelpBtnHTML")}
    ${fn("admHelpHTML")}
    ${fn("admSecHeadHTML")}
    ${fn("admPinnedHTML")}
    ${fn("admSegHTML")}
    ${fn("posVariantPrice")}
    ${fn("posSubtotal")}
    ${fn("posInCart")}
    ${fn("posChipHTML")}
    ${fn("posRowHTML")}
    ${fn("posSearchResultsHTML")}
    ${decl("POS_TOP_RANGE")}
    ${fn("posTopLoad")}
    ${fn("posTopRows")}
    ${fn("posTopHTML")}
    ${fn("posTotals")}
    ${fn("posTotalsHTML")}
    ${decl("POS_HOW")}
    ${decl("POS_GONE")}
    function trName(n, L) { return L === "EN" ? String(n).replace("— шампунь", "— shampoo").replace("— спрей", "— spray") : n; }
    ${fn("admProdName")}
    ${fn("posConfirmDetail")}
    ${fn("posPinHTML")}
    ${decl("POS_DISCS")}
    ${fn("posDiscHTML")}
    ${fn("posWayHTML")}
    ${fn("posBuyerHTML")}
    ${fn("posCartHTML")}
    ${fn("admPosDoneMeta")}
    ${fn("admPosReceiptHTML")}
    ${decl("POS_HELP")}
    ${fn("admSearchHTML")}
    ${fn("admSalonHTML")}
    return { screen: admSalonHTML, pin: posPinHTML, confirm: posConfirmDetail, top: posTopRows, totals: posTotalsHTML };
  `)(S, CAT, opts.analytics || {}, { admin: opts.admin !== false }, loads) as {
    screen: () => string; pin: () => string; confirm: (how: string) => string;
    top: () => null | Array<{ p: Product }>; totals: () => string;
  };
  return { ...api, S, loads };
}

/** Every filled (ink) button in a piece of markup — README rule 2 allows one. */
function darkButtons(html: string): string[] {
  return (html.match(/<(?:button|a) class="adm-btn[^"]*"/g) || []).filter((b) => !/adm-btn--ghost/.test(b));
}
const has = (html: string, re: RegExp) => re.test(html);
const topOf = (ids: string[]): Analytics => ({ "90d": { data: { topProductsByRevenue: ids.map((id) => ({ id })) }, err: null, at: 0 } });

describe("«Салон» 1a — one dark button, and it is «К оплате»", () => {
  it("an empty basket: the one button is dead and says «Корзина пуста»", () => {
    const s = salon();
    const html = s.screen();
    expect(darkButtons(html)).toHaveLength(1);
    expect(html).toMatch(/<button class="adm-btn adm-pin__btn" type="button" data-possend="cash" disabled>Корзина пуста<\/button>/);
  });

  it("a basket: «К оплате · total», live, carrying the method picked above it", () => {
    const s = salon({ S: { posCart: [{ id: "sys4", variant: "250 мл", qty: 2 }] } });
    let html = s.screen();
    expect(darkButtons(html)).toHaveLength(1);
    expect(html).toContain('data-possend="cash">');
    expect(html).toContain("<span>К оплате</span> · <span>32 €</span>");
    // «Терминал» picked: the same button now sends a terminal sale
    s.S.posPayment = "terminal";
    html = s.screen();
    expect(html).toContain('data-possend="terminal">');
    expect(html).not.toContain('data-possend="cash"');
    // the pick itself is a segmented control, not a send
    expect(html).toMatch(/<button data-pospay="terminal" aria-current="true">Терминал<\/button>/);
    expect(html).toMatch(/<button data-pospay="cash" aria-current="false">Наличные<\/button>/);
  });

  it("while the sale is in flight the button says «Оформляем…» and is dead", () => {
    const s = salon({ S: { posCart: [{ id: "touch", variant: "", qty: 1 }], posBusy: true } });
    expect(s.pin()).toMatch(/data-possend="cash" disabled>Оформляем…</);
  });

  it("the receipt: «Новая продажа» is the one dark button, «Чек ↗» a link", () => {
    const s = salon({ S: { posDone: { orderId: "o1", number: "R-100042", total: 42, items: 2, how: "cash", mailed: true } } });
    const html = s.screen();
    expect(darkButtons(html)).toHaveLength(1);
    expect(html).toContain('data-posnew>Новая продажа</button>');
    expect(html).toContain('href="/api/admin/pos-orders/o1/receipt/"');
    expect(html).toContain(">Чек ↗</a>");
    expect(html).toContain('<div class="adm-mono adm-receipt__id">R-100042</div>');
    expect(html).toContain("2 поз. · наличные · остатки списаны · чек ушёл на почту");
    // the search stays beside it: the next sale is one chip away
    expect(html).toContain("data-posq");
    expect(html).not.toContain("data-possend");
  });

  it("a chip (or the scanner) after the receipt is the next sale: the basket comes back", () => {
    const s = salon({ S: {
      posDone: { orderId: "o1", number: "R-1", total: 9, items: 1, how: "cash", mailed: false },
      posCart: [{ id: "touch", variant: "", qty: 1 }],
    } });
    const html = s.screen();
    expect(s.S.posDone).toBeNull();
    expect(html).not.toContain("adm-receipt");
    expect(html).toContain('data-possend="cash">');
  });
});

describe("«Салон» 1a — the confirm sheet says the money and the method first (q29)", () => {
  it("«42 € · наличные», then the lines", () => {
    const s = salon({ S: { posCart: [{ id: "sys4", variant: "500 мл", qty: 1 }, { id: "touch", variant: "", qty: 1 }], posDiscount: "10" } });
    expect(s.confirm("cash")).toBe("46,8 € · наличные\n\nBio Botanical Shampoo — шампунь 500 мл × 1\nTouchable — спрей × 1");
    expect(s.confirm("terminal").split("\n")[0]).toBe("46,8 € · терминал");
  });

  // 26.09.2026 staging: an EN panel showed «— шампунь» on this sheet while the rest of the till said «shampoo»
  it("names the products in the panel language", () => {
    const s = salon({ S: { lang: "EN", posCart: [{ id: "sys4", variant: "500 мл", qty: 1 }], posDiscount: "" } });
    expect(s.confirm("cash")).toContain("Bio Botanical Shampoo — shampoo 500 мл × 1");
    expect(s.confirm("cash")).not.toContain("шампунь");
  });
});

describe("«Салон» 1a — the discount: 0 / 5 / 10 / 20 % and «другая…» (q30)", () => {
  const seg = (html: string) => (html.match(/<button data-posdisc="([^"]+)" aria-current="true">/) || [])[1];
  const line = [{ id: "sys4", variant: "75 мл", qty: 1 }];

  it("no discount lights «0 %», and there is no typed box", () => {
    const html = salon({ S: { posCart: line } }).screen();
    expect(seg(html)).toBe("0");
    expect(html).not.toContain("data-posdiscount");
  });

  it("a chip value lights its chip", () => {
    expect(seg(salon({ S: { posCart: line, posDiscount: "10" } }).screen())).toBe("10");
    expect(seg(salon({ S: { posCart: line, posDiscount: "20" } }).screen())).toBe("20");
  });

  it("«другая…» opens the typed box — and any other value keeps it open", () => {
    let html = salon({ S: { posCart: line, posDiscOther: true } }).screen();
    expect(seg(html)).toBe("other");
    expect(html).toMatch(/data-posdiscount value=""/);
    html = salon({ S: { posCart: line, posDiscount: "15" } }).screen();
    expect(seg(html)).toBe("other");
    expect(html).toMatch(/data-posdiscount value="15"/);
  });

  it("«Итого» strikes the sum before the discount and keeps .adm-total__v for the total", () => {
    const html = salon({ S: { posCart: [{ id: "touch", variant: "", qty: 2 }], posDiscount: "10" } }).totals();
    expect(html).toContain("<s>54 €</s> −10 %");
    expect(html).toContain('<span class="adm-total__v adm-total__v--big">48,6 €</span>');
  });
});

describe("«Салон» 1a — «Часто продают» (q31)", () => {
  it("is the analytics top list, 90 days, in its order, without what the shop does not sell", () => {
    const s = salon({ analytics: topOf(["touch", "gift-card", "gone", "sys4"]) });
    expect((s.top() || []).map((r) => r.p.id)).toEqual(["touch", "sys4"]);
    const html = s.screen();
    expect(html).toContain("Часто продают");
    expect(html).toContain('data-posadd="touch:0"');
    expect(html).toContain('data-posadd="sys4:2"');
    expect(s.loads).toEqual([]);   // an answer in hand is not asked for again
  });

  it("is asked for once when there is no answer yet, with grey bars meanwhile", () => {
    const s = salon();
    const html = s.screen();
    expect(s.loads).toEqual(["90d"]);
    expect(html).toMatch(/Часто продают[\s\S]*adm-skel/);
  });

  it("no sales yet, or no answer: the steps of a sale stand there instead", () => {
    const none = salon({ analytics: topOf([]) }).screen();
    expect(none).toContain("Новая продажа</div>");
    expect(none).toContain("Дальше «К оплате»");
    const failed = salon({ analytics: { "90d": { data: null, err: "offline", at: 0 } } }).screen();
    expect(failed).toContain("Новая продажа</div>");
    expect(failed).not.toContain("adm-skel");
  });

  it("takes turns with the results: typed text hides it, an empty box hides the results", () => {
    let html = salon({ analytics: topOf(["touch"]) }).screen();
    expect(html).toContain('id="poslist" hidden>');
    expect(html).toMatch(/id="postop">/);
    html = salon({ analytics: topOf(["touch"]), S: { posQ: "bio" } }).screen();
    expect(html).toMatch(/id="poslist">/);
    expect(html).toContain('id="postop" hidden>');
    expect(html).toContain('data-posadd="sys4:0"');
  });
});

describe("«Салон» 1a — the rest of the screen", () => {
  it("is titled «Салон», with its help behind «?» and «Сканировать» outlined", () => {
    const html = salon().screen();
    expect(html).toContain('<h1 class="adm-h1 adm-h1--flat">Салон</h1>');
    expect(html).toContain('data-admhelp="salon"');
    expect(html).toMatch(/<div class="adm-helpp" id="admhelp-salon" hidden>Продажа тому, кто стоит перед вами/);
    expect(html).toMatch(/<button class="adm-btn adm-btn--ghost adm-posscan" type="button" data-scanopen>[\s\S]*<span>Сканировать<\/span><\/button>/);
    expect(html).not.toContain("Продажа в салоне");
  });

  it("a chip in the basket is ink and says how many: «×2»", () => {
    const html = salon({ analytics: topOf(["sys4"]), S: { posCart: [{ id: "sys4", variant: "250 мл", qty: 2 }] } }).screen();
    expect(html).toMatch(/<button class="adm-poschip is-in" type="button" data-posadd="sys4:1">[\s\S]*?<span class="adm-poschip__n">×2<\/span><\/button>/);
    expect(html).toMatch(/<button class="adm-poschip" type="button" data-posadd="sys4:0">/);
  });

  it("a line has − / + / × and its size first in the grey line, the sum of the line after it", () => {
    const html = salon({ S: { posCart: [{ id: "sys4", variant: "250 мл", qty: 3 }] } }).screen();
    expect(html).toContain('data-posqty="0:-1"');
    expect(html).toContain('data-posqty="0:1"');
    expect(html).toContain('data-posremove="0" aria-label="Убрать">×</button>');
    expect(html).toContain('<span class="adm-row__sub"><span>250 мл</span> · <span>48 €</span></span>');
    expect(html).toContain('<span class="adm-poscart__n">3 шт</span>');
  });

  it("keeps the client's e-mail and phone (the desktop keeps the phone too), folded on a phone", () => {
    const html = salon({ S: { posCart: [{ id: "touch", variant: "", qty: 1 }], posEmail: "a@b.ee" } }).screen();
    expect(html).toContain('data-admfold="pos:buyer" aria-expanded="false"');
    expect(html).toContain('<span class="adm-foldrow__s">a@b.ee</span>');
    expect(html).toMatch(/type="email" data-posemail value="a@b.ee"/);
    expect(html).toMatch(/type="tel" data-posphone value=""/);
  });

  it("a refusal from the server stays in words over the button", () => {
    const html = salon({ S: { posCart: [{ id: "touch", variant: "", qty: 1 }], posErr: "Проверьте e-mail покупателя — адрес набран с ошибкой." } }).screen();
    expect(html).toContain('<p class="adm-err" role="alert">Проверьте e-mail покупателя');
  });

  it("signed out: the same title and the sign-in line, nothing to sell", () => {
    const html = salon({ admin: false }).screen();
    expect(html).toContain(">Салон</h1>");
    expect(html).toContain("Войдите в панель, чтобы оформлять продажи");
    expect(html).not.toContain("data-possend");
  });

  it("the new hooks reach the one delegated click handler", () => {
    const list = /e\.target\.closest\("(\[data-giftpdf\][^"]+)"\)/.exec(app);
    expect(list, "the delegated handler's selector list moved").not.toBeNull();
    for (const hook of ["[data-posdisc]", "[data-pospay]", "[data-possend]", "[data-posnew]", "[data-posadd]", "[data-posremove]", "[data-posqty]"]) {
      expect(list![1].split(","), hook).toContain(hook);
    }
  });
});
