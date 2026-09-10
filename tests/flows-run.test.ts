/**
 * The birthday letter's window, and «Запустить сейчас» (Dim, 10.09.2026:
 * «I added my birthday … but have not gotten any birthday email»).
 *
 * What is pinned here:
 *   · the job looks at every day from today up to the birthday: a run the
 *     cron missed, or a date typed after the morning run, is caught up on
 *     any later day — up to and including the birthday, never after it;
 *   · one letter per birthday however many of those days the job runs on;
 *   · the New Year and 29 February neither lose a letter nor double one;
 *   · a send the mail layer skipped (no key) leaves the customer owed;
 *   · POST /api/admin/flows/run/ runs the daily job's own function, records
 *     the run in settings.flow_runs, and refuses strangers and unknown flows;
 *   · the cron records its runs the same way.
 *
 * Real Postgres (PGlite), Resend stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { birthdayWindow, getFlowRuns, runBirthdays, runFlows } from "@/lib/flows";
import { setSetting } from "@/lib/orders";
import { adminCookieHeader, makeRequest, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
let restoreEnv: () => void = () => {};

/** Every letter Resend was asked to send since the last reset — recipients only. */
const sent: string[] = [];
function mockResend(): void {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string[] };
    sent.push(...body.to);
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

let n = 0;
/** A customer with the tick and a date of birth. */
async function customer(birthday: string, stampedYear: number | null = null): Promise<string> {
  n += 1;
  const rows = await query<{ id: string }>(
    `insert into customers (email, name, lang, birthday, marketing, birthday_sent_year)
     values ($1, 'Тест', 'RU', $2, true, $3) returning id`,
    [`bd-${n}-${Date.now()}@example.com`, birthday, stampedYear],
  );
  return rows[0].id;
}
async function sentYear(id: string): Promise<number | null> {
  const rows = await query<{ y: number | string | null }>("select birthday_sent_year as y from customers where id = $1", [id]);
  return rows[0].y == null ? null : Number(rows[0].y);
}
/** When the newest birthday code stops working, in epoch milliseconds. */
async function newestCodeExpiry(): Promise<number> {
  const rows = await query<{ ends_at: string | Date }>(
    "select ends_at from promo_codes where code like 'REM-BD-%' order by created_at desc limit 1",
  );
  expect(rows.length, "no birthday code was written").toBe(1);
  return new Date(rows[0].ends_at).getTime();
}

