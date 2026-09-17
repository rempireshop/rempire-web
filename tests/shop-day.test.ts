/**
 * Which day an order belongs to — src/lib/day.ts, and every figure built on it.
 *
 * The rule: **a day is the calendar day in Europe/Tallinn, and a month is the
 * Estonian calendar month.** The shop is in Tallinn, its owner reads the
 * numbers in Tallinn, and the accountant's month has to match the month the
 * Estonian calendar has.
 *
 * The point of this file is the second half of that rule: the naming is done
 * in the code, so **the database's own timezone setting does not matter.**
 * Every DB-backed case below is run with the session's `TimeZone` set to UTC
 * (the deployment), to Europe/Tallinn (a dev box, a restored dump), and to
 * Pacific/Kiritimati (UTC+14, deliberately absurd) — and all three have to
 * give the same, Tallinn-correct answer. That is what a single call site's
 * test cannot catch: a future reader who reaches for `date_trunc('day', …)`
 * or `.toISOString().slice(0, 10)` again will pass their own test on a UTC
 * database and fail this one.
 *
 * Every timestamp below is written as the UTC instant with the Tallinn wall
 * clock it corresponds to spelled out beside it, so the test states the zone
 * it assumes instead of inheriting the machine's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { getAnalyticsSummary, getOverviewSummary, rangeBounds, startOfShopDay, toShipOrders } from "@/lib/analytics";
import { addShopDays, shopDay, shopDayStart, shopMonth, SHOP_TZ } from "@/lib/day";
import { exec, query } from "@/lib/db";
import { createOrder } from "@/lib/orders";
import { listReportOrders, monthRange } from "@/lib/reports";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const productA = (catalogueMin as Min[]).filter((p) => p.s === "in")[0];
const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

async function paidOrderAt(at: string) {
  const o = await createOrder({
    lang: "ru",
    items: [{ id: productA.id, qty: 1 }],
    customer,
    shipping: { method: "parcel", country: "EE" },
  });
  await query("update orders set status = 'paid', created_at = $2, updated_at = $2 where id = $1", [o.id, at]);
  return o;
}

/** The zones a shop's database might plausibly — or implausibly — be set to. */
const SESSION_ZONES = ["UTC", "Europe/Tallinn", "Pacific/Kiritimati"] as const;
async function setSessionZone(tz: string) {
  await exec(`set time zone '${tz}'`);
}

