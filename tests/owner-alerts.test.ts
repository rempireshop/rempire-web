/**
 * The owner's alerts — readiness pass of 27.09.2026, B11 (golive
 * «webhook-alarm»).
 *
 * Until now the one thing that reached Renat's phone was a PAID order. A
 * refund Montonio could not pay or cancelled, a payment only the nightly check
 * found, a short payment, a parcel the carrier refused by webhook or sent back
 * — each got a journal row and nothing else. src/lib/owner-alerts.ts turns
 * those journal rows into the same ping a paid order gets (push, Telegram, the
 * shop's letter as the fallback), once per event, never throwing.
 *
 * What is tested is what he meets:
 *   · the words — what happened and what to do, short enough for a lock
 *     screen, and the tap opening that order's card;
 *   · once: a retried webhook, the second of two rows about one refund, the
 *     nightly job seeing the same order again — one ping;
 *   · the door is the journal: writeAudit() hands the rows over, so the
 *     payment and parcel webhooks alert without being told to;
 *   · never throws, and says so when nothing could take it; at most
 *     OWNER_ALERT_HOURLY_CAP an hour.
 *
 * Real Postgres (PGlite); the push is mocked (the phone «took it» or not),
 * Resend and Telegram are stubbed where a test needs them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, query } from "@/lib/db";
import { OWNER_ALERT_ACTION, writeAuditSafe, type Order } from "@/lib/orders";
import {
  alertForJournal,
  OWNER_ALERT_ACTIONS,
  OWNER_ALERT_HOURLY_CAP,
  sendOwnerAlert,
  type OwnerAlert,
} from "@/lib/owner-alerts";
import { applyShipmentUpdate } from "@/lib/shipping/shipment-sync";
import { setupDb, teardownDb, truncateAll } from "./helpers";

/* The phone. `ok` — whether a device took it; `sent` — what arrived. */
const push = vi.hoisted(() => ({
  ok: true,
  throws: false,
  sent: [] as Array<{ title: string; body: string; url?: string; tag?: string }>,
}));
vi.mock("@/lib/push", () => ({
  sendPush: async (msg: { title: string; body: string; url?: string; tag?: string }) => {
    if (push.throws) throw new Error("web-push missing");
    push.sent.push(msg);
    return { ok: push.ok, configured: true, devices: 1, sent: push.ok ? 1 : 0, failed: push.ok ? 0 : 1, gone: 0 };
  },
}));

