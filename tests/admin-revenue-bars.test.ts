/**
 * «Аналитика → Выручка по дням».
 *
 * qRevenueByDay() groups by day, so it returns ONLY the days that had an order.
 * The chart used to draw `rows.slice(-14)` straight: with three or four orders
 * a month that is three or four bars standing next to each other as if they
 * were consecutive days, under a lead that says «Один столбик — один день,
 * самый правый — сегодня» — and the rightmost one wore «сегодня» whatever day
 * it really was (audit). The «Обзор» strip has laid out a slot per day since
 * 14.09.2026; this asserts the fortnight chart does too.
 *
 * Sliced out of app.js by source text, like tests/admin-panel-truth.test.ts.
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

function sliceObject(name: string): string {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name} = {…}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1) + ";";
  }
  throw new Error(`unbalanced braces around var ${name} in app.js`);
}

/** Weekday names stood in for by their index, so this file asserts on the day and not on Russian. */
const WEEKDAYS = ["0", "1", "2", "3", "4", "5", "6"];

type Row = { day: string; revenue: number };
const bars = new Function(
  "ADM_WEEKDAYS",
  "eur",
  [sliceObject("ADM_BAR_DAYS"), slice("admShopDay"), slice("admShopDayAdd"), slice("admBarsHTML"), "return admBarsHTML;"].join("\n"),
)(WEEKDAYS, (n: number) => String(n)) as (rows: Row[], range: string) => string;

/** Today on the Tallinn calendar — the day the server names its rows by. */
function tallinnToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Tallinn", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function dayBefore(n: number): string {
  const d = new Date(`${tallinnToday()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Every bar's title, left to right — `title` is the money the bar stands for. */
function titles(html: string): string[] {
  return [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
}

describe("«Выручка по дням» draws the days, not the rows", () => {
  it("gives a day with no sale its own empty slot", () => {
    // two orders in a fortnight: nine days ago and the day before yesterday
    const html = bars([{ day: dayBefore(9), revenue: 100 }, { day: dayBefore(2), revenue: 50 }], "30d");
    const money = titles(html);
    expect(money, "a fortnight is fourteen bars, whatever the query returned").toHaveLength(14);
    expect(money[13 - 9]).toBe("100");
    expect(money[13 - 2]).toBe("50");
    expect(money.filter((m) => m === "0")).toHaveLength(12);
  });

  it("puts «сегодня» on today even when nothing was sold today", () => {
    const html = bars([{ day: dayBefore(5), revenue: 80 }], "30d");
    const now = [...html.matchAll(/class="adm-wbar([^"]*)"/g)].map((m) => m[1].includes("adm-wbar--now"));
    expect(now.filter(Boolean), "exactly one bar is today").toHaveLength(1);
    expect(now[now.length - 1], "and it is the rightmost one").toBe(true);
    expect(titles(html)[13], "today had no sale, so today's bar is empty").toBe("0");
  });

  it("draws the window the range asks for", () => {
    const row = [{ day: dayBefore(0), revenue: 10 }];
    expect(titles(bars(row, "today"))).toHaveLength(1);
    expect(titles(bars(row, "7d"))).toHaveLength(7);
    expect(titles(bars(row, "30d"))).toHaveLength(14);
    expect(titles(bars(row, "90d"))).toHaveLength(14);
  });

  it("names each bar's weekday from the day itself, not from the browser's zone", () => {
    const html = bars([{ day: dayBefore(0), revenue: 10 }], "7d");
    const labels = [...html.matchAll(/<span>(\d)<\/span>/g)].map((m) => Number(m[1]));
    expect(labels).toHaveLength(7);
    // seven consecutive days: each label is the next weekday, wrapping at 7
    for (let i = 1; i < labels.length; i++) expect(labels[i]).toBe((labels[i - 1] + 1) % 7);
    const todayUtcDay = new Date(`${tallinnToday()}T00:00:00.000Z`).getUTCDay();
    expect(labels[6], "the last bar is today").toBe(todayUtcDay);
  });

  it("scales the tallest bar to full height and keeps an empty day visible", () => {
    const html = bars([{ day: dayBefore(1), revenue: 200 }], "7d");
    expect(html).toContain("height:100%");
    expect(html).toContain("height:2%");
  });
});
