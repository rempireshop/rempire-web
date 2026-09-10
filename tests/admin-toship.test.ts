/**
 * «Отправить» counts parcels, not paid orders.
 *
 * Dim, 07.09.2026: a gift-card order sat in the admin as if it were waiting to
 * be posted. It is `shipping.method === "digital"` — the card is e-mailed the
 * moment the payment lands — and the order card had been hiding its parcel
 * steps since that method existed, but the three places that *count* the queue
 * («Обзор» → «Отправить N», the «Сделать сегодня» row, and the «Отправить»
 * chip on «Заказы») all read `v.paid`, which a digital order is.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so — like
 * tests/checkout-parity.test.ts — the four functions that decide this are
 * **sliced out of public/shop2/app.js by source text** and run against stubs.
 * Retyping them would test this file instead of the panel, and the slice fails
 * loudly the day app.js renames one of them.
 *
 * The server half of the same rule (`to_ship` in src/lib/analytics.ts) is
 * covered by tests/overview.test.ts.
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

/** One row of `SRV.orders`, in the shape srvRow() leaves behind. */
function row(
  id: string,
  srv: { status: string; shipping?: Record<string, unknown>; channel?: string },
) {
  return {
    id,
    number: "R-1000" + id,
    who: "Мария Тамм",
    date: "15.06.2026",
    items: 1,
    sum: 50,
    ship: "",
    state: ["new"],
    srv: { id, status: srv.status, channel: srv.channel ?? "web", shipping: srv.shipping ?? {} },
  };
}

type Panel = {
  count: number;
  split: { fresh: number; labeled: number };
  queue: string[];
  chip: string[];
  all: string[];
};

/** Run the panel's own queue arithmetic over a list of orders. */
function panel(orders: ReturnType<typeof row>[]): Panel {
  const body = `
    ${slice("admOrderVM")}
    ${slice("admWaitingCount")}
    ${slice("admLiveToShip")}
    ${slice("admWaitingSplit")}
    ${slice("admOrderMatches")}
    ${slice("admReturnAskedAt")}
    ${slice("admRefundView")}
    function admRefundedTotal() { return 0; }
    function admRefunds() { return []; }
    function admInvoiceOverdue() { return 0; }
    function admOrders() { return []; }
    var vms = SRV.orders.map(admOrderVM);
    function ids(f) {
      return vms.filter(function (v) { return admOrderMatches(v, f); }).map(function (v) { return v.id; });
    }
    return {
      count: admWaitingCount(),
      split: admWaitingSplit(),
      queue: admLiveToShip().map(function (v) { return v.id; }),
      chip: ids("new"),
      all: ids("all")
    };
  `;
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  const run = new Function("SRV", "OVERVIEW", body) as (
    srv: unknown,
    overview: unknown,
  ) => Panel;
  return run({ admin: true, orders }, { data: null });
}

const parcel = { method: "parcel", country: "EE" };
const digitalShip = { method: "digital", country: "EE" };

describe("the admin's «Отправить» queue", () => {
  it("leaves out an all-gift-card order — there is no parcel to hand over", () => {
    const out = panel([
      row("1", { status: "paid", shipping: parcel }),
      row("2", { status: "paid", shipping: digitalShip }),
    ]);
    // «Обзор» → «Отправить N» and the «Сделать сегодня» row read this number
    expect(out.count).toBe(1);
    expect(out.queue).toEqual(["1"]);
    // the chip on «Заказы» splits the same set
    expect(out.chip).toEqual(["1"]);
    expect(out.split).toEqual({ fresh: 1, labeled: 0 });
  });

  it("still shows the gift-card order under «Все» — it is hidden from a queue, not from the shop", () => {
    const out = panel([
      row("1", { status: "paid", shipping: parcel }),
      row("2", { status: "paid", shipping: digitalShip }),
    ]);
    expect(out.all).toEqual(["1", "2"]);
  });

  it("counts an ordinary paid parcel order and skips the salon counter, as before", () => {
    const out = panel([
      row("1", { status: "paid", shipping: parcel }),
      row("2", { status: "paid", shipping: parcel, channel: "pos" }),
      row("3", { status: "shipped", shipping: parcel }),
      row("4", { status: "new", shipping: parcel }),
    ]);
    expect(out.count).toBe(1);
    expect(out.queue).toEqual(["1"]);
  });

  it("keeps a digital order «paid» — money is money, only the queue is a parcel queue", () => {
    const body = `
      ${slice("admOrderVM")}
      ${slice("admReturnAskedAt")}
      ${slice("admRefundView")}
      function admRefundedTotal() { return 0; }
      function admRefunds() { return []; }
      function admInvoiceOverdue() { return 0; }
      return admOrderVM(ORDER);
    `;
    const run = new Function("ORDER", body) as (o: unknown) => {
      paid: boolean;
      toShip: boolean;
      digital: boolean;
    };
    const vm = run(row("2", { status: "paid", shipping: digitalShip }));
    // «Вернуть деньги», the journal and every revenue figure read `paid`
    expect(vm.paid).toBe(true);
    expect(vm.digital).toBe(true);
    expect(vm.toShip).toBe(false);
  });
});
