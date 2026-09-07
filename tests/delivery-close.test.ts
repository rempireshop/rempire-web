/**
 * «Доставлен» closing itself (src/lib/delivery.ts) and «за N дней» on the
 * birthday letter (src/lib/flows.ts) — Dim's answers of 07.09.2026.
 *
 * Both are scheduled work that nobody watches, so what is proven here is the
 * off switch as much as the on one: a shop that has decided nothing must not
 * be closing orders or mailing people early on its own.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { cleanDelivery, closeDeliveredOrders, looksDelivered, MAX_AUTO_DAYS } from "@/lib/delivery";
import { BIRTHDAY_MAX_DAYS, FLOW_DEFAULTS, getFlows, runBirthdays } from "@/lib/flows";
import { setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/** A `shipped` order, last touched `agoDays` ago. */
async function shippedOrder(agoDays: number, montonio?: Record<string, unknown>): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into orders (email, name, status, shipping, updated_at)
     values ($1, $2, 'shipped', $3::jsonb, now() - ($4 || ' days')::interval)
     returning id`,
    ["buyer@example.com", "Тест", JSON.stringify(montonio ? { method: "parcel", montonio } : { method: "parcel" }), String(agoDays)],
  );
  return rows[0].id;
}
async function statusOf(id: string): Promise<string> {
  const rows = await query<{ status: string }>("select status from orders where id = $1", [id]);
  return rows[0].status;
}

describe("«Доставлен» without the button", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("is off by default — no days, nothing closed", async () => {
    const id = await shippedOrder(30);
    // useCarrier defaults on, but there is no Montonio record and no key here
    const run = await closeDeliveredOrders();
    expect(run.closed).toBe(0);
    expect(await statusOf(id)).toBe("shipped");
  });

  it("closes an order N days after «Отправлен» once the owner sets N", async () => {
    const old = await shippedOrder(9);
    const fresh = await shippedOrder(2);
    await setSetting("delivery", { autoDays: 7, useCarrier: false });

    const run = await closeDeliveredOrders();
    expect(run.closed).toBe(1);
    expect(await statusOf(old)).toBe("delivered");
    expect(await statusOf(fresh), "a parcel two days out was closed").toBe("shipped");
  });

  it("never touches an order that is not shipped", async () => {
    const paid = await query<{ id: string }>(
      "insert into orders (email, name, status) values ($1, $2, 'paid') returning id",
      ["b@example.com", "Тест"],
    );
    await setSetting("delivery", { autoDays: 1, useCarrier: false });
    await closeDeliveredOrders();
    expect(await statusOf(paid[0].id)).toBe("paid");
  });

  it("writes the close into the shop's log, as the shop rather than as the owner", async () => {
    const id = await shippedOrder(9);
    await setSetting("delivery", { autoDays: 7, useCarrier: false });
    await closeDeliveredOrders();
    const rows = await query<{ actor: string; action: string }>(
      "select actor, action from admin_audit where action = 'order.status'",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].actor).toBe("system");
    void id;
  });

  it("clamps the setting to something a parcel could plausibly take", () => {
    expect(cleanDelivery({ autoDays: 900 }).autoDays).toBe(MAX_AUTO_DAYS);
    expect(cleanDelivery({ autoDays: -3 }).autoDays).toBe(0);
    expect(cleanDelivery({ autoDays: "нет" }).autoDays).toBe(0);
    expect(cleanDelivery(null)).toEqual({ autoDays: 0, useCarrier: true });
    expect(cleanDelivery({ useCarrier: false }).useCarrier).toBe(false);
  });

  /* The carrier half. Montonio's shipping API does answer with a status
     (GET /shipments/<id>), but the vocabulary of that field is not in the
     reference we have — so anything unrecognised has to mean «not yet». */
  it("only reads a status it is sure about as «delivered»", () => {
    for (const yes of ["delivered", "DELIVERED", "Delivered", "completed", "picked_up", "picked up", "collected", "delivered_to_recipient"]) {
      expect(looksDelivered(yes), `${yes} should count as delivered`).toBe(true);
    }
    for (const no of ["", null, undefined, "registered", "pending", "in_transit", "ready", "returned", "cancelled", "failed", "не знаю"]) {
      expect(looksDelivered(no), `${String(no)} must not count as delivered`).toBe(false);
    }
  });
});

describe("«за N дней до дня рождения»", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  async function customerWithBirthday(iso: string): Promise<string> {
    const rows = await query<{ id: string }>(
      "insert into customers (email, name, lang, birthday, marketing) values ($1, $2, 'RU', $3, true) returning id",
      [`bd-${Math.random().toString(36).slice(2)}@example.com`, "Тест", iso],
    );
    return rows[0].id;
  }
  async function sentYear(id: string): Promise<number | null> {
    const rows = await query<{ y: number | null }>("select birthday_sent_year as y from customers where id = $1", [id]);
    return rows[0].y == null ? null : Number(rows[0].y);
  }

  it("defaults to the day itself, exactly as before", async () => {
    expect(FLOW_DEFAULTS.birthdayDays).toBe(0);
    expect((await getFlows()).birthdayDays).toBe(0);
  });

  it("clamps whatever the settings row holds", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 999 });
    expect((await getFlows()).birthdayDays).toBe(BIRTHDAY_MAX_DAYS);
    await setSetting("flows", { birthday: true, birthdayDays: -5 });
    expect((await getFlows()).birthdayDays).toBe(0);
    await setSetting("flows", { birthday: true, birthdayDays: "три" });
    expect((await getFlows()).birthdayDays).toBe(0);
  });

  it("with «за 3 дня» the letter goes out three days early and not on the day", async () => {
    // a fixed «now» so the test does not depend on today's date
    const now = Date.UTC(2026, 2, 11, 9, 0, 0); // 11 March
    const inThree = await customerWithBirthday("1990-03-14");
    const today = await customerWithBirthday("1990-03-11");
    await setSetting("flows", { birthday: true, birthdayDays: 3, birthdayCode: "REM-BD-TEST" });

    await runBirthdays(now);
    expect(await sentYear(inThree), "the birthday three days out was skipped").toBe(2026);
    expect(await sentYear(today), "today's birthday was greeted while «за 3 дня» is on").toBeNull();
  });

  it("stamps the birthday's own year, so a New Year crossing cannot send twice", async () => {
    const now = Date.UTC(2026, 11, 30, 9, 0, 0); // 30 December
    const jan = await customerWithBirthday("1990-01-02");
    await setSetting("flows", { birthday: true, birthdayDays: 3, birthdayCode: "REM-BD-TEST" });

    await runBirthdays(now);
    expect(await sentYear(jan), "the guard stamped the wrong year").toBe(2027);
    // …and the same run a day later sends nothing more
    const again = await runBirthdays(now + DAY);
    expect(again.sent).toBe(0);
  });

  it("still sends nothing at all while the switch is off", async () => {
    await customerWithBirthday("1990-03-14");
    await setSetting("flows", { birthday: false, birthdayDays: 3 });
    const run = await runBirthdays(Date.UTC(2026, 2, 11, 9, 0, 0));
    expect(run.reason).toBe("disabled");
    expect(run.sent).toBe(0);
  });
});
