/**
 * «Выдан клиенту» in a row of «Заказы» — one tap, not two.
 *
 * Renat, 13.09.2026 and again on the /test pass of 23.09.2026: «Worked only on
 * second click in the list row.» The step is a PATCH, and the row has no
 * status of its own — it is drawn from a list the panel fetched. The 13.09
 * fix made the button say «Сохраняем…» until «the list comes back», and it
 * let ANY list that came back decide that:
 *
 *   · a list already in the air when the tap landed (the panel re-reads
 *     «Заказы» every time the tab comes back into view — refreshAdmin) was
 *     read BEFORE the status moved. The reload the PATCH asks for was dropped
 *     as «one in flight is enough», the old list landed, and the row offered
 *     «Выдан клиенту» all over again;
 *   · with a search typed the rows are the search's own copy (FOUND.rows),
 *     and the plain list landing first re-armed the button over the search's
 *     still-old row;
 *   · a list landing while the PATCH itself was still out re-armed it too.
 *
 * Each of those is a row that says «nothing happened» after a tap that
 * worked — so the owner tapped again. The functions are cut out of app.js by
 * source text and driven against a network the test answers by hand, in the
 * order that goes wrong on a phone.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const flush = () => new Promise((r) => setTimeout(r, 0));

type Order = { id: string; number?: string; status: string };
type Row = { id: string; srv: Order };
type Answer = { status: number; body: Record<string, unknown> };
type Call = { url: string; method: string; body?: unknown; answer: (a: Answer) => void; fail: () => void };

function panel(opts: { rows: Order[]; search?: string }) {
  const calls: Call[] = [];
  const toasts: string[] = [];
  const ask = (url: string, method: string, body?: unknown) =>
    new Promise<Answer>((resolve, reject) => {
      calls.push({ url, method, body, answer: resolve, fail: () => reject(new Error("offline")) });
    });
  const srvRow = (o: Order): Row => ({ id: o.id, srv: o });
  const SRV = {
    admin: true as boolean | null,
    orders: opts.rows.map(srvRow) as Row[] | null,
    ordersErr: false,
    stepBusy: "",
  };
  const FOUND = opts.search
    ? { q: opts.search, want: opts.search, rows: opts.rows.map(srvRow) as Row[] | null, err: false, busy: false, seq: 1 }
    : { q: null as string | null, want: "", rows: null as Row[] | null, err: false, busy: false, seq: 0 };
  /* The third copy an order can be drawn from — one fetched on its own for
     the card (admin-order-beyond-hundred.test.ts). Empty here: these rows are
     all in a list. */
  const ORDER_ONE = { rows: [] as Row[], busy: "", gone: "", err: "", seq: 0 };
  const names = [
    "SRV", "FOUND", "ORDER_ONE", "S", "apiJson", "apiSend", "render", "toast", "journalDrop", "pushBoot", "pushOpenWanted",
    "srvRow", "loadOverview", "scanStockChanged", "shipRollback", "flowCountsAt", "reportSummaryAt",
  ];
  const own = [
    "admOrderQClean", "loadOrderSearch", "loadSrvOrders", "loadOrderOne", "admOrderListsReload",
    "admOrdersChanged", "admOrderLand", "srvPush",
  ];
  const fns = new Function(
    ...names,
    own.map(slice).join("\n") + "\nreturn { loadSrvOrders: loadSrvOrders, srvPush: srvPush };",
  )(
    SRV, FOUND, ORDER_ONE, { admGiftCards: null }, (url: string) => ask(url, "GET"),
    (url: string, method: string, body: unknown) => ask(url, method, body),
    () => {}, (m: string) => toasts.push(m), () => {}, () => {}, () => {},
    srvRow, () => {}, () => {}, null, 0, 0,
  ) as { loadSrvOrders: (force?: boolean) => void; srvPush: (a: unknown, entry: unknown) => void };

  /** The status the row on screen is drawn from — the search's copy while a search is on. */
  const shown = (id: string) => {
    const list = FOUND.q != null ? FOUND.rows : SRV.orders;
    const row = (list || []).find((r) => r.id === id);
    return row ? row.srv.status : "";
  };
  /** Would the row offer its step again? Only when it is not «Сохраняем…» and still reads paid. */
  const offersAgain = (id: string) => SRV.stepBusy !== id && shown(id) === "paid";
  const handOver = (id: string) =>
    fns.srvPush({ type: "order_status", id, number: "R-100042", value: "delivered", prev: "paid" }, { txt: "R-100042" });
  const pending = (pred: (c: Call) => boolean) => calls.filter(pred);
  return { SRV, FOUND, calls, toasts, fns, shown, offersAgain, handOver, pending };
}

