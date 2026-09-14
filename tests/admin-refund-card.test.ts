/**
 * What «Вернуть деньги» offers on the order card — `admRefundView()` in
 * public/shop2/app.js.
 *
 * The card draws the button only while `refundable > 0.004`, so this one
 * function decides whether the owner is offered a way to send money out of the
 * shop. It used to ask the payment blob alone («did the money ever arrive?»)
 * and never the order's status, which meant an order set to «возврат» by hand
 * — the way Renat records money he sent back from the bank himself, and for
 * which the shop has already mailed the customer «Деньги возвращены» for the
 * whole order — still offered the full amount, through Montonio, a second
 * time. The server half of the same rule is in tests/payments-refund.test.ts.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so the functions are sliced
 * out of app.js by source text and run against stubs — same technique as
 * tests/admin-toship.test.ts, and it fails loudly the day app.js renames one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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

interface View {
  refunded: number;
  refundable: number;
  gift: number;
  money: number;
  value: number;
}

/** The card's own arithmetic over one order, as the server sends it. */
function view(sum: number, srv: Record<string, unknown>): View {
  const body = `
    ${slice("admRefunds")}
    ${slice("admRefundedTotal")}
    ${slice("admRefundView")}
    return admRefundView(SUM, SRV);
  `;
  // repository source only — SUM and SRV are arguments, not text
  return (new Function("SUM", "SRV", body) as (s: number, o: unknown) => View)(sum, srv);
}

const paidByBank = { provider: "montonio", ref: "montonio-uuid-1", status: "paid" };

describe("admRefundView() — when the card offers «Вернуть деньги»", () => {
  it("a paid order offers the whole amount", () => {
    const v = view(48, { status: "paid", payment: paidByBank });
    expect(v.refundable).toBe(48);
    expect(v.money).toBe(48);
  });

  it("an order set to «возврат» by hand offers nothing — that money is already back", () => {
    const v = view(48, { status: "refunded", payment: paidByBank });
    expect(v.refundable).toBe(0);
    expect(v.money).toBe(0);
    expect(v.gift).toBe(0);
  });

  it("a cancelled order still offers it — the shop is still holding the money", () => {
    const v = view(48, { status: "cancelled", payment: paidByBank });
    expect(v.refundable).toBe(48);
  });

  it("a refund the ledger already made leaves only the remainder, and then nothing", () => {
    const part = view(48, {
      status: "paid",
      payment: { ...paidByBank, refunds: [{ ref: "r1", amount: 8, status: "done" }], refundedTotal: 8 },
    });
    expect(part.refunded).toBe(8);
    expect(part.refundable).toBe(40);

    const all = view(48, {
      status: "refunded",
      payment: { ...paidByBank, refunds: [{ ref: "r1", amount: 48, status: "done" }], refundedTotal: 48 },
    });
    expect(all.refunded).toBe(48);
    expect(all.refundable).toBe(0);
  });

  it("an unpaid order offers nothing at all", () => {
    expect(view(48, { status: "new", payment: { status: "pending" } }).refundable).toBe(0);
  });
});
