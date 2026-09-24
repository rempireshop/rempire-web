/**
 * Дневной лимит писем — src/lib/mail-budget.ts, db/migrations/201_mail_budget.sql.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH, in one sentence: a campaign goes out
 * at nine in the morning, eats the hundred letters the free plan allows, and
 * at four in the afternoon somebody pays for an order and gets NOTHING. No
 * error anywhere, no letter either — the shop would look fine and the customer
 * would be waiting for a confirmation that was refused on their behalf by a
 * newsletter. Everything below is one half of the rule that prevents it.
 *
 * The rule is deliberately asymmetrical, and each half is pinned separately:
 *
 *   1. TRANSACTIONAL NEVER ASKS. With the marketing allowance gone to the last
 *      letter, «Заказ принят» still goes out. It is counted, so the figure the
 *      panel prints stays true, and it is never stopped.
 *   2. MARKETING STOPS AT CAP − RESERVE. A campaign sends what fits and not one
 *      more, whoever spent the rest of the day — an order letter that went out
 *      in between comes off the same hundred.
 *   3. THE COUNTER ROLLS AT UTC MIDNIGHT, because that is when Resend's
 *      allowance does — not at Tallinn's, which src/lib/day.ts cuts the shop's
 *      own days on. Three hours of a new day spent against an old quota is
 *      exactly the overspend this module is for.
 *   4. A PARKED CAMPAIGN RESUMES AND SENDS NOBODY TWICE. Stopping at the cap is
 *      not failing: the rows stay queued, the daily cron calls back, and the
 *      «one row per address» guarantee of 160_newsletters.sql is what makes
 *      day two safe.
 *   5. RESEND'S OWN «NO» STOPS THE RUN. A 429 that names the daily quota is a
 *      different answer from the 429 that names two requests a second, and a
 *      queue that cannot tell them apart collects the first one once per
 *      address — hammering a provider that has just asked us to stop.
 *   6. THE OWNER IS TOLD ONCE A DAY, NOT ONCE A LETTER. On his phone: the
 *      channel that has run out is the one thing the notice may not use.
 *   7. A DATABASE THAT CANNOT BE READ FAILS OPEN ONE WAY AND CLOSED THE OTHER.
 *      «We do not know how much is left» holds a campaign back and never, ever
 *      refuses somebody's receipt.
 *
 * Real Postgres (PGlite) and the real migrations; Resend and the push service
 * are stubs — the same idiom as tests/newsletters.test.ts and tests/push.test.ts.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordMarketingConsent } from "@/lib/consent";
import { recordLogin } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { runAbandonedCarts } from "@/lib/flows";
import { quotaRefusal, sendMail } from "@/lib/mail";
import {
  campaignPlan,
  cleanMailBudget,
  limitNoticeBody,
  mailBudgetView,
  MAIL_CAP_DEFAULT,
  MAIL_RESERVE_DEFAULT,
  noteSent,
  roomFor,
  spentToday,
  utcDay,
  warnOwnerOnce,
} from "@/lib/mail-budget";
import { onOrderPaid } from "@/lib/mail-hooks";
import { setSetting } from "@/lib/orders";
import { saveSubscription } from "@/lib/push";
import {
  createNewsletter,
  getNewsletter,
  resumeParkedNewsletters,
  sendNewsletterBatch,
} from "@/lib/newsletters";
import type { OrderLike } from "@/emails/types";
import { setupDb, teardownDb } from "./helpers";

/* ---------- Resend, stubbed ---------------------------------------------- */

/** Every address Resend was asked to write to, in order. */
const sent: string[] = [];
/** What the stub answers next: 200, or a status and a body for the refusals. */
let answer: { status: number; body: Record<string, string> } = { status: 200, body: {} };