beforeAll(async () => {
  restoreEnv = setFuzzEnv();
  await setupDb();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
});
afterAll(async () => {
  await teardownDb();
  restoreEnv();
});
beforeEach(async () => {
  await truncateAll();
  await query("delete from customers");
  await query("delete from promo_codes");
  await query("delete from mail_optouts");
  sent.length = 0;
  process.env.RESEND_API_KEY = "re_test_key";
  mockResend();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- the window, as a list of days --------------------------------- */

describe("birthdayWindow()", () => {
  it("is the day itself with «в день рождения», and today plus N days otherwise", () => {
    const mar11 = Date.UTC(2026, 2, 11, 9, 0, 0);
    expect(birthdayWindow(mar11, 0)).toEqual([{ mmdd: 311, year: 2026, ahead: 0 }]);
    expect(birthdayWindow(mar11, 3).map((d) => [d.mmdd, d.ahead])).toEqual([[311, 0], [312, 1], [313, 2], [314, 3]]);
  });

  it("carries the year of each day across the New Year", () => {
    const days = birthdayWindow(Date.UTC(2026, 11, 30, 9, 0, 0), 3);
    expect(days.map((d) => [d.mmdd, d.year])).toEqual([[1230, 2026], [1231, 2026], [101, 2027], [102, 2027]]);
  });

  it("puts 29 February on the 28th in a year that has no 29th, and nowhere else", () => {
    // 2027 is not a leap year: the 28th stands in for the 29th
    const plain = birthdayWindow(Date.UTC(2027, 1, 27, 9, 0, 0), 2);
    expect(plain.map((d) => d.mmdd)).toEqual([227, 228, 229, 301]);
    expect(plain.find((d) => d.mmdd === 229)?.ahead).toBe(1);
    // 2028 has a 29th of its own
    const leap = birthdayWindow(Date.UTC(2028, 1, 27, 9, 0, 0), 2);
    expect(leap.map((d) => d.mmdd)).toEqual([227, 228, 229]);
  });
});

/* ---------- the run ------------------------------------------------------- */

describe("runBirthdays() — the tolerant window", () => {
  const MAR11 = Date.UTC(2026, 2, 11, 9, 0, 0);

  it("greets on the day the job was set for, three days early", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 3 });
    const id = await customer("1990-03-14");
    const run = await runBirthdays(MAR11);
    expect(run.sent).toBe(1);
    expect(await sentYear(id)).toBe(2026);
    // fourteen days from the birthday itself: 17 from today
    expect(await newestCodeExpiry()).toBe(MAR11 + 17 * DAY);
  });

  it("catches up on a day the cron missed — and gives the code its full fortnight from the birthday", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 3 });
    const id = await customer("1990-03-14");
    // the 11th never ran; the 12th does
    const run = await runBirthdays(MAR11 + DAY);
    expect(run.sent).toBe(1);
    expect(await sentYear(id)).toBe(2026);
    expect(await newestCodeExpiry()).toBe(MAR11 + DAY + 16 * DAY);
  });

  it("greets on the birthday itself when every earlier day was missed, and never the day after", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 3 });
    const late = await customer("1990-03-14");
    expect((await runBirthdays(MAR11 + 3 * DAY)).sent).toBe(1);
    expect(await sentYear(late)).toBe(2026);
    expect(await newestCodeExpiry()).toBe(MAR11 + 3 * DAY + 14 * DAY);

    const missed = await customer("1990-03-13");
    // the 15th: the 13th is behind us, the 14th too — a greeting after the day is not one
    const run = await runBirthdays(MAR11 + 4 * DAY);
    expect(run.sent).toBe(0);
    expect(await sentYear(missed)).toBeNull();
  });

  it("with «в день рождения» the window is the day and nothing else", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 0 });
    const id = await customer("1990-03-14");
    expect((await runBirthdays(MAR11 + 2 * DAY)).sent).toBe(0); // the 13th
    expect((await runBirthdays(MAR11 + 3 * DAY)).sent).toBe(1); // the 14th
    expect((await runBirthdays(MAR11 + 4 * DAY)).sent).toBe(0); // the 15th
    expect(await sentYear(id)).toBe(2026);
    expect(sent).toHaveLength(1);
  });

  it("sends one letter however many of the window's days the job runs on", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 3 });
    await customer("1990-03-14");
    for (let i = 0; i <= 3; i += 1) await runBirthdays(MAR11 + i * DAY);
    await runBirthdays(MAR11 + DAY + 3600_000); // twice on one day, an hour apart
    expect(sent).toHaveLength(1);
  });

  it("crosses the New Year without losing or doubling a letter", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 3 });
    const DEC30 = Date.UTC(2026, 11, 30, 9, 0, 0);
    const jan2 = await customer("1990-01-02");
    const jan2Last = await customer("1991-01-02", 2026); // greeted last January — due again
    const dec31 = await customer("1990-12-31");
    const dec31Done = await customer("1991-12-31", 2026); // greeted three days ago

    const run = await runBirthdays(DEC30);
    expect(run.sent).toBe(3);
    expect(await sentYear(jan2)).toBe(2027);
    expect(await sentYear(jan2Last)).toBe(2027);
    expect(await sentYear(dec31)).toBe(2026);
    expect(await sentYear(dec31Done)).toBe(2026);
    // …and the next days send nothing more to any of them
    expect((await runBirthdays(DEC30 + DAY)).sent).toBe(0);
    expect((await runBirthdays(DEC30 + 3 * DAY)).sent).toBe(0);
  });

  it("greets a 29 February birthday on the 28th in a plain year, on the 29th in a leap year — once either way", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 3 });
    const leapling = await customer("1992-02-29");
    const feb28 = await customer("1990-02-28");

    // 2027 has no 29th: both are greeted in the window that holds the 28th
    const run27 = await runBirthdays(Date.UTC(2027, 1, 26, 9, 0, 0));
    expect(run27.sent).toBe(2);
    expect(await sentYear(leapling)).toBe(2027);
    expect(await sentYear(feb28)).toBe(2027);
    expect((await runBirthdays(Date.UTC(2027, 1, 28, 9, 0, 0))).sent).toBe(0);
    expect((await runBirthdays(Date.UTC(2027, 2, 1, 9, 0, 0))).sent).toBe(0);

    // 2028 has a 29th: «в день рождения» greets the leapling on it
    await setSetting("flows", { birthday: true, birthdayDays: 0 });
    expect((await runBirthdays(Date.UTC(2028, 1, 28, 9, 0, 0))).sent).toBe(1); // feb28's own day
    expect((await runBirthdays(Date.UTC(2028, 1, 29, 9, 0, 0))).sent).toBe(1); // the leapling's
    expect(await sentYear(leapling)).toBe(2028);
    expect(sent).toHaveLength(4);
  });

  it("a send the mail layer skipped leaves the customer owed, and a later run pays the debt", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 0 });
    const id = await customer("1990-03-14");
    delete process.env.RESEND_API_KEY;
    const dry = await runBirthdays(MAR11 + 3 * DAY);
    expect(dry.sent).toBe(0);
    expect(dry.skipped).toBe(1);
    expect(dry.reason).toBe("no_api_key");
    // not stamped: nothing reached anybody
    expect(await sentYear(id)).toBeNull();

    process.env.RESEND_API_KEY = "re_test_key";
    const wet = await runBirthdays(MAR11 + 3 * DAY + 3600_000);
    expect(wet.sent).toBe(1);
    expect(await sentYear(id)).toBe(2026);
  });
});

