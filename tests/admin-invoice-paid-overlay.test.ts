/**
 * «Отметить оплаченным» → «Оплачен»: the confirm card goes when it is answered.
 *
 * The «Применить» handler clears the pending action and hands the invoice to
 * srvInvoicePaid(), which drew nothing until the server had answered — and on
 * success only the lists it asked for drew anything at all. So the card sat on
 * screen for the length of the POST and of the list reload behind it, with a
 * «Оплачен» that no longer had anything behind it; after a refusal («Заказ
 * отменён — оплату не отметить», a dead network) it stayed for good under the
 * toast (admin-functions map, defect 10, 24.09.2026). The refund card beside
 * it has always drawn at once (SRV.refundBusy).
 *
 * The handler's «Применить» branch and srvInvoicePaid() are cut out of app.js
 * by source text and driven against a network the test answers by hand.
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

const flush = () => new Promise((r) => setTimeout(r, 0));

type Answer = { status: number; body: Record<string, unknown> };

const ROW = { id: "ord-7", number: "R-100077", invoice: { number: "A-2026-0007" }, unpaid: true };

function panel() {
  const calls: Array<{ url: string; body: unknown; answer: (a: Answer) => void; fail: () => void }> = [];
  const toasts: string[] = [];
  const SRV: Record<string, unknown> = { admin: true };
  /* what the screen shows: whether the confirm card is still drawn, and what
     the order's own button says — both read at every render() */
  const painted: Array<{ card: boolean; button: string }> = [];
  let changed = 0;
  const body = `
    var pendingAction = null;
    function esc(s) { return String(s == null ? "" : s); }
    function journalNote() {}
    function admOrdersChanged() { onChanged(); }
    ${slice("admInvPaidBtnHTML")}
    ${slice("srvInvoicePaid")}
    function apply(d) { ${block("if (d.admapply !== undefined) {")} }
    function render() { onPaint({ card: !!(pendingAction && pendingAction.overlay), button: admInvPaidBtnHTML(ROW, "adm-btn") }); }
    return {
      open: function () {
        pendingAction = { type: "invoice_paid", overlay: true, id: ROW.id, number: ROW.number, invoice: ROW.invoice.number,
          title: "Отметить оплаченным?", detail: "", ok: "Оплачен" };
        render();
      },
      apply: function () { apply({ admapply: "" }); },
      button: function () { return admInvPaidBtnHTML(ROW, "adm-btn adm-btn--row"); },
    };
  `;
  const fns = new Function("S", "SRV", "ROW", "apiSend", "toast", "onPaint", "onChanged", body)(
    { lang: "RU" }, SRV, ROW,
    (url: string, _m: string, b: unknown) => new Promise<Answer>((resolve, reject) => {
      calls.push({ url, body: b, answer: resolve, fail: () => reject(new Error("offline")) });
    }),
    (m: string) => toasts.push(m),
    (p: { card: boolean; button: string }) => painted.push(p),
    () => { changed++; },
  ) as { open: () => void; apply: () => void; button: () => string };
  return { ...fns, SRV, calls, toasts, painted, changed: () => changed };
}

describe("«Оплачен» on the invoice card", () => {
  it("takes the card down at once, and the order's button says «Сохраняем…» while the POST is out", () => {
    const p = panel();
    p.open();
    p.apply();
    expect(p.calls.map((c) => c.url)).toEqual(["/api/admin/orders/ord-7/invoice/"]);
    const last = p.painted.at(-1)!;
    expect(last.card, "the confirm card is still drawn over a button with nothing behind it").toBe(false);
    expect(last.button).toContain(" disabled>Сохраняем…</button>");
    expect(p.button()).toContain('data-adminvpaid="ord-7" disabled>Сохраняем…');
  });

  it("a refusal says why and gives the button back", async () => {
    const p = panel();
    p.open();
    p.apply();
    p.calls[0].answer({ status: 409, body: { ok: false, error: "order_closed" } });
    await flush();
    expect(p.toasts).toEqual(["Заказ отменён — оплату не отметить"]);
    const last = p.painted.at(-1)!;
    expect(last.card).toBe(false);
    expect(last.button, "the button stayed «Сохраняем…» after the answer").toContain(">Отметить оплаченным</button>");
    expect(last.button).not.toContain("disabled");
  });

  it("a dead network does the same", async () => {
    const p = panel();
    p.open();
    p.apply();
    p.calls[0].fail();
    await flush();
    expect(p.toasts).toEqual(["Сервер не отвечает"]);
    expect(p.painted.at(-1)!.button).toContain(">Отметить оплаченным</button>");
  });

  it("success reads the server's answer and reloads the lists", async () => {
    const p = panel();
    p.open();
    p.apply();
    p.calls[0].answer({ status: 200, body: { ok: true, sent: true } });
    await flush();
    expect(p.toasts).toEqual(["R-100077 оплачен по счёту · письмо ушло"]);
    expect(p.changed()).toBe(1);
    expect(p.SRV.invPaidBusy).toBe("");
  });

  it("asks once, however often it is asked while the POST is out", () => {
    const p = panel();
    p.open();
    p.apply();
    p.open();
    p.apply();
    expect(p.calls).toHaveLength(1);
    // …and the second card goes too, rather than staying up with nothing behind it
    expect(p.painted.at(-1)!.card).toBe(false);
  });
});
