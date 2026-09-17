/**
 * «Цены для салонов включены» goes out at most once a day per address — and
 * the day is the shop's, Tallinn, never UTC (src/lib/day.ts).
 *
 * src/lib/partner-mail.ts builds the Resend idempotency key as
 * `partner:<address>:<day>`. That day used to come from
 * `toISOString().slice(0, 10)`, which is UTC, and Tallinn runs at UTC+2 in
 * winter and UTC+3 in summer — so UTC midnight lands at 02:00 or 03:00 on the
 * Estonian clock. Two consequences, both wrong and both invisible until an
 * evening:
 *
 * · an owner who flips a card at one in the morning and again at half past
 *   three is inside ONE Estonian night, but either side of the UTC date — two
 *   keys, and the customer is welcomed twice;
 * · 23:00 and 00:30 on the Estonian clock are two different Estonian days that
 *   UTC calls one — a second letter that is genuinely due is swallowed.
 *
 * The clock below is stopped with `toFake: ["Date"]` and nothing else: PGlite
 * and the mail layer's own retry pause still need real timers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendPartnerWelcome } from "@/lib/partner-mail";
import { setupDb, teardownDb } from "./helpers";

const PARTNER = {
  email: "salon@example.com",
  name: "Мария Тамм",
  lang: "RU",
  company: "OÜ Näidis",
};

/** Every Idempotency-Key Resend was handed, in the order it saw them. */
const keys: (string | null)[] = [];

const ENV_KEYS = ["RESEND_API_KEY", "MAIL_RETRY_DELAY_MS"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
  await setupDb();
});

afterAll(async () => {
  await teardownDb();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(() => {
  keys.length = 0;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    keys.push(h["Idempotency-Key"] ?? null);
    return new Response(JSON.stringify({ id: `msg_${keys.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Sends the welcome with the clock stopped at `iso`, and hands back its key. */
async function keyAt(iso: string): Promise<string> {
  vi.setSystemTime(new Date(iso));
  const res = await sendPartnerWelcome(PARTNER);
  expect(res.ok, `nothing went out at ${iso} — ${res.reason ?? "no reason given"}`).toBe(true);
  const key = keys.at(-1);
  expect(key, `no Idempotency-Key at ${iso}`).toBeTruthy();
  return String(key);
}

describe("the welcome letter's idempotency key runs on the Tallinn calendar", () => {
  it("names the address and the shop's day", async () => {
    // 22:00Z on the 15th is 01:00 on the 16th in Tallinn (EEST, UTC+3).
    expect(await keyAt("2026-07-15T22:00:00Z")).toBe("partner:salon@example.com:2026-07-16");
  });

  it("holds one key across UTC midnight, inside a single Estonian night", async () => {
    // 01:00 and 03:30 on the 16th, Tallinn — one Estonian day, two UTC ones.
    // This is the double letter: on the old UTC stamp the second tap was a
    // different key and Resend had no reason to suppress it.
    const small = await keyAt("2026-07-15T22:00:00Z");
    const later = await keyAt("2026-07-16T00:30:00Z");
    expect(later, "a second welcome went out in the same Estonian night").toBe(small);
  });

  it("holds one key for two sends UTC also calls one day", async () => {
    // 00:00 and 02:00 on the 16th, Tallinn — same day on either calendar.
    const at21 = await keyAt("2026-07-15T21:00:00Z");
    const at23 = await keyAt("2026-07-15T23:00:00Z");
    expect(at23, "two keys inside one Tallinn day").toBe(at21);
  });

  it("turns the day over at Tallinn midnight, not at UTC midnight", async () => {
    // 20:00Z is still the 15th in Tallinn (23:00); 21:00Z is already the 16th.
    // UTC calls both the 15th — this is the letter the old key swallowed.
    const evening = await keyAt("2026-07-15T20:00:00Z");
    const midnight = await keyAt("2026-07-15T21:00:00Z");
    expect(evening).toBe("partner:salon@example.com:2026-07-15");
    expect(midnight, "Tallinn midnight did not start a new day").not.toBe(evening);
  });

  it("moves the turn with the season — UTC+2 in January, UTC+3 in July", async () => {
    // Nothing here knows the offset: Intl carries the EET/EEST rules, so the
    // boundary is an hour earlier in UTC terms in winter and stays correct.
    expect(await keyAt("2026-01-15T21:00:00Z")).toBe("partner:salon@example.com:2026-01-15");
    expect(await keyAt("2026-01-15T22:00:00Z")).toBe("partner:salon@example.com:2026-01-16");
  });
});
