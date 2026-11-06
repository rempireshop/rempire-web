/**
 * «Готов к выдаче» — a pickup order's own second step and letter (Dim,
 * 06.11.2026).
 *
 * «Заказ принят» tells every pickup customer «Мы напишем, когда заказ можно
 * будет забрать», and nothing ever wrote: R-100116 (01.11.2026) waited for
 * the letter, and the order card had no step that sent one. Now:
 *
 *   · the letter «Заказ готов к выдаче» — the items and the total, where to
 *     collect it, the salon's hours from Настройки → Контент, what to say at
 *     the counter — in three languages (src/emails/order-ready.ts);
 *   · it goes through the same `shipped` door a parcel uses
 *     (src/lib/ship-order.ts), so the press is held ten seconds, journalled
 *     and undone like «Отправлен»; a parcel still gets «Заказ отправлен»;
 *   · the nightly «Доставлен» sweep never closes a pickup order — it is on the
 *     salon shelf, not with a carrier (src/lib/delivery.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Which customer letter the move sends, counted where it would leave. */
const letters = vi.hoisted(() => ({ sent: [] as Array<{ kind: string; number: string }> }));
vi.mock("@/lib/mail-hooks", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    onOrderShipped: vi.fn(async (o: { number: string }) => {
      letters.sent.push({ kind: "shipped", number: o.number });
      return { ok: true };
    }),
    onOrderReady: vi.fn(async (o: { number: string }) => {
      letters.sent.push({ kind: "ready", number: o.number });
      return { ok: true };
    }),
  };
});
vi.mock("@/lib/push", () => ({
  sendPush: async () => ({ ok: true, configured: true, devices: 0, sent: 0, failed: 0, gone: 0 }),
}));
vi.mock("@/lib/shipping/montonio", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getMontonioShipment: async () => ({ status: "" }) };
});

import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits as resetAuthLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { closeDeliveredOrders } from "@/lib/delivery";
import { letterClock, lettersSettled } from "@/lib/letter-hold";
import { setSetting } from "@/lib/orders";
import { resetRateLimits } from "@/lib/payments/ratelimit";
import { isPickupOrder } from "@/lib/ship-order";
import { renderDemo, TEMPLATE_IDS, TEMPLATE_LABELS } from "@/emails";
import { brandHours, setBrandOverride } from "@/emails/layout";
import { renderSample } from "@/emails/samples";
import { MAIL_TEXT_TEMPLATES } from "@/emails/texts";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* ---------- the letter ------------------------------------------------------ */

describe("«Заказ готов к выдаче» — the letter", () => {
  afterEach(() => setBrandOverride(null));

  it("is a letter of its own, in «Письма» and in the owner's editable texts", () => {
    expect(TEMPLATE_IDS).toContain("order-ready");
    expect(TEMPLATE_LABELS["order-ready"]).toBe("Заказ готов к выдаче");
    expect(MAIL_TEXT_TEMPLATES).toContain("order-ready");
  });

  it("says the order is ready, lists what was bought, where to collect it and when", () => {
    const ru = renderSample("order-ready", "ru");
    expect(ru.subject).toBe("Заказ R-100073 готов к выдаче — Rempire");
    for (const part of [ru.html, ru.text]) {
      expect(part.toLowerCase()).toContain("заказ готов к выдаче");
      expect(part).toContain("Состав заказа");
      expect(part).toContain("Где забрать");
      expect(part).toContain("Mardi 1");
      expect(part).toContain("Часы работы: Вт–Сб 10:00–19:00");
      expect(part).toContain("Назовите номер заказа R-100073");
    }
    // the items, with the sum — the lines «Заказ принят» shows
    const confirmed = renderSample("order-confirmed", "ru");
    const firstItem = /Kevin\.Murphy[^<\n]*/.exec(confirmed.text)?.[0] ?? "";
    expect(firstItem, "the sample order has a Kevin.Murphy line").not.toBe("");
    expect(ru.text).toContain(firstItem);
    expect(ru.text).toMatch(/Итого/i);
  });

  it("speaks Estonian and English with no Russian left in the shop's own words", () => {
    const et = renderSample("order-ready", "et");
    expect(et.subject).toBe("Tellimus R-100073 on järeletulekuks valmis — Rempire");
    expect(et.text).toContain("Lahtiolekuajad: T–L 10:00–19:00");
    expect(et.text).toContain("Kust kätte saada");
    const en = renderSample("order-ready", "en");
    expect(en.subject).toBe("Order R-100073 is ready for pickup — Rempire");
    expect(en.text).toContain("Opening hours: Tue–Sat 10:00–19:00");
    expect(en.text).toContain("Where to collect");
    for (const m of [et, en]) expect(m.text.replace(/Мария|Тамм/g, ""), "Cyrillic in an ET/EN letter").not.toMatch(/[А-Яа-яЁё]/);
  });

  it("the admin preview renders it from the demo pickup order", () => {
    const m = renderDemo("order-ready", "ru");
    expect(m.html).toContain("Заказ готов к выдаче");
    expect(m.text).toContain("Kevin.Murphy Fresh.Hair");
  });

  it("prints the open days in one line, and no hours line when none are set", () => {
    setBrandOverride({ hours: { mon: "closed", tue: "10:00–19:00", wed: "10:00–19:00", thu: "10:00–19:00", fri: "10:00–19:00", sat: "10:00–19:00", sun: "closed" } });
    expect(brandHours("ru")).toBe("Вт–Сб 10:00–19:00");
    setBrandOverride({ hours: { mon: "10:00–19:00", tue: "10:00–19:00", wed: "", thu: "11:00–16:00", fri: "closed", sat: "12:00–15:00", sun: "12:00–15:00" } });
    expect(brandHours("ru")).toBe("Пн–Вт 10:00–19:00 · Чт 11:00–16:00 · Сб–Вс 12:00–15:00");
    expect(brandHours("en")).toBe("Mon–Tue 10:00–19:00 · Thu 11:00–16:00 · Sat–Sun 12:00–15:00");
    setBrandOverride(null);
    expect(brandHours("ru")).toBe("");
    expect(renderDemo("order-ready", "ru").text).not.toContain("Часы работы");
  });
});