const ENV = ["RESEND_API_KEY", "RESEND_TO", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "PUBLIC_BASE_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  await setupDb();
});
afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await teardownDb();
});
beforeEach(async () => {
  for (const k of ENV) delete process.env[k];
  await truncateAll();
  await exec("truncate owner_alerts");
  push.ok = true;
  push.throws = false;
  push.sent.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ORDER = { orderId: "11111111-1111-4111-8111-111111111111", number: "R-100050" };
const alertRows = () =>
  query<{ key: string; kind: string; number: string; delivered: boolean | null; note: string | null }>(
    "select key, kind, number, delivered, note from owner_alerts order by at, key",
  );

/* ---------- which journal rows, and the door ------------------------------ */

describe("the door is the journal", () => {
  it("writeAudit() hands over exactly the actions owner-alerts.ts reads — the two lists agree", () => {
    const names = [...OWNER_ALERT_ACTION.source.matchAll(/(order|shipment)\\\.\(([^)]*)\)/g)].flatMap((m) =>
      m[2].split("|").map((x) => `${m[1]}.${x}`),
    );
    expect(names.sort()).toEqual([...OWNER_ALERT_ACTIONS].sort());
    for (const quiet of ["order.status", "order.refund_pending", "shipment.status", "shipment.create", "shipment.repair", "admin.login"]) {
      expect(OWNER_ALERT_ACTION.test(quiet), quiet).toBe(false);
    }
  });
});

/* ---------- the words ----------------------------------------------------- */

describe("what each alert says", () => {
  const read = (action: string, payload: Record<string, unknown>, actor = "system", id = 7) =>
    alertForJournal({ id, actor, action, payload: { ...ORDER, ...payload } });

  it("a refund Montonio cannot fund yet: not with the customer, Montonio pays it from new sales, no transfer while it waits (Montonio, 29.09.2026)", () => {
    const a = read("order.refund_stuck", { amount: 25, ref: "rf-1", code: "INSUFFICIENT_FUNDS", status: "pending" })!;
    expect(a.kind).toBe("refund_stuck");
    expect(a.title).toBe("⚠️ Возврат ещё не дошёл: R-100050");
    expect(a.body).toBe(
      "25 € ещё не у покупателя: на счёте магазина в Montonio не хватило денег. Montonio вернёт сам из новых оплат, ждёт до 10 дней. Пока ждёт — не переводите сами, уйдёт дважды.",
    );
    // the long sentence of the order card goes to Telegram and the letter
    expect(a.detail).toContain("На счёте магазина в Montonio не хватило денег");
  });

  it("a refund Montonio cancelled: the money is still the shop's, and what to do about it", () => {
    const a = read("order.refund_stuck", { amount: 25, ref: "rf-2", code: "EXPIRED", status: "failed" })!;
    expect(a.kind).toBe("refund_cancelled");
    expect(a.title).toBe("⚠️ Возврат отменён: R-100050");
    expect(a.body).toBe("Montonio отменил возврат 25 €: Montonio ждал 10 дней. Деньги остались у магазина — верните их переводом со счёта магазина (IBAN: оплата банком — в Montonio, картой — у покупателя) и нажмите «Отметить возврат (без денег)».");
    // the ledger's own row about the same refund is the same alert
    const b = read("order.refund", { amount: 25, ref: "rf-2", status: "failed" }, "webhook")!;
    expect(b.key).toBe(a.key);
    expect(b.body).toBe("Montonio отменил возврат 25 € — деньги остались у магазина. Откройте заказ и верните их заново или переводом.");
  });

  it("a refund that simply worked, or is merely under way, is no news", () => {
    expect(read("order.refund_stuck", { amount: 25, ref: "rf-3", code: "OTHER", status: "done" })).toBeNull();
    expect(read("order.refund", { amount: 25, ref: "rf-3", status: "done" }, "webhook")).toBeNull();
    expect(read("order.refund", { amount: 25, ref: "rf-3", status: "pending" }, "admin")).toBeNull();
  });

  it("«Вернуть деньги» refused: stays in the shade after the toast is gone — one per press", () => {
    const a = read("order.refund_failed", { amount: 19.9, error: "provider_rejected", detail: "Refund amount exceeds" }, "admin", 41)!;
    expect(a.title).toBe("⚠️ Возврат не прошёл: R-100050");
    expect(a.body).toBe("Montonio отказал в возврате 19,90 € — деньги не ушли. Откройте заказ: причина в «Настройки → Журнал».");
    expect(a.detail).toBe("Montonio: Refund amount exceeds");
    expect(read("order.refund_failed", { amount: 19.9 }, "admin", 42)!.key).not.toBe(a.key);
  });

  it("a payment only the nightly check found: the webhook is what failed", () => {
    const a = read("order.payment_recovered", { amount: 45, ref: "uuid", montonioStatus: "PAID" })!;
    expect(a.title).toBe("⚠️ Оплату нашла ночная проверка: R-100050");
    expect(a.body).toBe(
      "Уведомление Montonio об оплате 45 € не дошло. Заказ уже «Оплачен» — отправьте его как обычно. Если такое повторится, напишите Диму.",
    );
    expect(a.key).toBe("payment_recovered:R-100050");
  });

  it("a short payment, and the other two things only a human can end", () => {
    expect(read("order.payment_held", { reason: "underpaid", expected: 25, got: 20, paidCurrency: "EUR" })!.body).toBe(
      "Пришло 20 € из 25 € — заказ придержан. Проверьте платёж в Montonio и откройте заказ.",
    );
    expect(read("order.payment_held", { reason: "currency", expected: 25, got: 25, paidCurrency: "USD" })!.body).toContain("другой валюте (USD)");
    expect(read("order.payment_odd", { montonioStatus: "REFUNDED" })!.body).toBe(
      "В Montonio заказ «REFUNDED», а в магазине он не оплачен. Проверьте заказ в Montonio.",
    );
  });

  it("a carrier refusal that arrived by itself — not one answered to the owner's own press, not a repeat", () => {
    const a = read("shipment.registration_failed", { shipmentId: "shp-1", code: "registrationFailed" })!;
    expect(a.title).toBe("📦 Перевозчик не принял посылку: R-100050");
    expect(a.body).toBe(
      "Этикетки нет. Откройте заказ и нажмите «Отправить заново»; не пройдёт снова — проверьте телефон и адрес покупателя.",
    );
    expect(read("shipment.registration_failed", { shipmentId: "shp-1" }, "admin")).toBeNull();
    expect(read("shipment.registration_failed", { shipmentId: "shp-1", repeat: true })).toBeNull();
  });

  it("a parcel on its way back: whose carrier, and what to do", () => {
    const a = read("shipment.returned", { shipmentId: "shp-9", carrier: "omniva", code: "returned" })!;
    expect(a.title).toBe("📦 Посылка возвращается: R-100050");
    expect(a.body).toBe(
      "Omniva: покупатель не забрал посылку, она едет обратно в магазин. Свяжитесь с покупателем — отправить заново или вернуть деньги.",
    );
    expect(read("shipment.returned", { shipmentId: "shp-9" })!.body.startsWith("Покупатель не забрал")).toBe(true);
    expect(a.key).toBe("shipment_returned:shp-9");
  });

  /* 28.09.2026: the carrier's scan ships a paid order by itself — and on a
     cancelled or refunded one moves nothing and says so, once per parcel. */
  it("a parcel moving on a closed order: which kind of closed, and that the status was left alone", () => {
    const c = read("shipment.closed_moving", { shipmentId: "shp-9", carrier: "dpd", code: "inTransit", orderStatus: "cancelled" })!;
    expect(c.title).toBe("📦 Посылка едет по отменённому заказу: R-100050");
    expect(c.body).toBe("DPD принял посылку, а заказ отменён. Статус магазин не менял. Свяжитесь с покупателем и решите, что делать с посылкой.");
    expect(c.key).toBe("shipment_closed_moving:shp-9");
    const r = read("shipment.closed_moving", { shipmentId: "shp-9", orderStatus: "refunded" })!;
    expect(r.title).toBe("📦 Посылка едет по заказу с возвратом денег: R-100050");
    expect(r.body.startsWith("Перевозчик принял посылку, а заказ уже с возвратом денег.")).toBe(true);
    // the same parcel, told twice (the webhook, then the next word): one key
    expect(r.key).toBe(c.key);
  });

  it("everything fits a lock screen: the push service's 100 and 300 characters", () => {
    const rows: Array<[string, Record<string, unknown>, string?]> = [
      ["order.refund_stuck", { amount: 1234.56, ref: "r", code: "SOMETHING_MONTONIO_NEVER_DOCUMENTED", status: "pending" }],
      ["order.refund_stuck", { amount: 1234.56, ref: "r", code: "LOST_OR_STOLEN_CARD", status: "failed" }],
      ["order.refund", { amount: 1234.56, ref: "r", status: "failed" }, "webhook"],
      ["order.refund_failed", { amount: 1234.56 }, "admin"],
      ["order.payment_recovered", { amount: 1234.56 }],
      ["order.payment_held", { reason: "underpaid", expected: 1234.56, got: 1000 }],
      ["order.payment_odd", { montonioStatus: "PARTIALLY_REFUNDED" }],
      ["shipment.registration_failed", { shipmentId: "x" }],
      ["shipment.returned", { shipmentId: "x", carrier: "smartpost" }],
      ["shipment.closed_moving", { shipmentId: "x", carrier: "smartpost", orderStatus: "refunded" }],
    ];
    for (const [action, payload, actor] of rows) {
      const a = read(action, payload, actor)!;
      expect(a, action).not.toBeNull();
      expect(a.title.length, action).toBeLessThanOrEqual(100);
      expect(a.body.length, action).toBeLessThanOrEqual(300);
    }
  });

  it("a row with no order on it raises nothing", () => {
    expect(alertForJournal({ actor: "system", action: "order.payment_recovered", payload: {} })).toBeNull();
    expect(alertForJournal({ actor: "system", action: "order.status", payload: ORDER })).toBeNull();
  });
});

/* ---------- through the journal, once -------------------------------------- */

describe("sent through the journal, once", () => {
  it("a journal row pings the phone: the words, the order's card on tap, its own line in the shade", async () => {
    process.env.PUBLIC_BASE_URL = "https://test.rempireshop.com";
    await writeAuditSafe("system", "order.refund_stuck", {
      ...ORDER, amount: 25, ref: "rf-10", code: "INSUFFICIENT_FUNDS", status: "pending",
    });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toMatchObject({
      title: "⚠️ Возврат ещё не дошёл: R-100050",
      url: "/shop2/admin/?order=R-100050",
      tag: "alert:refund_stuck:rf-10:INSUFFICIENT_FUNDS",
    });
    // never the paid order's own line, which it would replace
    expect(push.sent[0].tag).not.toMatch(/^order:/);
    expect(await alertRows()).toEqual([
      { key: "refund_stuck:rf-10:INSUFFICIENT_FUNDS", kind: "refund_stuck", number: "R-100050", delivered: true, note: null },
    ]);
  });

  it("the same news again — a webhook retry — is a journal row and no second ping", async () => {
    const row = { ...ORDER, amount: 25, ref: "rf-11", code: "INSUFFICIENT_FUNDS", status: "pending" };
    await writeAuditSafe("system", "order.refund_stuck", row);
    await writeAuditSafe("system", "order.refund_stuck", row);
    expect(push.sent).toHaveLength(1);
    expect(await query("select 1 from admin_audit where action = 'order.refund_stuck'")).toHaveLength(2);
  });

  it("one cancelled refund, told twice (the explanation and the ledger), is one ping", async () => {
    await writeAuditSafe("system", "order.refund_stuck", { ...ORDER, amount: 25, ref: "rf-12", code: "DECLINED", status: "failed" });
    await writeAuditSafe("webhook", "order.refund", { ...ORDER, amount: 25, ref: "rf-12", status: "failed", repeat: true });
    expect(push.sent.map((m) => m.title)).toEqual(["⚠️ Возврат отменён: R-100050"]);
    expect(push.sent[0].body).toContain("банк покупателя отказал");
  });

  it("a PENDING refund that later fails pings for both — they are two different things", async () => {
    await writeAuditSafe("system", "order.refund_stuck", { ...ORDER, amount: 25, ref: "rf-13", code: "INSUFFICIENT_FUNDS", status: "pending" });
    // ten days on: the ledger folds CANCELED into the same id, so it is a `repeat` — and still news
    await writeAuditSafe("webhook", "order.refund", { ...ORDER, amount: 25, ref: "rf-13", status: "failed", repeat: true });
    expect(push.sent.map((m) => m.title)).toEqual(["⚠️ Возврат ещё не дошёл: R-100050", "⚠️ Возврат отменён: R-100050"]);
  });

  it("rows that are not alerts touch nothing", async () => {
    await writeAuditSafe("admin", "order.status", { ...ORDER, from: "paid", to: "shipped" });
    await writeAuditSafe("webhook", "order.refund", { ...ORDER, amount: 25, ref: "rf-14", status: "done" });
    expect(push.sent).toEqual([]);
    expect(await alertRows()).toEqual([]);
  });

  it("no phone took it: Telegram and the shop's letter, as for a paid order", async () => {
    push.ok = false;
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_TO = "shop@rempireshop.com";
    process.env.TELEGRAM_BOT_TOKEN = "tg";
    process.env.TELEGRAM_CHAT_ID = "42";
    process.env.PUBLIC_BASE_URL = "https://test.rempireshop.com";
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, id: "re_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await writeAuditSafe("system", "order.payment_recovered", { ...ORDER, amount: 45, montonioStatus: "PAID" });

    const tg = calls.find((c) => c.url.includes("api.telegram.org"));
    const mail = calls.find((c) => c.url.includes("api.resend.com"));
    expect(String(tg?.body.text)).toContain("⚠️ Оплату нашла ночная проверка: R-100050");
    expect(String(tg?.body.text)).toContain("Открыть в панели: https://test.rempireshop.com/shop2/admin/?order=R-100050");
    expect(mail?.body.subject).toBe("REMPIRE — Оплату нашла ночная проверка: R-100050");
    expect((await alertRows())[0].delivered).toBe(true);
  });

  it("nothing configured: nothing thrown, and the table says nobody was told", async () => {
    push.ok = false;
    await expect(
      writeAuditSafe("system", "order.payment_held", { ...ORDER, reason: "underpaid", expected: 25, got: 20 }),
    ).resolves.toBeUndefined();
    expect(await alertRows()).toMatchObject([{ kind: "payment_held", delivered: false }]);
  });

  it(`at most ${OWNER_ALERT_HOURLY_CAP} an hour — the rest are recorded, not sent`, async () => {
    for (let i = 0; i < OWNER_ALERT_HOURLY_CAP + 2; i++) {
      await writeAuditSafe("system", "order.payment_held", {
        orderId: `o-${i}`, number: `R-2000${String(i).padStart(2, "0")}`, reason: "underpaid", expected: 25, got: 20,
      });
    }
    expect(push.sent).toHaveLength(OWNER_ALERT_HOURLY_CAP);
    const rows = await alertRows();
    expect(rows).toHaveLength(OWNER_ALERT_HOURLY_CAP + 2);
    expect(rows.filter((r) => r.note === "capped")).toHaveLength(2);
  });
});

/* ---------- the parcel webhooks alert without being told to --------------- */

describe("the parcel news reaches the phone by itself", () => {
  let seq = 0;
  async function shippedOrder(montonio: Record<string, unknown>, status = "shipped"): Promise<{ order: Order; shipmentId: string }> {
    seq += 1;
    const shipmentId = `shp-alert-${seq}`;
    const rows = await query<{ id: string }>(
      `insert into orders (number, email, name, status, shipping)
       values ($1, 'buyer@example.com', 'Тест', $2, $3::jsonb) returning id`,
      [
        `R-3000${String(seq).padStart(2, "0")}`,
        status,
        JSON.stringify({ method: "parcel", country: "EE", montonio: { provider: "montonio", shipmentId, carrier: "omniva", status: "inTransit", ...montonio } }),
      ],
    );
    const { getOrder } = await import("@/lib/orders");
    return { order: (await getOrder(rows[0].id))!, shipmentId };
  }
  const reload = async (o: Order) => (await (await import("@/lib/orders")).getOrder(o.id))!;

  it("a carrier refusal by webhook pings once; its retry does not; a refusal after «Отправить заново» does", async () => {
    const { order, shipmentId } = await shippedOrder({ status: "pending" }, "paid");
    await applyShipmentUpdate(order, { status: "registrationFailed", shipmentId, event: "shipment.statusUpdated" }, { source: "webhook" });
    expect(push.sent.map((m) => m.title)).toEqual([`📦 Перевозчик не принял посылку: ${order.number}`]);

    // Montonio sends it again (the other event type, or a retry)
    await applyShipmentUpdate(await reload(order), { status: "registrationFailed", shipmentId, event: "shipment.registrationFailed" }, { source: "webhook" });
    expect(push.sent).toHaveLength(1);
    const rows = await query<{ payload: Record<string, unknown> }>(
      "select payload from admin_audit where action = 'shipment.registration_failed' order by id",
    );
    expect(rows.map((r) => r.payload.repeat ?? false)).toEqual([false, true]);

    // «Отправить заново» went through (the admin route writes shipment.repair and stores `pending`) …
    await writeAuditSafe("admin", "shipment.repair", { orderId: order.id, number: order.number, shipmentId });
    await query("update orders set shipping = jsonb_set(shipping, '{montonio,status}', '\"pending\"') where id = $1", [order.id]);
    // … and the carrier refuses again: that is news
    await applyShipmentUpdate(await reload(order), { status: "registrationFailed", shipmentId }, { source: "webhook" });
    expect(push.sent).toHaveLength(2);
  });

  it("an event that leaves the word at `pending` and the poll that then reads the refusal: one ping", async () => {
    const { order, shipmentId } = await shippedOrder({ status: "pending" }, "paid");
    await applyShipmentUpdate(order, { status: "pending", shipmentId, event: "shipment.registrationFailed" }, { source: "webhook" });
    await applyShipmentUpdate(await reload(order), { status: "registrationFailed", shipmentId }, { source: "poll" });
    expect(await query("select 1 from admin_audit where action = 'shipment.registration_failed'")).toHaveLength(2);
    expect(push.sent).toHaveLength(1);
  });

  it("the refusal answered to the owner's own press is on his screen already — no ping", async () => {
    await writeAuditSafe("admin", "shipment.registration_failed", { ...ORDER, shipmentId: "shp-press", code: "registrationFailed" });
    expect(push.sent).toEqual([]);
  });
});

/* ---------- never throws -------------------------------------------------- */

describe("never throws", () => {
  it("with the table gone it still sends (better twice than never) and says nothing to the caller", async () => {
    await exec("drop table owner_alerts");
    try {
      const alert: OwnerAlert = { key: "k-1", kind: "payment_odd", number: "R-1", title: "t", body: "b" };
      await expect(sendOwnerAlert(alert)).resolves.toEqual({ sent: true });
      await expect(
        writeAuditSafe("system", "order.payment_odd", { ...ORDER, montonioStatus: "REFUNDED" }),
      ).resolves.toBeUndefined();
      expect(push.sent).toHaveLength(2);
    } finally {
      const sql = readFileSync(fileURLToPath(new URL("../db/migrations/217_owner_alerts.sql", import.meta.url)), "utf8");
      await exec(sql);
    }
  });

  it("a push that throws is a channel that failed, not an error for the webhook", async () => {
    push.throws = true;
    await expect(
      writeAuditSafe("system", "shipment.returned", { ...ORDER, shipmentId: "shp-x", carrier: "dpd" }),
    ).resolves.toBeUndefined();
    expect(await alertRows()).toMatchObject([{ kind: "shipment_returned", delivered: false }]);
  });
});