describe("the day rule (src/lib/day.ts), with no database", () => {
  it("names the Tallinn calendar day, not the UTC one, for an Estonian evening", () => {
    // 21:02 in Tallinn on 12 September is 18:02 UTC the same day — both agree here
    expect(shopDay(new Date("2026-09-12T18:02:00Z"))).toBe("2026-09-12");
    // …but 00:30 in Tallinn on 13 September is still 21:30 UTC on the 12th, and
    // THAT is the hour the old rule got wrong: the shop's day had turned over.
    expect(shopDay(new Date("2026-09-12T21:30:00Z"))).toBe("2026-09-13");
    // one minute before Tallinn midnight is still the 12th
    expect(shopDay(new Date("2026-09-12T20:59:00Z"))).toBe("2026-09-12");
  });

  it("follows EET/EEST — the boundary is +03:00 in summer and +02:00 in winter", () => {
    // summer (EEST, UTC+3): Tallinn midnight of 1 July is 30 June 21:00 UTC
    expect(shopDayStart("2026-07-01").toISOString()).toBe("2026-06-30T21:00:00.000Z");
    // winter (EET, UTC+2): Tallinn midnight of 1 January is 31 December 22:00 UTC
    expect(shopDayStart("2026-01-01").toISOString()).toBe("2025-12-31T22:00:00.000Z");
    // the day the clocks go forward (last Sunday of March) still starts at 22:00 the evening before
    expect(shopDayStart("2026-03-29").toISOString()).toBe("2026-03-28T22:00:00.000Z");
    // and the day after it starts an hour "earlier" in UTC — the offset has changed
    expect(shopDayStart("2026-03-30").toISOString()).toBe("2026-03-29T21:00:00.000Z");
    // the day the clocks go back (last Sunday of October)
    expect(shopDayStart("2026-10-25").toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(shopDayStart("2026-10-26").toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("steps by calendar days, so a 23- or 25-hour day is neither skipped nor named twice", () => {
    // 25 October 2026 is 25 hours long in Tallinn; +24h from its midnight is
    // still the 25th, which is why nothing here counts in milliseconds.
    expect(addShopDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addShopDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addShopDays("2026-03-28", 1)).toBe("2026-03-29"); // the 23-hour day
    expect(addShopDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addShopDays("2026-12-31", 1)).toBe("2027-01-01"); // and over the New Year
    expect(addShopDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("puts an Estonian evening in the Estonian month, not the previous one", () => {
    // 01:00 on 1 September in Tallinn is 22:00 UTC on 31 August — September,
    // and it is exactly this hour the accountant's export used to file under
    // the month before.
    expect(shopMonth(new Date("2026-08-31T22:00:00Z"))).toBe("2026-09");
    expect(shopDay(new Date("2026-08-31T22:00:00Z"))).toBe("2026-09-01");
    // and 23:00 on 31 August is still August
    expect(shopMonth(new Date("2026-08-31T20:00:00Z"))).toBe("2026-08");
  });

  it("«сегодня» starts at Tallinn midnight — the same instant rangeBounds(\"today\") uses", () => {
    const now = new Date("2026-09-13T00:30:00Z"); // 03:30 in Tallinn, a new day there
    expect(startOfShopDay(now).toISOString()).toBe("2026-09-12T21:00:00.000Z");
    expect(rangeBounds("today", now).from.toISOString()).toBe("2026-09-12T21:00:00.000Z");
    // the previous period is the previous day, exactly as long
    const t = rangeBounds("today", now);
    expect(t.prevTo.getTime()).toBe(t.from.getTime());
    expect(t.to.getTime() - t.from.getTime()).toBe(t.from.getTime() - t.prevFrom.getTime());
  });

  it("gives back «» for a time that is not one, instead of «Invalid Date»", () => {
    expect(shopDay(null)).toBe("");
    expect(shopDay("не дата")).toBe("");
    expect(shopDay(undefined)).toBe("");
    expect(addShopDays("13.09.2026", 1)).toBe(""); // not the shape, so not a date
    expect(Number.isNaN(shopDayStart("nope").getTime())).toBe(true);
    expect(SHOP_TZ).toBe("Europe/Tallinn");
  });
});

describe("every day-shaped figure, with the database set to three different zones", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(async () => {
    await setSessionZone("UTC");
    await teardownDb();
  });
  beforeEach(async () => {
    await exec("truncate orders, settings restart identity cascade");
  });
  afterEach(async () => {
    await setSessionZone("UTC");
  });

  /* The order the other agent reproduced with: placed in the evening, Tallinn
     time. `date_trunc('day', created_at)` cut it in the database's own zone and
     isoDay() then printed that instant in UTC, so at UTC+3 it came back a day
     early. Now: 21:02 on 13 September in Tallinn = 18:02 UTC. */
  const EVENING = "2026-09-13T18:02:00Z";
  /* The harder one, and the one the live UTC deployment got wrong too: 00:30
     on 13 September in Tallinn, which is 21:30 UTC on the 12th. */
  const AFTER_MIDNIGHT = "2026-09-12T21:30:00Z";
  const NOW = new Date("2026-09-13T20:00:00Z"); // 23:00 in Tallinn, still the 13th

  for (const tz of SESSION_ZONES) {
    describe(`database session at ${tz}`, () => {
      it("«Аналитика» dates an evening order to the day it was placed in Tallinn", async () => {
        await setSessionZone(tz);
        await paidOrderAt(EVENING);
        const a = await getAnalyticsSummary("7d", NOW);
        expect(a.revenueByDay.map((r) => r.day)).toEqual(["2026-09-13"]);
      });

      it("«Аналитика» dates an order from the small hours to the NEW Tallinn day", async () => {
        await setSessionZone(tz);
        await paidOrderAt(AFTER_MIDNIGHT);
        const a = await getAnalyticsSummary("7d", NOW);
        // 21:30 UTC on the 12th is half past midnight on the 13th where the shop is
        expect(a.revenueByDay.map((r) => r.day)).toEqual(["2026-09-13"]);
      });

      it("the seven bars on «Обзор» carry the same Tallinn days, and «сегодня» counts them", async () => {
        await setSessionZone(tz);
        await paidOrderAt(EVENING);
        await paidOrderAt(AFTER_MIDNIGHT);
        const o = await getOverviewSummary(NOW);
        expect(o.revenueByDay.map((r) => r.day)).toEqual(["2026-09-13"]);
        expect(o.revenueByDay[0].orders).toBe(2);
        // both were placed on the 13th in Tallinn, so both are «сегодня»
        expect(o.orders).toEqual({ today: 2, yesterday: 0 });
      });

      it("the parcel queue the assistant reads dates a waiting order the same way", async () => {
        await setSessionZone(tz);
        await paidOrderAt(AFTER_MIDNIGHT);
        const q = await toShipOrders(10);
        expect(q.total).toBe(1);
        expect(q.rows.map((r) => r.at)).toEqual(["2026-09-13"]);
      });

      it("the accountant's row is dated on the Estonian calendar", async () => {
        await setSessionZone(tz);
        await paidOrderAt(EVENING);
        await paidOrderAt(AFTER_MIDNIGHT);
        const range = monthRange("2026-09")!;
        const rows = await listReportOrders(range.from, range.to);
        expect(rows.map((r) => r.date)).toEqual(["2026-09-13", "2026-09-13"]);
      });

      it("the month filter keeps the first hours of a month in that month", async () => {
        await setSessionZone(tz);
        // 01:00 on 1 September in Tallinn — September, however early it is
        const first = await paidOrderAt("2026-08-31T22:00:00Z");
        // 23:00 on 31 August in Tallinn — August, not September
        const last = await paidOrderAt("2026-08-31T20:00:00Z");
        // 01:00 on 1 October in Tallinn — October, not September
        const next = await paidOrderAt("2026-09-30T22:00:00Z");

        const sep = monthRange("2026-09")!;
        const sepRows = await listReportOrders(sep.from, sep.to);
        expect(sepRows.map((r) => r.number)).toEqual([first.number]);
        expect(sepRows[0].date).toBe("2026-09-01");

        const aug = monthRange("2026-08")!;
        const augRows = await listReportOrders(aug.from, aug.to);
        expect(augRows.map((r) => r.number)).toEqual([last.number]);
        expect(augRows[0].date).toBe("2026-08-31");

        const oct = monthRange("2026-10")!;
        const octRows = await listReportOrders(oct.from, oct.to);
        expect(octRows.map((r) => r.number)).toEqual([next.number]);
        expect(octRows[0].date).toBe("2026-10-01");
      });
    });
  }

  it("gives the very same answers at UTC as at UTC+3 — the database's zone is not a setting anyone has to get right", async () => {
    const seed = async () => {
      await exec("truncate orders restart identity cascade");
      await paidOrderAt(EVENING);
      await paidOrderAt(AFTER_MIDNIGHT);
      await paidOrderAt("2026-08-31T22:00:00Z");
    };
    const read = async () => {
      const a = await getAnalyticsSummary("7d", NOW);
      const o = await getOverviewSummary(NOW);
      const sep = monthRange("2026-09")!;
      const rows = await listReportOrders(sep.from, sep.to);
      return JSON.stringify({
        byDay: a.revenueByDay.map((r) => [r.day, r.orders]),
        bars: o.revenueByDay.map((r) => [r.day, r.orders]),
        today: o.orders,
        // the dates only: `truncate … restart identity` does not rewind the
        // order-number counter, so the numbers differ between the three passes
        // while the days — the thing under test — must not.
        report: rows.map((r) => r.date),
      });
    };

    await setSessionZone("UTC");
    await seed();
    const atUtc = await read();

    await setSessionZone("Europe/Tallinn");
    await seed();
    const atTallinn = await read();

    await setSessionZone("Pacific/Kiritimati");
    await seed();
    const atKiritimati = await read();

    expect(atTallinn).toBe(atUtc);
    expect(atKiritimati).toBe(atUtc);
    // and the answer they agree on is the shop's own calendar, not Greenwich's
    expect(atUtc).toContain('["2026-09-13",2]');
    expect(atUtc).toContain('"report":["2026-09-01","2026-09-13","2026-09-13"]');
  });
});

/* ==========================================================================
 * The panel's half of the same rule.
 *
 * «Обзор» draws seven slots and drops the server's rows into the one whose
 * key matches. If the two sides name days differently the bars shift, so the
 * panel's admShopDay()/admShopDayAdd() are pinned to shopDay()/addShopDays()
 * here. Sliced out of public/shop2/app.js by source text rather than retyped,
 * the way tests/admin-toship.test.ts does it — retyping would test this file
 * instead of the panel, and the slice fails loudly the day app.js renames one.
 * ========================================================================== */

describe("public/shop2/app.js names the same days the server does", () => {
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

  const panel = new Function(
    `${slice("admShopDay")}
${slice("admShopDayAdd")}
return { admShopDay: admShopDay, admShopDayAdd: admShopDayAdd };`,
  )() as { admShopDay: (d: Date) => string; admShopDayAdd: (ymd: string, n: number) => string };

  it("names an instant the same day the server's shopDay() does", () => {
    for (const iso of [
      "2026-09-13T18:02:00Z", // 21:02 Tallinn
      "2026-09-12T21:30:00Z", // 00:30 Tallinn on the 13th
      "2026-09-12T20:59:00Z", // 23:59 Tallinn on the 12th
      "2026-01-01T22:30:00Z", // winter, EET
      "2026-08-31T22:00:00Z", // the first hour of September, Tallinn
    ]) {
      expect(panel.admShopDay(new Date(iso))).toBe(shopDay(new Date(iso)));
    }
  });

  it("steps back through the week the same way addShopDays() does", () => {
    for (const day of ["2026-10-26", "2026-03-30", "2027-01-02", "2026-09-13"]) {
      for (let back = 0; back <= 6; back += 1) {
        expect(panel.admShopDayAdd(day, -back)).toBe(addShopDays(day, -back));
      }
    }
  });

  it("lays the seven slots out over seven distinct, consecutive days", () => {
    // the 25-hour Sunday sits in this week: stepping in milliseconds would
    // name a day twice and draw one bar over another
    const today = "2026-10-26";
    const keys = [6, 5, 4, 3, 2, 1, 0].map((back) => panel.admShopDayAdd(today, -back));
    expect(keys).toEqual([
      "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
    ]);
    expect(new Set(keys).size).toBe(7);
  });
});