const isList = (c: Call) => c.method === "GET" && /orders\/\?limit=100$/.test(c.url);
const isSearch = (c: Call) => c.method === "GET" && /[?&]q=/.test(c.url);
const isPatch = (c: Call) => c.method === "PATCH";
const paid: Order = { id: "o1", number: "R-100042", status: "paid" };
const done: Order = { id: "o1", number: "R-100042", status: "delivered" };

describe("«Выдан клиенту» in a list row takes one tap", () => {
  it("a list that was already on its way when the tap landed does not put the step back", async () => {
    const p = panel({ rows: [paid] });
    p.fns.loadSrvOrders(true);                 // the tab came back into view: «Заказы» is re-read
    p.handOver("o1");
    expect(p.SRV.stepBusy).toBe("o1");

    p.pending(isPatch)[0].answer({ status: 200, body: { ok: true, order: done } });
    await flush();
    expect(p.offersAgain("o1"), "the row went back to «Выдан клиенту» after the PATCH").toBe(false);

    // the list that left BEFORE the status moved lands now, with the old status in it
    p.pending(isList)[0].answer({ status: 200, body: { ok: true, orders: [paid] } });
    await flush();
    expect(p.offersAgain("o1"), "a list read before the change re-armed the button").toBe(false);

    // …and the panel asks once more, and that answer is the truth
    const again = p.pending(isList);
    expect(again.length, "no fresh list was asked for after the write").toBe(2);
    again[1].answer({ status: 200, body: { ok: true, orders: [done] } });
    await flush();
    expect(p.shown("o1")).toBe("delivered");
    expect(p.SRV.stepBusy).toBe("");
    expect(p.pending(isPatch), "one tap, one PATCH").toHaveLength(1);
  });

  it("with a search on, the plain list landing first does not re-arm the search's row", async () => {
    const p = panel({ rows: [paid], search: "R-100042" });
    p.handOver("o1");
    p.pending(isPatch)[0].answer({ status: 200, body: { ok: true, order: done } });
    await flush();

    p.pending(isList)[0].answer({ status: 200, body: { ok: true, orders: [done] } });
    await flush();
    expect(p.offersAgain("o1"), "the search's row said «Выдан клиенту» again").toBe(false);

    p.pending(isSearch)[0].answer({ status: 200, body: { ok: true, orders: [done] } });
    await flush();
    expect(p.shown("o1")).toBe("delivered");
  });

  it("a list landing while the PATCH is still out keeps «Сохраняем…» on the button", async () => {
    const p = panel({ rows: [paid] });
    p.handOver("o1");
    p.fns.loadSrvOrders(true);                 // some other refresh, in the middle of the step
    p.pending(isList)[0].answer({ status: 200, body: { ok: true, orders: [paid] } });
    await flush();
    expect(p.SRV.stepBusy, "the button took taps again before the server had answered").toBe("o1");
    expect(p.offersAgain("o1")).toBe(false);
  });

  it("an answer without the order still moves the row", async () => {
    const p = panel({ rows: [paid] });
    p.handOver("o1");
    p.pending(isPatch)[0].answer({ status: 200, body: { ok: true } });
    await flush();
    expect(p.shown("o1")).toBe("delivered");
    expect(p.SRV.stepBusy).toBe("");
  });

  it("a refused step gives the button back, over the old status", async () => {
    const p = panel({ rows: [paid] });
    p.handOver("o1");
    p.pending(isPatch)[0].answer({ status: 409, body: { ok: false, error: "bad_status" } });
    await flush();
    expect(p.toasts).toEqual(["Не удалось сохранить статус"]);
    expect(p.SRV.stepBusy).toBe("");
    expect(p.shown("o1")).toBe("paid");
  });

  it("…and so does a request that never came back", async () => {
    const p = panel({ rows: [paid] });
    p.handOver("o1");
    p.pending(isPatch)[0].fail();
    await flush();
    expect(p.SRV.stepBusy).toBe("");
    expect(p.shown("o1")).toBe("paid");
  });

  /* probeAdmin() calls loadSrvOrders(true) twice in one breath at boot and
     counts on the second being a no-op. Only a WRITE may ask again. */
  it("two refreshes in one breath are still one request", async () => {
    const p = panel({ rows: [paid] });
    p.fns.loadSrvOrders(true);
    p.fns.loadSrvOrders(true);
    expect(p.pending(isList)).toHaveLength(1);
    p.pending(isList)[0].answer({ status: 200, body: { ok: true, orders: [paid] } });
    await flush();
    expect(p.pending(isList)).toHaveLength(1);
  });
});
