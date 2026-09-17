/**
 * Which day an instant belongs to — the one rule, in one place.
 *
 * **A day is the calendar day in Europe/Tallinn, and a month is the Estonian
 * calendar month.** The shop is in Tallinn, its owner reads the numbers in
 * Tallinn, and the accountant's month has to line up with the month the
 * Estonian calendar has. A boundary drawn at UTC midnight puts the last three
 * hours of every Estonian evening (two in winter) into the previous day — and
 * twice a year, on the 31st, into the previous MONTH, which is the figure an
 * accountant files.
 *
 * The naming is done HERE, explicitly, and never inherited:
 *
 * · not from the database session's `TimeZone`. `date_trunc('day', created_at)`
 *   cuts the day wherever the server happens to be set, and the value then has
 *   to be re-read in the same zone to mean anything — which is exactly what
 *   went wrong (see the git history of this file's first commit): the query
 *   truncated in the database's zone and the JS formatted the result in UTC,
 *   so on a database at UTC+3 an order placed at 21:02 was reported under the
 *   previous day. The SQL helper below says `at time zone 'Europe/Tallinn'`
 *   out loud and hands back TEXT, so nothing can re-interpret it afterwards.
 * · not from the server process's `TZ`. `new Date(…).toISOString()` is UTC and
 *   `getDate()`/`getMonth()` are whatever the host is set to; neither is the
 *   shop's calendar. Every day-shaped figure goes through shopDay() instead.
 *
 * The consequence worth writing down: **the database's own timezone setting
 * stops mattering.** The figures come out identical whether Postgres runs at
 * UTC (as the deployment does today), at Europe/Tallinn, or anywhere else —
 * so moving the shop to another provider, or restoring a dump onto a server
 * with a different `timezone =` in postgresql.conf, cannot silently move
 * money from one day, or one month, to another. Nothing has to be remembered.
 *
 * What is deliberately NOT here: timestamps the owner reads as a moment rather
 * than as a day — the change journal, the stock ledger, the last-run line
 * under a letter. Those travel as a full ISO instant and are formatted in the
 * READER's browser, which is the same Tallinn clock and needs no help from us.
 * Truncating them server-side would be the mistake, not the fix.
 */

/** The shop's calendar. One constant, used by the SQL and the JS alike. */
export const SHOP_TZ = "Europe/Tallinn";

/* ---------- SQL ------------------------------------------------------------
 * `at time zone` converts a timestamptz to the wall clock in that zone
 * (a plain `timestamp`), and to_char then prints it. Both steps are explicit,
 * so the result does not move when the session's TimeZone does — and because
 * it comes back as text rather than as a date/timestamp, no driver can parse
 * it into a Date and shift it back on the way out. */

/**
 * The Tallinn calendar day of a timestamptz column, as `YYYY-MM-DD` text —
 * for `select`, `group by` and `order by` alike.
 *
 *   `select ${shopDaySql("created_at")} as day … group by 1 order by 1`
 *
 * The column name is interpolated, so pass a column, never user input.
 */
export function shopDaySql(column: string): string {
  return `to_char(${column} at time zone '${SHOP_TZ}', 'YYYY-MM-DD')`;
}

/** The same for a month — `YYYY-MM`. */
export function shopMonthSql(column: string): string {
  return `to_char(${column} at time zone '${SHOP_TZ}', 'YYYY-MM')`;
}

/* ---------- JS -------------------------------------------------------------
 * Intl carries the IANA rules (EET/EEST, and the two switch-overs a year), so
 * nothing here has to know that Tallinn is +02:00 in January and +03:00 in
 * July. The catch blocks are for a runtime built without the full ICU data:
 * UTC is then the honest fallback, exactly as src/lib/invoices.ts has always
 * done it — wrong by up to three hours rather than throwing on a receipt. */

