/**
 * The customer card: an approval keeps what is on the card, and a number
 * typed on one customer's card does not turn up on the next one.
 *
 * Two holes in public/shop2/app.js (admin-functions map, defect 17,
 * 24.09.2026):
 *
 *   · «Одобрить Pro» / «Отказать» answered with the customer's row, and
 *     admCustPatch() rebuilt the card from it as `{ customer, history }` —
 *     throwing away the orders, the facts and the reviews the card's own GET
 *     had brought. The card went back to grey bars under «Заказы» and «Отзывы
 *     клиента», and lost its four facts, until the refetch landed: the
 *     «whole card turned into a skeleton» the tier switch was fixed for on
 *     13.09.2026, still there on the approval beside it.
 *   · The points form («Баллы — можно отрицательное число», «Заметка — за
 *     что») and the note's «Сохранено ✓» live in S, shared by every card, and
 *     opening another customer reset only the private note's draft. «50» and
 *     «извинение за задержку» typed for one customer and not applied stood
 *     ready on the next one's «Применить».
 *
 * The functions and the click handler's `data-admcustopen` branch are cut out
 * of app.js by source text and run over stubs.
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

const ORDER = { id: "o1", number: "R-100042", createdAt: "2026-09-10T10:00:00.000Z", total: 48, status: "paid", itemsCount: 1, firstItem: "Davines — OI Oil", channel: "web", labeled: false, invoice: null };
const REVIEW = { id: "r1", productId: "p1", product: "Davines — OI Oil", rating: 5, text: "Отлично", status: "pending", createdAt: "2026-09-11T10:00:00.000Z", name: "Mart" };
const STATS = { firstOrderAt: ORDER.createdAt, lastOrderAt: ORDER.createdAt, avgOrder: 48, topBrands: [{ brand: "Davines", spent: 48 }] };

function panel() {
  const calls: Array<[string, ...unknown[]]> = [];
  const log = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const S: Record<string, unknown> = {
    admCustOpen: "c1",
    admCustDetail: {
      customer: { id: "c1", email: "mart@example.com", tier: "retail", proRequestedAt: "2026-09-12T10:00:00.000Z" },
      history: [{ delta: 10, reason: "adjust", at: "2026-09-12T10:00:00.000Z" }],
      orders: [ORDER], stats: STATS, reviews: [REVIEW],
    },
  };
  const body = `
    function esc(s) { return String(s == null ? "" : s); }
    function shortDate(iso) { return String(iso).slice(0, 10); }
    function eur(n) { return n + " €"; }
    function admSecHeadHTML(t) { return "<h>" + t + "</h>"; }
    function admCustOrderRowHTML(o) { return "<order>" + o.number + "</order>"; }
    function admCustReviewRowHTML(r) { return "<review>" + r.text + "</review>"; }
    ${slice("mergeInto")}
    ${slice("admCustAdopt")}
    ${slice("custSend")}
    ${slice("admCustPatch")}
    ${slice("admCustFact")}
    ${slice("admCustFactsHTML")}
    ${slice("admCustOrdersHTML")}
    ${slice("admCustReviewsHTML")}
    function open(d) { ${block("if (d.admcustopen) {")} }
    return {
      approve: function (id) { admCustPatch(id, { action: "approve" }, "Партнёр одобрен · письмо ушло"); },
      open: function (id) { open({ admcustopen: id }); },
      sections: function () { var d = S.admCustDetail; return admCustFactsHTML(d) + admCustOrdersHTML(d) + admCustReviewsHTML(d); },
    };
  `;
  const fns = new Function("S", "SRV", "apiSend", "loadAdminCustomerDetail", "loadAdminCustomers", "toast", "render", "window", body)(
    S, { admin: true },
    // the PATCH answers with the row of whoever it was sent for: /api/admin/customers/<id>/
    (url: string) => Promise.resolve({ status: 200, body: { ok: true, customer: { id: url.split("/")[4], email: "mart@example.com", tier: "pro", proRequestedAt: null }, mail: { sent: true } } }),
    log("loadAdminCustomerDetail"), log("loadAdminCustomers"), log("toast"), log("render"), { scrollTo() {} },
  ) as { approve: (id: string) => void; open: (id: string) => void; sections: () => string };
  return { S, calls, ...fns };
}

describe("«Одобрить Pro» on the customer card", () => {
  it("keeps the orders, the facts and the reviews on screen while the card is asked again", async () => {
    const p = panel();
    p.approve("c1");
    await flush();
    const d = p.S.admCustDetail as Record<string, unknown>;
    expect((d.customer as { tier: string }).tier, "the answer's row is not on the card").toBe("pro");
    expect(d.orders, "the orders went back to grey bars").toEqual([ORDER]);
    expect(d.stats).toEqual(STATS);
    expect(d.reviews).toEqual([REVIEW]);
    expect(d.history).toHaveLength(1);
    const html = p.sections();
    expect(html, "the card drew skeleton bars after the approval").not.toContain("adm-skel");
    expect(html).toContain("<order>R-100042</order>");
    expect(html).toContain("<review>Отлично</review>");
    expect(html).toContain("Средний чек");
    // …and the fresh copy is still asked for, as before
    expect(p.calls).toContainEqual(["loadAdminCustomerDetail", "c1", true]);
  });

  /* 1a: an answer is sent ten seconds after it is pressed (q3), so it can
     land while the owner is on ANOTHER card — approved from the list, then
     c1 opened. That card stays c1's, whole; the answer goes to c9's row. */
  it("does not hand one customer's card to another", async () => {
    const p = panel();
    p.S.admCustomers = [{ id: "c9", email: "c9@example.com", tier: "retail", proRequestedAt: "2026-09-20T10:00:00.000Z", ordersCount: 3 }];
    p.approve("c9");   // approved from the list, while c1's card is what S holds
    await flush();
    const d = p.S.admCustDetail as Record<string, unknown>;
    expect((d.customer as { id: string }).id, "c9's row was put on c1's card").toBe("c1");
    expect(d.orders, "c1's card lost its orders to c9's answer").toEqual([ORDER]);
    expect(d.history).toHaveLength(1);
    expect(p.calls, "c1's card was asked again for c9's answer").not.toContainEqual(["loadAdminCustomerDetail", "c9", true]);
    // …and the list's row took the answer, its order count kept
    const row = (p.S.admCustomers as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ id: "c9", tier: "pro", ordersCount: 3 });
  });
});

describe("Opening another customer's card", () => {
  it("starts the points form empty, with no refusal left under it", () => {
    const p = panel();
    p.S.admCustPoints = "50";
    p.S.admCustNote = "извинение за задержку";
    p.S.admCustPtsErr = "Впишите число баллов — можно с минусом";
    p.S.admCustNotesDraft = "постоянный клиент";
    p.open("c2");
    expect(p.S.admCustOpen).toBe("c2");
    expect(p.S.admCustPoints, "the number typed on the last card is on this one's button").toBe("");
    expect(p.S.admCustNote).toBe("");
    expect(p.S.admCustPtsErr, "the last card's «Впишите число…» stands under this one's box").toBe("");
    // the note is re-read from the card that opens; what the last one owed goes under its own key
    expect(p.S.admCustNotesDraft).toBeNull();
  });
});
