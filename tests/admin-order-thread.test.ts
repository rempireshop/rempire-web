/**
 * «Написать клиенту» keeps the exchange in the order card.
 *
 * The reply card fetched the thread (GET /api/admin/orders/<id>/messages/ →
 * S.orderMsgs) when it opened, and every send answered with the whole thread
 * again — and nothing ever drew it. /test «order-message» expects «После
 * отправки переписка осталась в карточке заказа», and what the owner saw after
 * «Отправить» was the empty draft box and a toast: no trace of the letter he
 * had just sent, nor of the customer's question he had pasted in (admin-functions
 * map, defect 5, 24.09.2026).
 *
 * admOrderMsgHTML() and srvOrderMailSend() are cut out of app.js by source
 * text and run over stubs — the technique of tests/admin-order-step-once.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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

type Msg = { id: number; orderId: string; direction: "in" | "out"; body: string; meta: Record<string, unknown>; createdAt: string };
type Answer = { status: number; body: Record<string, unknown> };

const ORDER = { id: "0b6f3c1e-uuid", number: "R-100042", email: "maria@example.com" };
const VIEW = { id: ORDER.id, number: ORDER.number, srv: ORDER };

function msg(id: number, direction: "in" | "out", body: string, orderId = ORDER.id): Msg {
  return { id, orderId, direction, body, meta: {}, createdAt: `2026-09-24T0${id}:15:00.000Z` };
}

function panel(answer?: Answer) {
  const S: Record<string, unknown> = { orderReplyOpen: true, orderReplyDraft: "", orderMsgs: null, orderMsgsFor: "", lang: "RU" };
  const toasts: string[] = [];
  /* the one box the send reads back off the screen: the question pasted in */
  const asked = { value: "Можно ли забрать самому?" };
  const document = { querySelector: (sel: string) => (sel === "[data-ordercustmsg]" ? asked : null) };
  const body = `
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    function admOrderDraft() { return "Здравствуйте!"; }
    function journalNote() {}
    ${slice("flowRunWhen")}
    ${slice("admOrderThreadHTML")}
    ${slice("admOrderMsgHTML")}
    ${slice("srvOrderMailSend")}
    return { card: admOrderMsgHTML, send: srvOrderMailSend };
  `;
  const fns = new Function("S", "SRV", "apiSend", "render", "toast", "document", body)(
    S, { admin: true },
    () => Promise.resolve(answer ?? { status: 500, body: {} }),
    () => {}, (m: string) => toasts.push(m), document,
  ) as { card: (v: unknown) => string; send: (pa: unknown) => void };
  return { S, toasts, asked, ...fns };
}

describe("«Сообщение клиенту» — the thread on the card", () => {
  it("draws the letters already exchanged on this order, oldest first", () => {
    const p = panel();
    p.S.orderMsgs = [msg(1, "in", "Где моя посылка?"), msg(2, "out", "Посылка уйдёт завтра.")];
    p.S.orderMsgsFor = ORDER.id;
    const html = p.card(VIEW);
    expect(html, "the thread S.orderMsgs holds is not on the card").toContain("Где моя посылка?");
    expect(html).toContain("Посылка уйдёт завтра.");
    expect(html.indexOf("Где моя посылка?")).toBeLessThan(html.indexOf("Посылка уйдёт завтра."));
    // who wrote which, each its own node for the dictionary
    expect(html).toContain("<span>Клиент написал</span>");
    expect(html).toContain("<span>Вы написали</span>");
    // …and above the box the next letter is typed into
    expect(html.indexOf("Посылка уйдёт завтра.")).toBeLessThan(html.indexOf("data-orderreplydraft"));
  });

  it("keeps the customer's words as text, never markup", () => {
    const p = panel();
    p.S.orderMsgs = [msg(1, "in", '<img src=x onerror="alert(1)">')];
    p.S.orderMsgsFor = ORDER.id;
    const html = p.card(VIEW);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("draws no thread that belongs to another order, and nothing while there is none", () => {
    const p = panel();
    expect(p.card(VIEW)).not.toContain("Переписка");
    // …but its place is kept, hidden: the card is patched node by node in
    // order, and a block appearing above the two boxes would take their text
    expect(p.card(VIEW)).toContain("<div data-ordermsgs hidden></div>");
    p.S.orderMsgs = [msg(1, "out", "Письмо другому заказу", "another-order")];
    p.S.orderMsgsFor = "another-order";
    expect(p.card(VIEW)).not.toContain("Письмо другому заказу");
    p.S.orderMsgs = [];
    p.S.orderMsgsFor = ORDER.id;
    expect(p.card(VIEW)).not.toContain("Переписка");
  });

  it("after «Отправить» the card shows the question and the letter that went", async () => {
    const thread = [msg(1, "in", "Можно ли забрать самому?"), msg(2, "out", "Да, в салоне с 10 до 18.")];
    const p = panel({ status: 200, body: { ok: true, messageId: "re_1", messages: thread } });
    p.send({ id: ORDER.id, number: ORDER.number, reply: "Да, в салоне с 10 до 18.", customerMessage: "Можно ли забрать самому?" });
    await flush();
    expect(p.toasts).toEqual(["Письмо отправлено ✓"]);
    const html = p.card(VIEW);
    expect(html, "the letter just sent is not on the card").toContain("Да, в салоне с 10 до 18.");
    expect(html).toContain("Можно ли забрать самому?");
    // …and the question left its box, so the next letter does not file it twice
    expect(p.asked.value).toBe("");
  });

  it("keeps the pasted question in its box when the letter did not go", async () => {
    const p = panel({ status: 502, body: { ok: false, error: "send_failed" } });
    p.send({ id: ORDER.id, number: ORDER.number, reply: "Да.", customerMessage: "Можно ли забрать самому?" });
    await flush();
    expect(p.toasts).toEqual(["Не удалось отправить письмо"]);
    expect(p.asked.value).toBe("Можно ли забрать самому?");
  });
});
