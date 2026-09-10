/**
 * «Доставлен» closing itself (src/lib/delivery.ts) and «за N дней» on the
 * birthday letter (src/lib/flows.ts) — Dim's answers of 07.09.2026.
 *
 * Both are scheduled work that nobody watches, so what is proven here is the
 * off switch as much as the on one: a shop that has decided nothing must not
 * be closing orders or mailing people early on its own.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { cleanDelivery, closeDeliveredOrders, looksDelivered, looksReturned, MAX_AUTO_DAYS } from "@/lib/delivery";
import { BIRTHDAY_MAX_DAYS, FLOW_DEFAULTS, getFlows, runBirthdays } from "@/lib/flows";
import { setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

/* The one carrier call this module makes. Stubbed so a shipment status can be
   chosen per test; empty by default, which is what a shop with no Montonio key
   effectively sees. */
let carrierStatus = "";
vi.mock("@/lib/shipping/montonio", () => ({
  getMontonioShipment: async () => ({ status: carrierStatus }),
}));

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
  beforeEach(async () => { await truncateAll(); carrierStatus = ""; });

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

  /* An uncollected parcel comes BACK to the shop — Omniva holds it 4 days,
     SmartPosti and DPD 7, Posti in Finland 5, and then the carrier returns it
     to the sender address held in Montonio. Montonio calls that `returned`
     (docs.montonio.com, shipping v2). It is the one status the day-counter
     must not close over: the box is on Renat's desk, not the customer's. */
  it("knows a parcel that came back, and never calls it delivered", () => {
    for (const yes of ["returned", "RETURNED", "Returned", "return", "returning", "returned_to_sender", "return-to-sender"]) {
      expect(looksReturned(yes), `${yes} should count as returned`).toBe(true);
      expect(looksDelivered(yes), `${yes} must never read as delivered`).toBe(false);
    }
    for (const no of ["", null, undefined, "delivered", "in_transit", "awaiting_collection", "registered"]) {
      expect(looksReturned(no), `${String(no)} must not count as returned`).toBe(false);
    }
  });

  it("leaves a returned parcel open even when the day-counter says close it", async () => {
    /* The day rule alone would have closed this one: nine days shipped, the
       setting says one. The carrier says it came back, so it stays open and
       the run reports it. */
    carrierStatus = "returned";
    await setSetting("delivery", { autoDays: 1, useCarrier: false });
    const id = await shippedOrder(9, { shipmentId: "shp-returned" });
    const run = await closeDeliveredOrders();
    expect(run.returned, "the run should count the parcel that came back").toBe(1);
    expect(run.closed, "a returned parcel must not be closed as delivered").toBe(0);
    expect(await statusOf(id)).toBe("shipped");
  });

  it("still closes by the day rule when the carrier says nothing useful", async () => {
    carrierStatus = "inTransit";
    await setSetting("delivery", { autoDays: 1, useCarrier: false });
    const id = await shippedOrder(9, { shipmentId: "shp-normal" });
    const run = await closeDeliveredOrders();
    expect(run.returned ?? 0).toBe(0);
    expect(run.closed).toBe(1);
    expect(await statusOf(id)).toBe("delivered");
  });
});