/* ---------- «Запустить сейчас» ------------------------------------------- */

describe("POST /api/admin/flows/run/", () => {
  async function run(body: unknown, cookie: string | null = adminCookieHeader()) {
    const { POST } = await import("@/app/api/admin/flows/run/route");
    const res = await POST(makeRequest("/api/admin/flows/run/", { method: "POST", body, cookie: cookie ?? undefined }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("refuses without the admin cookie and with a flow it does not know", async () => {
    expect((await run({ flow: "birthday" }, null)).status).toBe(401);
    const bad = await run({ flow: "backstock" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("bad_flow");
    expect((await run({})).body.error).toBe("bad_flow");
    expect(await getFlowRuns()).toEqual({});
  });

  it("runs the letter's own function: the switch still decides, and the run is remembered", async () => {
    await setSetting("flows", { abandoned: false });
    const off = await run({ flow: "abandoned" });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ ok: true, flow: "abandoned", sent: 0, skipped: 0, reason: "disabled" });
    const runs = off.body.runs as Record<string, { by: string; reason?: string; at: string }>;
    expect(runs.abandoned.by).toBe("admin");
    expect(runs.abandoned.reason).toBe("disabled");
    expect(typeof runs.abandoned.at).toBe("string");
    expect((await getFlowRuns()).abandoned).toMatchObject({ by: "admin", sent: 0, reason: "disabled" });
  });

  it("sends today's birthday letter from the panel, once", async () => {
    await setSetting("flows", { birthday: true, birthdayDays: 0 });
    const today = new Date();
    const iso = `1990-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
    const id = await customer(iso);

    const first = await run({ flow: "birthday" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, flow: "birthday", sent: 1, skipped: 0 });
    expect(await sentYear(id)).toBe(today.getUTCFullYear());
    expect(sent).toHaveLength(1);

    // the button pressed twice is the cron run twice: nothing goes out again
    const again = await run({ flow: "birthday" });
    expect(again.body).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);
    const runs = await getFlowRuns();
    expect(runs.birthday).toMatchObject({ by: "admin", sent: 0 });
    expect(runs.abandoned).toBeUndefined();
  });

  it("the cron records its own runs on the same line", async () => {
    await setSetting("flows", { abandoned: true, birthday: false });
    const now = Date.UTC(2026, 8, 10, 7, 0, 0);
    await runFlows(now);
    const runs = await getFlowRuns();
    expect(runs.abandoned).toMatchObject({ by: "cron", sent: 0, skipped: 0, at: new Date(now).toISOString() });
    expect(runs.birthday).toMatchObject({ by: "cron", reason: "disabled" });
    expect(runs.backstock).toMatchObject({ by: "cron", reason: "disabled" });
    expect(runs.unpaid).toMatchObject({ by: "cron", reason: "disabled" });
  });
});
