/**
 * «Оплата» on the order card names the BANK, not its BIC.
 *
 * Seen on staging (24.09.2026): «Bank link · RVUALT2V» on an order paid through
 * Revolut — and the same with N26 (NTSBDEB1), Wise (TRWIGB2L) and the Latvian,
 * Lithuanian and Finnish banks. bankNameOf() knew two sources: Montonio's list
 * (PAYMETHODS) and the five Estonian banks the checkout was built with. The
 * panel only ever asked for Montonio's list on «Подключения» and «Доставка и
 * оплата», so a card opened first had no list at all, and even with one it
 * read the SHOPPER's list — the one minus every bank the owner has switched
 * off — so a bank he stopped offering yesterday lost its name on last week's
 * orders.
 *
 * Now: Montonio's full list first, the checkout's list, the built-in five,
 * then a short map of the three international banks, and the code only when
 * nothing at all is known. The card asks for the list itself.
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

type Bank = { code: string; name: string };
type Pay = { banks: Bank[] | null; all: Bank[] | null };

function names(pay: Pay, codes: string[]): string[] {
  return runInNewContext(`
    var PAYMETHODS = ${JSON.stringify(pay)};
    var BANK_CODES = ${sliceLiteral("var BANK_CODES = ", "};")};
    var BANK_NAMES_ABROAD = ${sliceLiteral("var BANK_NAMES_ABROAD = ", "};")};
    ${slice("bankNameOf")}
    ${JSON.stringify(codes)}.map(bankNameOf);
  `, {}) as string[];
}

/** The «Оплата» block's text for a bank-link order paid through `code`. */
function paymentBlock(pay: Pay, code: string, detail?: string): string {
  return runInNewContext(`
    var PAYMETHODS = ${JSON.stringify(pay)};
    var BANK_CODES = ${sliceLiteral("var BANK_CODES = ", "};")};
    var BANK_NAMES_ABROAD = ${sliceLiteral("var BANK_NAMES_ABROAD = ", "};")};
    var PAY_METHOD_NAMES = ${sliceLiteral("var PAY_METHOD_NAMES = ", "};")};
    var PAY_PROVIDER_NAMES = ${sliceLiteral("var PAY_PROVIDER_NAMES = ", "};")};
    function esc(s) { return String(s); }
    function eur(n) { return n + " €"; }
    function admPayRefHTML() { return ""; }
    function admRefundedTotal() { return 0; }
    function admRefunds() { return []; }
    ${slice("payPiecesHTML")}
    ${slice("bankNameOf")}
    ${slice("admPaymentHTML")}
    admPaymentHTML({ total: 30, payment: { method: "bank", bank: ${JSON.stringify(code)}, provider: "montonio", status: "paid", detail: ${JSON.stringify(detail ?? null)} } });
  `, {}) as string;
}

const NONE: Pay = { banks: null, all: null };

describe("the order card names the bank a shopper paid through", () => {
  it("the three international banks have a name even before Montonio's list has arrived", () => {
    expect(names(NONE, ["RVUALT2V", "NTSBDEB1", "TRWIGB2L"])).toEqual(["Revolut", "N26", "Wise"]);
  });

  it("the built-in five are still named, and a code nobody knows is printed as it is", () => {
    expect(names(NONE, ["HABAEE2X", "LHVBEE22", "XYZWLT21"])).toEqual(["Swedbank", "LHV", "XYZWLT21"]);
  });

  it("Montonio's own name wins, from the FULL list — a bank the owner switched off keeps its name", () => {
    const pay: Pay = {
      banks: [{ code: "HABALV22", name: "Swedbank Latvia" }],
      all: [{ code: "HABALV22", name: "Swedbank Latvia" }, { code: "PARXLV22", name: "Citadele" },
        { code: "RVUALT2V", name: "Revolut Bank" }, { code: "NDEAFIHH", name: "Nordea" }],
    };
    expect(names(pay, ["PARXLV22", "NDEAFIHH", "RVUALT2V", "HABALV22"]))
      .toEqual(["Citadele", "Nordea", "Revolut Bank", "Swedbank Latvia"]);
  });

  it("«Оплата» prints «Revolut», never «RVUALT2V»", () => {
    const html = paymentBlock(NONE, "RVUALT2V");
    expect(html).toContain("<span>Revolut</span>");
    expect(html).not.toContain("RVUALT2V");
  });

  /* Staging, 25.09.2026 (order-card-payment, R-100061): paid through «Revolut
     Poland» — Montonio's own words in payment.detail — and the card said
     «Банковская ссылка · Revolut Estonia». Montonio lists one bank per
     country, and Revolut, N26 and Wise sit in several countries under ONE BIC,
     so the first entry of the list was simply the Estonian one. */
  const MULTI: Pay = {
    banks: null,
    all: [
      { code: "HABAEE2X", name: "Swedbank Estonia" },
      { code: "RVUALT2V", name: "Revolut Estonia" },
      { code: "NTSBDEB1", name: "N26 Estonia" },
      { code: "HABALV22", name: "Swedbank Latvia" },
      { code: "RVUALT2V", name: "Revolut Latvia" },
      { code: "NTSBDEB1", name: "N26 Latvia" },
      { code: "RVUALT2V", name: "Revolut Poland" },
      { code: "CTDLBANK", name: "Citadele Latvia" },
      { code: "CTDLBANK", name: "Citadele Lithuania" },
    ],
  };

  it("a BIC shared by several countries is named without a country", () => {
    expect(names(MULTI, ["RVUALT2V", "NTSBDEB1", "CTDLBANK"])).toEqual(["Revolut", "N26", "Citadele"]);
    const html = paymentBlock(MULTI, "RVUALT2V");
    expect(html).toContain("<span>Revolut</span>");
    expect(html).not.toContain("Estonia");
  });

  it("…unless the payment itself says which: Montonio's own name for the bank it went through", () => {
    const html = paymentBlock(MULTI, "RVUALT2V", "paymentInitiation · Revolut Poland");
    expect(html).toContain("<span>Revolut Poland</span>");
    expect(html).not.toContain("Revolut Estonia");
    // …and only a name that belongs to THIS bank: anything else is not believed
    expect(paymentBlock(MULTI, "RVUALT2V", "paymentInitiation · Swedbank Estonia")).toContain("<span>Revolut</span>");
    expect(paymentBlock(MULTI, "RVUALT2V", "отмечено оплаченным в админке")).toContain("<span>Revolut</span>");
    // the list not in yet: the payment's own name still wins over the bare brand
    expect(paymentBlock(NONE, "RVUALT2V", "paymentInitiation · Revolut Poland")).toContain("<span>Revolut Poland</span>");
  });

  it("a bank that is in one country keeps its full name", () => {
    expect(names(MULTI, ["HABAEE2X", "HABALV22"])).toEqual(["Swedbank Estonia", "Swedbank Latvia"]);
    expect(paymentBlock(MULTI, "HABAEE2X", "paymentInitiation · Swedbank Estonia")).toContain("<span>Swedbank Estonia</span>");
  });

  it("the card asks for Montonio's list when the order was paid by bank link", () => {
    // admOrderCardHTML() is too wide to run here; this pins the one line that
    // makes the list arrive on the screen that prints the name
    expect(slice("admOrderCardHTML")).toMatch(/method === "bank"[^;]*loadPayMethods\(\)/);
  });
});