function mockResend(): void {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string[] };
    sent.push(...body.to);
    if (answer.status !== 200) {
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

/** Resend's two 429s, word for word — see quotaRefusal() in src/lib/mail.ts. */
const DAILY_QUOTA = { name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." };
const PER_SECOND = { name: "rate_limit_exceeded", message: "Too many requests. You can only make 2 requests per second." };

/* ---------- the push service, stubbed ------------------------------------ */

const wp = vi.hoisted(() => ({ sent: [] as Array<{ endpoint: string; payload: string }> }));

vi.mock("web-push", () => {
  const sendNotification = async (sub: { endpoint: string }, payload: string) => {
    wp.sent.push({ endpoint: sub.endpoint, payload });
    return { statusCode: 201, body: "", headers: {} };
  };
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { default: { sendNotification, WebPushError }, sendNotification, WebPushError };
});

const PUB = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const PRIV = "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls";
const PHONE = "https://web.push.apple.com/rmp/iphone";

/* ---------- fixtures ------------------------------------------------------ */

const ORDER: OrderLike = {
  id: "aaaaaaaa-0000-4000-8000-000000000042",
  number: "R-100042",
  lang: "RU",
  email: "klient@example.com",
  name: "Мария Тамм",
  items: [{ id: "p1", title: "Fresh.Hair", brand: "Kevin.Murphy", qty: 1, price: 27, sum: 27 }],
  total: 27,
};

const BODY = "<h2>Новинки</h2><p>Привезли Kevin.Murphy.</p>";

function draft(over: Record<string, unknown> = {}) {
  return { title: "Сентябрь", subject: { RU: "Новинки сентября" }, body: { RU: BODY }, products: [], ...over };
}

/** `n` subscribers with the tick on — the audience a campaign freezes. */
async function audience(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const email = `reader-${String(i).padStart(2, "0")}@example.com`;
    await recordLogin(email, "RU");
    await recordMarketingConsent(email, "RU", "account");
    out.push(email);
  }
  return out;
}

/** The owner's two numbers for this test. */
async function budget(cap: number, reserve: number): Promise<void> {
  await setSetting("mail_budget", { cap, reserve });
}

/** Today's rows, as the table holds them. */
async function rows(): Promise<Array<{ day: string; kind: string; n: number; blocked: boolean; warned: boolean }>> {
  const raw = await query<{ day: string; kind: string; n: number | string; blocked_at: unknown; warned_at: unknown }>(
    "select day, kind, n, blocked_at, warned_at from mail_sends_daily order by day, kind",
  );
  return raw.map((r) => ({
    day: r.day,
    kind: r.kind,
    n: Number(r.n),
    blocked: r.blocked_at != null,
    warned: r.warned_at != null,
  }));
}

const ENV_KEYS = ["RESEND_API_KEY", "RESEND_TO", "MAIL_RETRY_DELAY_MS", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  await setupDb();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
  /* No RESEND_TO and no Telegram token: the owner's own ping is off, so every
     letter this file counts is one it asked for. */
  delete process.env.RESEND_TO;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

afterAll(async () => {
  await teardownDb();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(async () => {
  sent.length = 0;
  wp.sent.length = 0;
  answer = { status: 200, body: {} };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.RESEND_TO;
  await exec(
    "truncate mail_sends_daily, newsletters, newsletter_sends, customers, mail_optouts, carts, settings, admin_audit, push_subscriptions restart identity cascade",
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockResend();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- 1. the numbers ------------------------------------------------ */

describe("the day, and the two numbers that bound it", () => {
  it("defaults to Resend's free plan with thirty held back, and clamps whatever is stored", () => {
    expect(MAIL_CAP_DEFAULT).toBe(100);
    expect(MAIL_RESERVE_DEFAULT).toBe(30);
    expect(cleanMailBudget(null)).toEqual({ cap: 100, reserve: 30 });
    expect(cleanMailBudget({ cap: 250, reserve: 50 })).toEqual({ cap: 250, reserve: 50 });
    // a blob the admin can PUT: nonsense becomes the default, never NaN
    expect(cleanMailBudget({ cap: "сто", reserve: -5 })).toEqual({ cap: 100, reserve: 30 });
    expect(cleanMailBudget({ cap: 10, reserve: 40 })).toEqual({ cap: 10, reserve: 10 });
    expect(cleanMailBudget({ cap: 9_000_000, reserve: 0 }).cap).toBe(5_000);
    // the string form a jsonb column can hand back
    expect(cleanMailBudget('{"cap":40,"reserve":10}')).toEqual({ cap: 40, reserve: 10 });
  });

  it("counts a send against today and answers cap − reserve − everything", async () => {
    await budget(10, 3);
    expect(await roomFor("marketing")).toBe(7);

    await noteSent("marketing", 2);
    await noteSent("transactional", 1);

    const spent = await spentToday();
    expect(spent).toMatchObject({ day: utcDay(), marketing: 2, transactional: 1, total: 3, known: true });
    /* Both classes come off one allowance: the order letters in the middle of
       the morning shrink what the campaign may still send. */
    expect(await roomFor("marketing")).toBe(4);
  });

  it("plans the days a campaign will take, today included", async () => {
    await budget(100, 30);
    const view = await mailBudgetView();
    expect(view).toMatchObject({ cap: 100, reserve: 30, marketingRoom: 70, blocked: false, known: true });

    expect(campaignPlan(0, view)).toMatchObject({ left: 0, today: 0, days: 0 });
    expect(campaignPlan(50, view)).toMatchObject({ left: 50, today: 50, days: 1 });
    expect(campaignPlan(180, view)).toMatchObject({ left: 180, today: 70, days: 3 });
    // nothing fits today: the whole campaign starts tomorrow
    expect(campaignPlan(180, { ...view, marketingRoom: 0 })).toMatchObject({ today: 0, days: 3 });
  });
});

/* ---------- 2. the counter's own day -------------------------------------- */

describe("the counter rolls at UTC midnight", () => {
  it("cuts the day where Resend does, to the millisecond", () => {
    expect(utcDay(Date.UTC(2026, 8, 21, 0, 0, 0))).toBe("2026-09-21");
    expect(utcDay(Date.UTC(2026, 8, 21, 23, 59, 59, 999))).toBe("2026-09-21");
    expect(utcDay(Date.UTC(2026, 8, 22, 0, 0, 0))).toBe("2026-09-22");
    /* 02:00 Tallinn in summer is still yesterday in UTC — the very gap a
       counter cut on the shop's own calendar would spend twice. */
    expect(utcDay(Date.parse("2026-09-22T02:00:00+03:00"))).toBe("2026-09-21");
  });

  it("yesterday's hundred letters leave today's allowance untouched", async () => {
    await budget(10, 3);
    const yesterday = utcDay(Date.now() - 24 * 60 * 60 * 1000);
    await query("insert into mail_sends_daily (day, kind, n, blocked_at) values ($1, 'marketing', 99, now())", [yesterday]);

    const spent = await spentToday();
    expect(spent).toMatchObject({ marketing: 0, total: 0, blocked: false, known: true });
    // …including yesterday's «Resend said no», which said nothing about today
    expect(await roomFor("marketing")).toBe(7);
  });
});

/* ---------- 3. the letter that must never be refused ---------------------- */

describe("transactional mail with the marketing allowance gone", () => {
  it("«Заказ принят» still goes out, and is still counted", async () => {
    await budget(10, 3);
    await noteSent("marketing", 7); // the campaign has had its share
    expect(await roomFor("marketing")).toBe(0);
    /* Infinity, and without a query: the class that is never stopped never
       asks. A number here would one day be compared with something. */
    expect(await roomFor("transactional")).toBe(Number.POSITIVE_INFINITY);

    const res = await onOrderPaid(ORDER);

    expect(res.sent).toBe(true);
    expect(sent).toEqual(["klient@example.com"]);
    const spent = await spentToday();
    expect(spent.transactional).toBe(1);
    expect(spent.marketing).toBe(7);
  });

  it("goes out even past the cap itself — our number stops campaigns, never receipts", async () => {
    await budget(4, 1);
    await noteSent("transactional", 9); // a busy day: already over the cap

    const res = await sendMail({ to: "klient@example.com", subject: "Заказ принят", text: "ok" });

    expect(res.ok).toBe(true);
    expect(sent).toEqual(["klient@example.com"]);
    expect((await spentToday()).transactional).toBe(10);
    // and the campaign is the one that waits
    expect(await roomFor("marketing")).toBe(0);
  });
});

/* ---------- 4. the campaign stops, parks and comes back ------------------- */

describe("a campaign bigger than the day", () => {
  it("sends cap − reserve, parks, and finishes the next day without writing to anybody twice", async () => {
    await budget(4, 1); // three letters a day for marketing
    const readers = await audience(5);
    const n = await createNewsletter(draft());

    const first = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    expect(first.progress).toMatchObject({ done: false, parked: true, sent: 3, failed: 0, left: 2, total: 5 });
    expect(sent).toHaveLength(3);
    /* The panel that shipped before parking existed loops on `done:false`
       after `retryAfterMs` — so a parked run has to hand it a real pause, or
       it calls this route flat out for the rest of the afternoon. */
    expect(first.progress.retryAfterMs).toBeGreaterThanOrEqual(60_000);
    /* Not «sent», not back to «draft»: it is mid-flight, and the panel says
       «отправлено 3 из 5, продолжится завтра». */
    expect((await getNewsletter(n.id))?.status).toBe("sending");
    expect((await spentToday()).marketing).toBe(3);

    // a second call on the same day sends nothing at all — the day is spent
    const same = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    expect(same.progress).toMatchObject({ done: false, parked: true, sent: 3, left: 2 });
    expect(sent).toHaveLength(3);

    /* The next day, from the counter's point of view: today's rows become
       yesterday's. This is the roll the whole table is keyed for. */
    await query("update mail_sends_daily set day = $1", [utcDay(Date.now() - 24 * 60 * 60 * 1000)]);
    expect(await roomFor("marketing")).toBe(3);

    const resumed = await resumeParkedNewsletters({ perSecond: 1000, concurrency: 1 });
    expect(resumed).toMatchObject({ picked: 1, sent: 2, failed: 0, left: 0, finished: 1 });
    expect((await getNewsletter(n.id))?.status).toBe("sent");

    /* The whole point of the parking: five addresses, five letters, each one
       exactly once — across two days and four calls. */
    expect(sent).toHaveLength(5);
    expect([...sent].sort()).toEqual([...readers].sort());
    expect(new Set(sent).size).toBe(5);
    expect((await spentToday()).marketing).toBe(2);
  });

  it("leaves nothing parked when the campaign fits in the day", async () => {
    await budget(100, 30);
    await audience(3);
    const n = await createNewsletter(draft());

    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });

    expect(progress).toMatchObject({ done: true, sent: 3, left: 0 });
    expect(progress.parked).toBeUndefined();
    expect(await resumeParkedNewsletters()).toMatchObject({ picked: 0, reason: "nobody" });
  });

  it("the daily cron is what calls it back, and it stops at the allowance too", async () => {
    await budget(2, 0); // two letters a day, nothing held back
    await audience(6);
    const n = await createNewsletter(draft());

    await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    expect(sent).toHaveLength(2);

    // day two: two more, and it parks again rather than running the list down
    await query("update mail_sends_daily set day = $1", [utcDay(Date.now() - 24 * 60 * 60 * 1000)]);
    const day2 = await resumeParkedNewsletters({ perSecond: 1000, concurrency: 1 });
    expect(day2).toMatchObject({ picked: 1, sent: 2, left: 2, finished: 0 });
    expect(sent).toHaveLength(4);
    expect(new Set(sent).size).toBe(4);

    // and with the day already spent it does not even take the lease
    const again = await resumeParkedNewsletters({ perSecond: 1000, concurrency: 1 });
    expect(again).toMatchObject({ picked: 1, sent: 0, reason: "no_budget" });
    expect(sent).toHaveLength(4);
  });
});

/* ---------- 4b. …at the pace the shop really sends ------------------------ */

/*
 * Dim, 24.09.2026, after the limit test: «Will the newsletters send
 * themselves automatically, when I get this message?». They were meant to —
 * but the morning run gave each parked letter ONE batch, and a batch is one
 * panel call's worth (6.5 s, about a dozen letters at Resend's two a second).
 * The tests above send at a thousand a second, so one batch always finished;
 * at the real pace a campaign parked with sixty left took five mornings.
 *
 * Here every request to Resend moves a fake clock on by a second — the pace
 * the defaults keep — and the morning run is called with its defaults.
 */
describe("the morning run finishes what the limit left, at the real pace", () => {
  it("sends every remaining letter the day allows — not one batch's dozen", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T09:00:00.000Z") });
    try {
      const resend = globalThis.fetch;
      vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
        vi.setSystemTime(Date.now() + 1000);
        return resend(url as string, init);
      });
      await budget(2, 0);
      const readers = await audience(14);
      const n = await createNewsletter(draft());

      const first = await sendNewsletterBatch(n.id);
      expect(first.progress).toMatchObject({ parked: true, sent: 2, left: 12 });

      // the next morning, with the owner's usual numbers back
      await query("update mail_sends_daily set day = $1", [utcDay(Date.now() - 24 * 60 * 60 * 1000)]);
      await budget(100, 30);
      const resumed = await resumeParkedNewsletters();

      expect(resumed, "the morning run stopped after one batch").toMatchObject({ picked: 1, sent: 12, left: 0, finished: 1 });
      expect((await getNewsletter(n.id))?.status).toBe("sent");
      expect([...sent].sort()).toEqual([...readers].sort());
      expect(new Set(sent).size).toBe(14);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ---------- 5. Resend's own refusal --------------------------------------- */

describe("a quota refusal is not an ordinary failure", () => {
  it("tells the two 429s apart", () => {
    expect(quotaRefusal(429, DAILY_QUOTA.message)).toBe(true);
    expect(quotaRefusal(429, DAILY_QUOTA.name)).toBe(true);
    expect(quotaRefusal(429, PER_SECOND.message)).toBe(false);
    expect(quotaRefusal(429, PER_SECOND.name)).toBe(false);
    expect(quotaRefusal(422, "Invalid `to` field.")).toBe(false);
    expect(quotaRefusal(500, "You have reached your daily email sending quota.")).toBe(false);
  });

  it("stops the run at the first one instead of collecting it once per address", async () => {
    await budget(100, 30); // plenty of room by OUR count — theirs is the wall
    await audience(5);
    const n = await createNewsletter(draft());
    answer = { status: 429, body: DAILY_QUOTA };

    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });

    /* One request, then the run ends. A queue that kept walking would have
       made five — and a 429 is never retried, so five is all it could be. */
    expect(sent).toHaveLength(1);
    expect(progress).toMatchObject({ done: false, parked: true, sent: 0, failed: 0, left: 5 });
    // the address was refused, not delivered: its row waits
    const queued = await query<{ n: string | number }>(
      "select count(*) as n from newsletter_sends where newsletter_id = $1 and status = 'queued'",
      [n.id],
    );
    expect(Number(queued[0].n)).toBe(5);
    expect((await rows()).find((r) => r.kind === "marketing")?.blocked).toBe(true);

    /* And the day stays shut: the next call does not send a thing, though our
       own counter says seventy letters are still going spare. */
    answer = { status: 200, body: {} };
    expect(await roomFor("marketing")).toBe(0);
    await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    expect(sent).toHaveLength(1);
  });

  it("the ordinary 429 still only pauses — the panel is told to call again", async () => {
    await budget(100, 30);
    await audience(2);
    const n = await createNewsletter(draft());
    answer = { status: 429, body: PER_SECOND };

    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });

    expect(progress.retryAfterMs).toBeGreaterThan(0);
    expect(progress.parked).toBeUndefined();
    expect((await rows()).some((r) => r.blocked)).toBe(false);
  });
});

/* ---------- 6. the owner hears once --------------------------------------- */

describe("the owner is told once a day, on his phone", () => {
  beforeEach(async () => {
    process.env.VAPID_PUBLIC_KEY = PUB;
    process.env.VAPID_PRIVATE_KEY = PRIV;
    await saveSubscription({ endpoint: PHONE, p256dh: PUB, auth: "tBHItJI5svbpez7KI4CCXg", label: "iPhone" });
  });

  it("one push for a campaign that parks, whatever else runs into the same wall", async () => {
    await budget(2, 0);
    await audience(5);
    const n = await createNewsletter(draft());

    await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    expect(wp.sent).toHaveLength(1);
    const payload = JSON.parse(wp.sent[0].payload) as { title: string; body: string; tag: string };
    expect(payload.title).toContain("Лимит писем");
    expect(payload.body).toContain("2");
    expect(payload.tag).toBe(`mail-budget:${utcDay()}`);

    /* The same wall, found again by the panel, by the cron and by the cart
       reminder: still one notice. «Once per letter» is what would make the
       notification useless the first day it mattered. */
    await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    await resumeParkedNewsletters({ perSecond: 1000, concurrency: 1 });
    expect(await warnOwnerOnce()).toBe(false);
    expect(wp.sent).toHaveLength(1);

    const marketing = (await rows()).find((r) => r.kind === "marketing");
    expect(marketing?.warned).toBe(true);
  });

  /* Dim, 24.09.2026: «Will the newsletters send themselves automatically, when
     I get this message?». The notice said «Рассылка остановлена». It says
     what happens next now — in the panel's words, with the campaign's count. */
  it("says the rest goes out by itself tomorrow — and that nothing needs pressing", async () => {
    await budget(2, 0);
    await audience(5);
    const n = await createNewsletter(draft());

    await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    const payload = JSON.parse(wp.sent[0].payload) as { body: string };
    expect(payload.body).toContain("Рассылка: отправлено 2 из 5 — остальные уйдут автоматически завтра");
    expect(payload.body).toContain("нажимать ничего не нужно");
    expect(payload.body, "the notice still reads as a stop").not.toContain("остановлена");
  });

  it("a limit met by the reminders, not a campaign, says the same about tomorrow", () => {
    const line = limitNoticeBody({ total: 70, blocked: false }, { cap: 100, reserve: 30 });
    expect(line).toContain("Сегодня отправлено 70 из 100");
    expect(line).toContain("продолжатся завтра сами");
    expect(limitNoticeBody({ total: 12, blocked: true }, { cap: 100, reserve: 30 }, { sent: 12, total: 40 }))
      .toContain("отправлено 12 из 40 — остальные уйдут автоматически завтра");
  });

  it("never by e-mail — that is the thing that has run out", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    await budget(1, 0);
    await noteSent("marketing", 1);

    expect(await warnOwnerOnce()).toBe(true);

    expect(wp.sent).toHaveLength(1);
    expect(sent).toEqual([]); // nothing went to Resend
  });

  it("a new day is a new notice", async () => {
    await budget(1, 0);
    await noteSent("marketing", 1);
    expect(await warnOwnerOnce()).toBe(true);
    expect(await warnOwnerOnce()).toBe(false);

    await query("update mail_sends_daily set day = $1", [utcDay(Date.now() - 24 * 60 * 60 * 1000)]);
    expect(await warnOwnerOnce()).toBe(true);
    expect(wp.sent).toHaveLength(2);
  });
});

/* ---------- 7. the owner's own ping ---------------------------------------- */

/**
 * Decision 4 of 21.09.2026: the ping about a paid order used to go out on
 * Telegram, e-mail AND push at once, and the e-mail came off the same hundred
 * the customers' letters do. Renat is the one person in this shop who does not
 * need to be told by e-mail — his phone is already in his hand.
 */
describe("the owner's ping", () => {
  it("costs no letter when the push reached a phone, and still arrives when it did not", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    process.env.VAPID_PUBLIC_KEY = PUB;
    process.env.VAPID_PRIVATE_KEY = PRIV;
    await saveSubscription({ endpoint: PHONE, p256dh: PUB, auth: "tBHItJI5svbpez7KI4CCXg", label: "iPhone" });

    const res = await onOrderPaid(ORDER);

    expect(res.notified).toBe(true);
    expect(wp.sent).toHaveLength(1);
    // one letter, the customer's — the owner's copy did not go to Resend
    expect(sent).toEqual(["klient@example.com"]);
    expect((await spentToday()).transactional).toBe(1);

    /* The phone gone (permission revoked, the panel removed from the Home
       Screen): the letter is the fallback, exactly as it was, and it is
       counted — it comes off the day like everything else. */
    await query("update push_subscriptions set retired_at = now()");
    await onOrderPaid(ORDER);
    expect(sent).toEqual(["klient@example.com", "klient@example.com", "shop@rempireshop.com"]);
    expect((await spentToday()).transactional).toBe(3);
  });
});

/* ---------- 8. the marketing flows ---------------------------------------- */

describe("the three letters nobody asked for", () => {
  it("the cart reminder stops when the day is spent — and stamps nothing", async () => {
    await budget(2, 2); // the whole cap is reserve: no marketing at all today
    await setSetting("flows", { abandoned: true });
    await query(
      `insert into carts (email, lang, items, total, updated_at)
       values ('cart@example.com', 'RU', '[{"id":"demo-1","title":"Demo","qty":1,"price":10}]'::jsonb, 10, $1)`,
      [new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()],
    );

    const run = await runAbandonedCarts();

    expect(run).toMatchObject({ sent: 0, reason: "no_budget" });
    expect(sent).toEqual([]);
    /* The cart is NOT stamped: `reminded_at` is what stops tomorrow's run
       seeing it, and a letter that was never sent must not be remembered as
       one that was. This is the assertion that separates «отложено» from
       «потеряно». */
    const [cart] = await query<{ reminded_at: unknown }>("select reminded_at from carts where email = 'cart@example.com'");
    expect(cart.reminded_at).toBeNull();

    // with room again, the same run sends it
    await budget(10, 2);
    const later = await runAbandonedCarts();
    expect(later.sent).toBe(1);
    expect(sent).toEqual(["cart@example.com"]);
    expect((await spentToday()).marketing).toBe(1);
  });
});

/* ---------- 9. no database ------------------------------------------------- */

/* Last, and on purpose: it takes the table away. Everything above needs it. */
describe("a counter that cannot be read", () => {
  afterAll(async () => {
    // put it back the way the migration made it — the file is `if not exists`
    await exec(readFileSync(new URL("../db/migrations/201_mail_budget.sql", import.meta.url), "utf8"));
  });

  it("fails open for the receipt and closed for the campaign", async () => {
    await budget(100, 30);
    await audience(2);
    const n = await createNewsletter(draft());
    await exec("drop table if exists mail_sends_daily");

    const spent = await spentToday();
    expect(spent.known).toBe(false);
    expect(spent.total).toBe(0); // …and «0» here must never be read as «nothing spent»

    /* The customer's letter: nothing about a counter may stand between a paid
       order and its confirmation. It simply goes, uncounted. */
    const res = await onOrderPaid(ORDER);
    expect(res.sent).toBe(true);
    expect(sent).toEqual(["klient@example.com"]);

    // the campaign: held back, because «we do not know» is not «there is room»
    expect(await roomFor("marketing")).toBe(0);
    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 1 });
    expect(progress).toMatchObject({ done: false, parked: true, sent: 0, left: 2 });
    expect(sent).toEqual(["klient@example.com"]); // still just the order letter

    // and the panel is told it is a blind spot rather than an empty day
    expect(await mailBudgetView()).toMatchObject({ known: false, marketingRoom: 0 });
  });
});