const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FIELDS_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function asDate(v: Date | string | number | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The Tallinn calendar day an instant falls in, as `YYYY-MM-DD`.
 * `""` for anything that is not a time — a missing column, a bad string —
 * so a caller can put it straight into a row without a second guard.
 */
export function shopDay(v: Date | string | number | null | undefined): string {
  const d = asDate(v);
  if (!d) return "";
  try {
    return DAY_FMT.format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** The Tallinn calendar month an instant falls in, as `YYYY-MM`. */
export function shopMonth(v: Date | string | number | null | undefined): string {
  return shopDay(v).slice(0, 7);
}

/** Tallinn's offset from UTC at a given instant, in milliseconds (+3 h in summer). */
function offsetMs(at: Date): number {
  let wall: number;
  try {
    const p: Record<string, string> = {};
    for (const part of FIELDS_FMT.formatToParts(at)) p[part.type] = part.value;
    const d = new Date(0);
    d.setUTCFullYear(Number(p.year), Number(p.month) - 1, Number(p.day));
    d.setUTCHours(Number(p.hour), Number(p.minute), Number(p.second), 0);
    wall = d.getTime();
  } catch {
    return 0;
  }
  // `at` carries milliseconds the formatted wall clock does not — drop them
  // from both sides so the difference is the offset and nothing else.
  return wall - (at.getTime() - at.getUTCMilliseconds());
}

/**
 * The instant Tallinn midnight of `ymd` happened — the lower bound of that
 * day, for a `created_at >= $1` that must not depend on the session's zone.
 * `Invalid Date` for anything that is not `YYYY-MM-DD`.
 *
 * Two passes: the first guess uses the offset in force at the same wall clock
 * read as UTC, the second the offset actually in force at that guess. That is
 * what makes the last Sunday of March and of October come out right instead of
 * an hour off.
 */
export function shopDayStart(ymd: string): Date {
  const m = YMD_RE.exec(String(ymd ?? "").trim());
  if (!m) return new Date(NaN);
  // setUTCFullYear rather than Date.UTC(): the latter remaps years 0-99 into
  // the 1900s, and a report can be asked for any year the regex accepts.
  const w = new Date(0);
  w.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  w.setUTCHours(0, 0, 0, 0);
  const wall = w.getTime();
  const once = wall - offsetMs(new Date(wall));
  return new Date(wall - offsetMs(new Date(once)));
}

/** Tallinn midnight of the day `at` falls in — «сегодня» starts here. */
export function startOfShopDay(at: Date): Date {
  return shopDayStart(shopDay(at));
}

/**
 * The last instant of the Tallinn day `at` falls in — 23:59:59.999 local,
 * whatever the offset is that week.
 *
 * For a deadline the shop has PROMISED as a date: «до 3 октября включительно»
 * on a birthday code has to mean the whole of the 3rd, not up to whatever
 * o'clock the cron happened to run a fortnight earlier. The last millisecond
 * rather than the next midnight on purpose — the promo check is
 * `endsAt <= now` (src/lib/promos.ts), and a bound of 00:00 the next day both
 * dies a millisecond into the day it should cover and prints the wrong date.
 */
export function endOfShopDay(at: Date): Date {
  const start = shopDayStart(addShopDays(shopDay(at), 1));
  return Number.isNaN(start.getTime()) ? at : new Date(start.getTime() - 1);
}

/** `YYYY-MM-DD` + n calendar days. Pure calendar arithmetic: a 23- or 25-hour
 *  day (the two switch-overs) never turns into a skipped or repeated date. */
export function addShopDays(ymd: string, days: number): string {
  const m = YMD_RE.exec(String(ymd ?? "").trim());
  if (!m) return "";
  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(days || 0));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** The year/month/day of a `YYYY-MM-DD`, as numbers. Null if it is not one. */
export function ymdParts(ymd: string): { year: number; month: number; day: number } | null {
  const m = YMD_RE.exec(String(ymd ?? "").trim());
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}