/* ---------- the step -------------------------------------------------------- */

let seq = 0;
async function orderOf(method: "pickup" | "parcel", status = "paid"): Promise<{ id: string; number: string }> {
  seq += 1;
  const number = `R-7100${String(seq).padStart(2, "0")}`;
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, status, shipping)
     values ($1, 'buyer@example.com', 'Irina Test', $2, $3::jsonb) returning id`,
    [number, status, JSON.stringify({ method, country: "EE" })],
  );
  return { id: rows[0].id, number };
}
const statusOf = async (id: string) => (await query<{ status: string }>("select status from orders where id = $1", [id]))[0].status;

async function press(id: string, status: string) {
  const { PATCH } = await import("@/app/api/admin/orders/[id]/route");
  const res = await PATCH(
    new Request(`https://rempireshop.com/api/admin/orders/${id}/`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `${ADMIN_COOKIE}=${makeSessionToken()}` },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id }) },
  );
  await lettersSettled();
  return res.status;
}

describe("«Готов к выдаче» on the order card", () => {
  const realSleep = letterClock.sleep;
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(async () => {
    letterClock.sleep = realSleep;
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    resetRateLimits();
    resetAuthLimits();
    letters.sent.length = 0;
    letterClock.sleep = async () => {};
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(async () => {
    await lettersSettled();
    vi.restoreAllMocks();
  });

  it("knows a pickup order by its stored method", () => {
    expect(isPickupOrder({ shipping: { method: "pickup" } } as never)).toBe(true);
    expect(isPickupOrder({ shipping: { method: "Pickup " } } as never)).toBe(true);
    expect(isPickupOrder({ shipping: { method: "parcel", pointType: "pickup_point" } } as never)).toBe(false);
    expect(isPickupOrder({ shipping: null } as never)).toBe(false);
  });

  it("a pickup order: «Заказ готов к выдаче», once — never the tracking letter", async () => {
    const o = await orderOf("pickup");
    expect(await press(o.id, "shipped")).toBe(200);
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.sent).toEqual([{ kind: "ready", number: o.number }]);
    // a second press finds it ready already: nothing more goes
    expect(await press(o.id, "shipped")).toBe(200);
    expect(letters.sent).toHaveLength(1);
    // «Выдан клиенту» closes it and sends nothing
    expect(await press(o.id, "delivered")).toBe(200);
    expect(await statusOf(o.id)).toBe("delivered");
    expect(letters.sent).toHaveLength(1);
  });

  it("a parcel still gets «Заказ отправлен»", async () => {
    const o = await orderOf("parcel");
    expect(await press(o.id, "shipped")).toBe(200);
    expect(letters.sent).toEqual([{ kind: "shipped", number: o.number }]);
  });

  it("the nightly «Доставлен» sweep leaves a ready pickup order on the shelf", async () => {
    const pickup = await orderOf("pickup", "shipped");
    const parcel = await orderOf("parcel", "shipped");
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await query(`update orders set shipping = shipping || jsonb_build_object('shippedAt', $1::text)`, [monthAgo]);
    await setSetting("delivery", { autoDays: 7, useCarrier: false });
    const run = await closeDeliveredOrders();
    expect(run.closed).toBe(1);
    expect(await statusOf(parcel.id)).toBe("delivered");
    expect(await statusOf(pickup.id), "a pickup order closed by the day rule").toBe("shipped");
  });
});
