/**
 * The panel half of «one refund per look at the ledger» (staging, R-100086 —
 * the server half and the story are in tests/refund-once-per-look.test.ts).
 *
 * The refund card is opened with the count of refund lines the order holds,
 * «Вернуть деньги» posts that count as `refundsSeen`, and a refusal that says
 * the card was older than the ledger re-reads the orders so the NEXT card is
 * opened on the new count and says «По заказу уже возвращено …».
 *
 * The click handler's «Вернуть деньги» branch and the card's functions are cut
 * out of public/shop2/app.js by source text and run over stubs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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

type Answer = { status: number; body: Record<string, unknown> };

function panel(refunds: unknown[], answer: Answer | Error) {
  const row = {
    id: "ord-86", number: "R-100086", who: "Claude Test", refundable: 5, refunded: 4,
    refund: { gift: 5, money: 0, sold: [] }, srv: { payment: { status: "paid", refunds } },
  };
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const toasts: string[] = [];
  let reloads = 0;
  const box = { value: "5.00" };
  const document = { querySelector: (sel: string) => (sel === "[data-admrefundamt]" ? box : null) };
  const body = `
    var pendingAction = null;
    function eur(n) { return String(n).replace(".", ",") + " €"; }
    function admOrderById(id) { return id === ROW.id ? ROW : null; }
    function admRefundSoldNote() { return ""; }
    function admRefundConfirmText() { return "…"; }
    function render() {}
    function refocus() {}
    function journalNote() {}
    function admRefundCode() { return ""; }
    function admOrdersChanged() { RELOAD(); }
    ${slice("admRefunds")}
    ${slice("srvMsg")}
    ${block("var REFUND_ERR = {")};
    ${slice("admRefundSeen")}
    ${slice("admRefundAmount")}
    ${slice("admRefundApply")}
    ${slice("srvOrderRefund")}
    function open(d) { ${block("if (d.admrefund) {")} }
    return {
      open: function () { open({ admrefund: ROW.id }); },
      pending: function () { return pendingAction; },
      press: function () { var pa = pendingAction; pendingAction = null; admRefundApply(pa); },
      seen: admRefundSeen,
    };
  `;
  const fns = new Function("S", "SRV", "ROW", "document", "apiSend", "toast", "RELOAD", body)(
    { lang: "EN" }, { admin: true, refundBusy: false }, row, document,
    (url: string, _m: string, b: Record<string, unknown>) => {
      sent.push({ url, body: b });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    (m: string) => toasts.push(m),
    () => { reloads++; },
  ) as { open: () => void; pending: () => { seen?: number } | null; press: () => void; seen: (r: unknown) => number };
  return { ...fns, row, sent, toasts, reloads: () => reloads };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("«Вернуть деньги» says which ledger it was confirmed on", () => {
  it("the card opens on the count of refund lines, and posts it", async () => {
    const p = panel([{ ref: "gc:1", amount: 4, status: "done", to: "giftcard" }], { status: 200, body: { ok: true, amount: 5, gift: 5 } });
    p.open();
    expect(p.pending()?.seen).toBe(1);
    p.press();
    await flush();
    expect(p.sent).toEqual([{ url: "/api/admin/orders/ord-86/refund/", body: { amount: 5, refundsSeen: 1 } }]);
  });

  it("counts as the server does: a line without a reference is not a refund", () => {
    const p = panel([], { status: 200, body: {} });
    expect(p.seen({ srv: { payment: { refunds: [{ ref: "a" }, { amount: 3 }, null, { ref: "" }, { ref: "b" }] } } })).toBe(2);
    expect(p.seen({ srv: { payment: null } })).toBe(0);
    expect(p.seen(null)).toBe(0);
  });

  it("a card older than the ledger: the server's sentence, and the orders are read again", async () => {
    const said = { RU: "По этому заказу уже вернули 4 €. …", ET: "…", EN: "4 € has already been refunded on this order. …" };
    const p = panel([], { status: 409, body: { ok: false, error: "refund_stale", refundedTotal: 4, messages: said } });
    p.open();
    p.press();
    await flush();
    expect(p.toasts).toEqual([said.EN]);
    expect(p.reloads(), "the next card would open on the old count").toBe(1);
  });

  it("the twin still running: its own sentence, and a re-read too", async () => {
    const p = panel([], { status: 409, body: { ok: false, error: "in_progress" } });
    p.open();
    p.press();
    await flush();
    expect(p.toasts[0]).toContain("уже оформляется");
    expect(p.reloads()).toBe(1);
  });

  it("an answer that never came back re-reads the orders as well", async () => {
    const p = panel([], new Error("offline"));
    p.open();
    p.press();
    await flush();
    await flush();
    expect(p.toasts).toEqual(["Сервер не отвечает"]);
    expect(p.reloads()).toBe(1);
  });
});
