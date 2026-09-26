/**
 * A refund's points in words — Dim, 26.09.2026, /test «order-refund-full»:
 * «Text is there, but I'm not sure if in the account the points were
 * returned.» The account showed one «Корректировка» row with the net of both
 * halves and «возврат заказа R-…» under it in small print.
 *
 * Two halves are pinned here: which ledger row is which line
 * (src/lib/loyalty-lines.ts), and what the account screen prints for them —
 * the storefront's own functions sliced out of public/shop2/app.js and run
 * over stubs, the idiom of tests/acct-autosave.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pointsLineOf } from "@/lib/loyalty-lines";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

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

describe("which line a ledger row is", () => {
  const O = "11111111-1111-1111-1111-111111111111";
  it("names a refund's rows by their ref, and an undo by its sign", () => {
    expect(pointsLineOf({ reason: "adjust", orderId: O, ref: `loyalty-back:${O}:0`, delta: 10 })).toBe("back");
    expect(pointsLineOf({ reason: "adjust", orderId: O, ref: `loyalty-revoke:${O}:1`, delta: -3 })).toBe("revoke");
    expect(pointsLineOf({ reason: "adjust", orderId: O, ref: `loyalty-back:${O}:2`, delta: -10 })).toBe("undo");
    expect(pointsLineOf({ reason: "adjust", orderId: O, ref: `loyalty-revoke:${O}:3`, delta: 3 })).toBe("undo");
  });

  it("reads a net row from before 26.09.2026 by its sign, and leaves everything else alone", () => {
    expect(pointsLineOf({ reason: "adjust", orderId: O, ref: null, delta: 7 })).toBe("back");
    expect(pointsLineOf({ reason: "adjust", orderId: O, ref: null, delta: -4 })).toBe("revoke");
    // a manual correction has no order; earn and redeem are their own words
    expect(pointsLineOf({ reason: "adjust", orderId: null, ref: "adj:abc", delta: 50 })).toBeNull();
    expect(pointsLineOf({ reason: "earn", orderId: O, ref: null, delta: 5 })).toBeNull();
    expect(pointsLineOf({ reason: "redeem", orderId: O, ref: null, delta: -5 })).toBeNull();
  });
});

type Row = { reason: string; delta: number; at: string; note?: string | null; line?: string; orderNumber?: string | null };

// This repository's own source plus fixed stub text — no outside input.
const shop = new Function(
  `
  var LOYALTY_REASON = { earn: "Начислено", redeem: "Списано", adjust: "Корректировка", expire: "Сгорело" };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function shortDate(iso) { return String(iso).slice(8, 10) + "." + String(iso).slice(5, 7); }
  function eur(n) { return n + " €"; }
  var S = { acctReturnBusy: "" };
  var ACCT_ORDER_STATE = { refunded: ["возврат", "chip--low"], paid: ["оплачен", "chip--ok"] };
  ${slice("loyaltyLabel")}
  ${slice("loyaltySub")}
  ${slice("loyaltyRowHTML")}
  ${slice("acctOrderRow")}
  return { label: loyaltyLabel, row: loyaltyRowHTML, order: acctOrderRow };
`,
)() as { label: (e: Row) => string; row: (e: Row) => string; order: (o: Record<string, unknown>) => string };

describe("«Баллы лояльности» in the account", () => {
  const at = "2026-09-26T10:00:00.000Z";

  it("says in words which half of the refund each line is, with the order's number", () => {
    expect(shop.label({ reason: "adjust", delta: 10, at, line: "back", orderNumber: "R-100042" }))
      .toBe("Вернули баллы, потраченные на заказ R-100042");
    expect(shop.label({ reason: "adjust", delta: -3, at, line: "revoke", orderNumber: "R-100042" }))
      .toBe("Сняли баллы, начисленные за заказ R-100042");
    expect(shop.label({ reason: "adjust", delta: -10, at, line: "undo", orderNumber: "R-100042" }))
      .toBe("Заказ R-100042 снова оплачен — баллы как были");
    // every other row keeps its word
    expect(shop.label({ reason: "earn", delta: 5, at })).toBe("Начислено");
    expect(shop.label({ reason: "adjust", delta: 50, at, note: "подарок" })).toBe("Корректировка");
  });

  it("does not repeat the note under a refund line, and keeps it under the rest", () => {
    const back = shop.row({ reason: "adjust", delta: 10, at, line: "back", orderNumber: "R-1", note: "возврат заказа R-1" });
    expect(back).toContain("Вернули баллы, потраченные на заказ R-1");
    expect(back).not.toContain("возврат заказа R-1");
    expect(back).toContain(">+10<");
    const gift = shop.row({ reason: "adjust", delta: 50, at, note: "подарок" });
    expect(gift).toContain("подарок");
  });

  it("every one of those sentences has an Estonian and an English rule", () => {
    for (const ru of [
      "^Вернули баллы, потраченные на заказ (\\S+)$",
      "^Сняли баллы, начисленные за заказ (\\S+)$",
      "^Заказ (\\S+) снова оплачен — баллы как были$",
    ]) {
      expect(src, ru).toContain(`[/${ru}/,`);
    }
  });
});

describe("«Мои заказы»: the points under a refunded order", () => {
  const order = { number: "R-100042", status: "refunded", total: 40, createdAt: "2026-09-20T10:00:00Z", items: [] };

  it("shows what came back and what was taken off", () => {
    const html = shop.order({ ...order, pointsBack: 10, pointsRevoked: 3 });
    expect(html).toContain('<span>Потраченные баллы вернули:</span> <span class="num">+10</span>');
    expect(html).toContain('<span>Баллы за заказ сняли:</span> <span class="num">−3</span>');
  });

  it("shows nothing on an order whose points did not move", () => {
    expect(shop.order({ ...order, pointsBack: 0, pointsRevoked: 0 })).not.toContain("баллы");
    expect(shop.order(order)).not.toContain("rowcard__pts");
  });
});