describe("«за N дней до дня рождения»", () => {
  /* Mail answered, not sent: since 10.09.2026 a send the mail layer SKIPS
     (no RESEND_API_KEY) takes the year stamp off again — nothing reached
     anybody — so the stamps these tests read are only there when a letter
     really went out. A key and a stubbed Resend make every send real. */
  beforeAll(async () => {
    await setupDb();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_RETRY_DELAY_MS = "0";
  });
  afterAll(async () => {
    delete process.env.RESEND_API_KEY;
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

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
  /* truncateAll() leaves promo_codes and customers standing (they have no
     foreign key into the tables it names), so the head-start tests below wipe
     the codes themselves and pick a birthday no other test in this file uses.
     Otherwise «the newest code» is whichever test ran last. */
  async function clearPromos(): Promise<void> {
    await query("delete from promo_codes");
  }
  /** When the code this run wrote stops working, in epoch milliseconds. */
  async function issuedCodeExpiry(): Promise<number> {
    const rows = await query<{ ends_at: string | Date }>(
      "select ends_at from promo_codes where code like 'REM-BD-%' order by created_at desc limit 1",
    );
    expect(rows.length, "the run wrote no birthday code at all").toBe(1);
    return new Date(rows[0].ends_at).getTime();
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

  it("with «за 3 дня» the letter goes out three days early — and a birthday the window is closing on is not left out", async () => {
    // a fixed «now» so the test does not depend on today's date
    const now = Date.UTC(2026, 2, 11, 9, 0, 0); // 11 March
    const inThree = await customerWithBirthday("1990-03-14");
    const today = await customerWithBirthday("1990-03-11");
    const past = await customerWithBirthday("1990-03-10");
    await setSetting("flows", { birthday: true, birthdayDays: 3, birthdayCode: "REM-BD-TEST" });

    await runBirthdays(now);
    expect(await sentYear(inThree), "the birthday three days out was skipped").toBe(2026);
    /* Since 10.09.2026 the window is «today … the birthday», not one day:
       a customer whose earlier days the job missed (or who typed the date
       this morning) is greeted on the day itself rather than never. */
    expect(await sentYear(today), "today's birthday was skipped although its window is still open").toBe(2026);
    expect(await sentYear(past), "yesterday's birthday was greeted after the day").toBeNull();
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

  /* Dim, 08.09.2026. The code is written on the day the LETTER goes out, and
     it used to be given a flat fourteen days — so every day of head start was
     a day taken off the customer's fortnight, and «за 14 дней» handed him a
     code that died on his birthday, the one day it was bought for. The head
     start is added to the code's life now, so what the customer has is always
     the same: the birthday itself and a fortnight after it. */
  it("on the day itself the code still lives the plain two weeks", async () => {
    await clearPromos();
    const now = Date.UTC(2026, 5, 20, 9, 0, 0);       // 20 June, the birthday
    const id = await customerWithBirthday("1990-06-20");
    await setSetting("flows", { birthday: true, birthdayDays: 0 });

    await runBirthdays(now);
    expect(await sentYear(id)).toBe(2026);
    expect(await issuedCodeExpiry()).toBe(now + 14 * DAY);
  });

  it("«за 3 дня» gives the code back the three days the head start took", async () => {
    await clearPromos();
    const now = Date.UTC(2026, 6, 2, 9, 0, 0);        // 2 July, three days out
    const id = await customerWithBirthday("1990-07-05");
    await setSetting("flows", { birthday: true, birthdayDays: 3 });

    await runBirthdays(now);
    expect(await sentYear(id)).toBe(2026);
    const ends = await issuedCodeExpiry();
    expect(ends).toBe(now + 17 * DAY);
    // …which is the same fortnight measured from the birthday itself
    expect(ends - Date.UTC(2026, 6, 5, 9, 0, 0)).toBe(14 * DAY);
  });

  it("«за 14 дней» no longer hands out a code that expires on the birthday", async () => {
    await clearPromos();
    const now = Date.UTC(2026, 7, 9, 9, 0, 0);        // 9 August, a fortnight out
    const birthday = Date.UTC(2026, 7, 23, 9, 0, 0);
    const id = await customerWithBirthday("1990-08-23");
    await setSetting("flows", { birthday: true, birthdayDays: 14 });

    await runBirthdays(now);
    expect(await sentYear(id)).toBe(2026);
    const ends = await issuedCodeExpiry();
    // the case that started this: the old code expired exactly here
    expect(ends).toBeGreaterThan(birthday);
    expect(ends).toBe(now + 28 * DAY);
    expect(ends - birthday).toBe(14 * DAY);
  });
});
