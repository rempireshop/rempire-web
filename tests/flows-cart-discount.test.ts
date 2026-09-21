/**
 * «Брошенная корзина» — the second letter, the one with the code, and the
 * four numbers the owner now picks for both of them.
 *
 * Renat, 20.09.2026, via Dim: «add possibility to choose time when the
 * abandoned cart letter (currently 3h) goes out + after first one did not
 * work we send out another mail with discount. The discounted e-mail needs
 * possibility to choose for what the discount is (preferably ONLY for the
 * cart) + also timeframe when it goes out.» His earlier framing of the same
 * wish: baskets under 100 € get the plain reminder, baskets over it get 5 %
 * after three days.
 *
 * What is pinned here:
 *   · «the first letter did not work» is «no order from that address since»,
 *     and nothing else — there is no open and no click to read;
 *   · the basket floor decides who gets the second letter at all;
 *   · one letter per basket however often the job runs;
 *   · the code is single-use and discounts THAT basket's lines and nothing
 *     the shopper has put in since — the `cart` scope of
 *     db/migrations/197_abandoned_cart_discount.sql;
 *   · a gift card stays out of reach of it, the way it is out of reach of
 *     every other scope;
 *   · an address that pressed «Отписаться», and one whose tick was taken off
 *     by hand, get nothing — and are not asked again;
 *   · a send the mail layer never attempted leaves the basket owed and takes
 *     the code back with the stamp;
 *   · the letter's button carries a token that restores the basket AND the
 *     code, and the code is printed under it as well;
 *   · each of the four settings takes what the panel may send and refuses
 *     what it may not.
 *
 * Real Postgres (PGlite), Resend stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import {
  FLOW_DEFAULTS,
  getFlowRuns,
  getFlows,
  readResumeToken,
  runAbandonedCarts,
  runAbandonedCartsDiscount,
  runFlows,
} from "@/lib/flows";
import { setSetting } from "@/lib/orders";
import { quotePromo, type PromoBasketLine } from "@/lib/promos";
import { makeRequest, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/* The shop stamps `reminded_at` / `discount_at` with the DATABASE's now(),
   so the JS clock every expectation is written against has to be the same
   one. Fixed once, so a test that runs either side of midnight reads alike. */
const NOW = Date.now();

let restoreEnv: () => void = () => {};

/** Every letter Resend was asked to send since the last reset. */
interface Sent {
  to: string;
  subject: string;
  html: string;
  text: string;
}
const sent: Sent[] = [];
function mockResend(): void {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; html: string; text: string };
    for (const to of body.to) sent.push({ to, subject: body.subject, html: body.html, text: body.text });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}
const recipients = () => sent.map((m) => m.to);

/* The letter's own button, out of the plain-text part. The language segment
   is optional because the fixtures are English carts and RU has none. */
const RESUME_RX = /\/shop2\/(?:et\/|en\/)?checkout\/\?resume=([A-Za-z0-9._~%-]+)/;
function resumeTokenIn(text: string): string {
  const m = RESUME_RX.exec(text);
  expect(m, "the letter carries no resume link").not.toBeNull();
  return decodeURIComponent((m as RegExpExecArray)[1]);
}

/* Two 60 € lines, so a five-per-cent code on the pair is exactly 6 €. */
const LINES = [
  { id: "cart-a", title: "A", brand: "Davines", qty: 1, price: 60 },
  { id: "cart-b", title: "B", brand: "Reuzel", qty: 1, price: 60 },
];

interface CartFixture {
  /** How long ago the basket was last touched. */
  quietMs?: number;
  /** How long ago the FIRST letter went out; undefined = it never did. */
  remindedAgoMs?: number;
  total?: number;
  items?: unknown[];
}

/** One saved basket, positioned in time relative to NOW. */
async function cart(email: string, fx: CartFixture = {}): Promise<string> {
  const items = fx.items ?? LINES;
  const total = fx.total ?? 120;
  const rows = await query<{ id: string }>(
    `insert into carts (email, lang, items, total, updated_at, reminded_at)
     values ($1, 'EN', $2::jsonb, $3, $4, $5)
     on conflict (email) do update
       set items = excluded.items, total = excluded.total, updated_at = excluded.updated_at,
           reminded_at = excluded.reminded_at, discount_at = null, discount_code = null,
           recovered_at = null
     returning id`,
    [
      email,
      JSON.stringify(items),
      total,
      new Date(NOW - (fx.quietMs ?? 4 * HOUR)).toISOString(),
      fx.remindedAgoMs === undefined ? null : new Date(NOW - fx.remindedAgoMs).toISOString(),
    ],
  );
  return rows[0].id;
}

async function cartRow(id: string): Promise<{ discount_at: string | null; discount_code: string | null }> {
  const rows = await query<{ discount_at: string | null; discount_code: string | null }>(
    "select discount_at, discount_code from carts where id = $1",
    [id],
  );
  return rows[0];
}

async function cartCodes(): Promise<string[]> {
  const rows = await query<{ code: string }>(
    "select code from promo_codes where code like 'REM-CART-%' order by created_at",
  );
  return rows.map((r) => r.code);
}

/** The whole flow, on by default with Renat's own numbers. */
async function on(over: Record<string, unknown> = {}): Promise<void> {
  await setSetting("flows", {
    abandoned: true,
    abandonedHours: 3,
    abandonedDiscountDays: 3,
    abandonedDiscountPercent: 5,
    abandonedDiscountMinTotal: 100,
    ...over,
  });
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
  await query("delete from carts");
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

/* ---------- when it goes ---------------------------------------------------- */

describe("runAbandonedCartsDiscount() — the wait after the first letter", () => {
  it("counts the owner's days from the day the reminder really went, and sends once", async () => {
    await on();
    const id = await cart("dim@example.com", { remindedAgoMs: 2 * DAY });

    const early = await runAbandonedCartsDiscount(NOW);
    expect(early.sent).toBe(0);
    expect(early.reason).toBe("too_fresh");
    expect(early.skips).toEqual({ too_fresh: 1 });
    expect((await cartRow(id)).discount_at).toBeNull();

    const due = await runAbandonedCartsDiscount(NOW + DAY);
    expect(due.sent).toBe(1);
    expect(recipients()).toEqual(["dim@example.com"]);

    /* The cron runs daily and the panel's button runs the same function: a
       second pass must find a basket that has already been written to. */
    const again = await runAbandonedCartsDiscount(NOW + 2 * DAY);
    expect(again.sent).toBe(0);
    expect(again.reason).toBe("already_sent");
    expect(sent).toHaveLength(1);
    expect(await cartCodes()).toHaveLength(1);
  });

  it("says «no_reminder» for a basket the first letter has not reached yet", async () => {
    await on();
    await cart("fresh@example.com", { quietMs: 30 * 60_000 });
    const run = await runAbandonedCartsDiscount(NOW);
    expect(run.sent).toBe(0);
    expect(run.skips).toEqual({ no_reminder: 1 });
    expect(sent).toHaveLength(0);
  });

  it("does not write to an address that ordered after leaving the basket", async () => {
    await on();
    await cart("bought@example.com", { remindedAgoMs: 5 * DAY });
    await query(
      `insert into orders (number, lang, email, name, status, items, subtotal, total, created_at)
       values ('R-900101', 'EN', 'bought@example.com', 'Dim', 'paid', '[]'::jsonb, 120, 120, $1)`,
      [new Date(NOW - 3 * HOUR).toISOString()],
    );
    const run = await runAbandonedCartsDiscount(NOW);
    expect(run.sent).toBe(0);
    expect(run.skips).toEqual({ ordered_since: 1 });
    expect(await cartCodes()).toHaveLength(0);
  });
});

/* ---------- who gets it ----------------------------------------------------- */

describe("runAbandonedCartsDiscount() — the basket floor", () => {
  it("leaves a basket under «Скидка от … €» with the plain reminder it already had", async () => {
    await on();
    const small = await cart("small@example.com", { remindedAgoMs: 4 * DAY, total: 40 });
    const run = await runAbandonedCartsDiscount(NOW);
    expect(run.sent).toBe(0);
    expect(run.reason).toBe("below_min");
    expect(run.skips).toEqual({ below_min: 1 });
    expect(sent).toHaveLength(0);
    // …and it is not stamped, so lowering the floor later still reaches it
    expect((await cartRow(small)).discount_at).toBeNull();

    await on({ abandonedDiscountMinTotal: 0 });
    expect((await runAbandonedCartsDiscount(NOW)).sent).toBe(1);
    expect(recipients()).toEqual(["small@example.com"]);
  });

  it("writes to the basket above the floor and to no other", async () => {
    await on();
    await cart("big@example.com", { remindedAgoMs: 4 * DAY, total: 120 });
    await cart("small@example.com", { remindedAgoMs: 4 * DAY, total: 99.99 });
    const run = await runAbandonedCartsDiscount(NOW);
    expect(run.sent).toBe(1);
    expect(recipients()).toEqual(["big@example.com"]);
    expect(await cartCodes()).toHaveLength(1);
  });
});

describe("runAbandonedCartsDiscount() — an address that asked for silence", () => {
  it("sends nothing to the stop list, and does not walk past it twice", async () => {
    await on();
    const id = await cart("quiet@example.com", { remindedAgoMs: 4 * DAY });
    await query("insert into mail_optouts (email, kind) values ('quiet@example.com', 'marketing')");

    const run = await runAbandonedCartsDiscount(NOW);
    expect(run.sent).toBe(0);
    expect(run.skipped).toBe(1);
    expect(run.skips).toEqual({ opted_out: 1 });
    expect(sent).toHaveLength(0);
    /* Stamped: the basket must not be re-selected on every run for the rest
       of its life — and no code was minted for a letter nobody may get. */
    expect((await cartRow(id)).discount_at).not.toBeNull();
    expect(await cartCodes()).toHaveLength(0);

    const again = await runAbandonedCartsDiscount(NOW);
    expect(again.skips).toEqual({ already_sent: 1 });
  });

  it("sends nothing to a customer who unticked «хочу письма» by hand", async () => {
    await on();
    await cart("off@example.com", { remindedAgoMs: 4 * DAY });
    await query(
      `insert into customers (email, name, lang, marketing, marketing_off_at)
       values ('off@example.com', 'Dim', 'EN', false, now())`,
    );
    const run = await runAbandonedCartsDiscount(NOW);
    expect(run.sent).toBe(0);
    expect(run.skips).toEqual({ opted_out: 1 });
    expect(sent).toHaveLength(0);
  });
});

/* ---------- what the code may touch ----------------------------------------- */

describe("the code is for THAT basket", () => {
  /** The same two products, plus whatever the shopper added afterwards. */
  function basket(extra: PromoBasketLine[] = []): PromoBasketLine[] {
    return [
      { id: "cart-a", kind: "product", brand: "Davines", sum: 60 },
      { id: "cart-b", kind: "product", brand: "Reuzel", sum: 60 },
      ...extra,
    ];
  }

  async function issue(): Promise<{ code: string; cartId: string }> {
    await on();
    const cartId = await cart("code@example.com", { remindedAgoMs: 4 * DAY });
    expect((await runAbandonedCartsDiscount(NOW)).sent).toBe(1);
    const code = (await cartRow(cartId)).discount_code ?? "";
    expect(code).toMatch(/^REM-CART-[A-Z0-9]{6}$/);
    return { code, cartId };
  }

  it("is written on the `cart` scope, single-use, and points back at its basket", async () => {
    const { code, cartId } = await issue();
    const [row] = await query<{
      scope: string;
      scope_value: string;
      scope_lines: unknown;
      max_uses: number | string;
      value: string | number;
      active: boolean;
    }>("select scope, scope_value, scope_lines, max_uses, value, active from promo_codes where code = $1", [code]);
    expect(row.scope).toBe("cart");
    expect(row.scope_value).toBe(cartId);
    expect(typeof row.scope_lines === "string" ? JSON.parse(row.scope_lines) : row.scope_lines)
      .toEqual(["cart-a", "cart-b"]);
    expect(Number(row.max_uses)).toBe(1);
    expect(Number(row.value)).toBe(5);
    expect(row.active).toBe(true);
  });

  it("discounts the basket's own lines and nothing the shopper added afterwards", async () => {
    const { code } = await issue();
    /* 200 € of goods on the counter, only 120 of it the letter's. Five per
       cent of the basket would be 10 €; five per cent of the OFFER is 6. */
    const q = await quotePromo(code, 200, 0, basket([{ id: "stranger", kind: "product", brand: "Proraso", sum: 80 }]));
    expect(q).toMatchObject({ ok: true, discount: 6, base: 120, scope: "cart" });
    expect(q.lines).toEqual(["cart-a", "cart-b"]);
  });

  it("finds nothing in a basket built out of other products", async () => {
    const { code } = await issue();
    const q = await quotePromo(code, 80, 0, [{ id: "stranger", kind: "product", brand: "Proraso", sum: 80 }]);
    expect(q).toMatchObject({ ok: false, error: "no_match", discount: 0 });
  });

  it("cannot be spent on a gift card even when the card wears one of its ids", async () => {
    /* A card's face value is money the shop owes back in full, so five per
       cent of it is five per cent of straight cash (audit 14.09.2026). The
       whole-basket path is already closed; this is the cart scope not being
       the way back in. */
    const { code } = await issue();
    const q = await quotePromo(code, 180, 0, [
      { id: "cart-a", kind: "product", brand: "Davines", sum: 60 },
      { id: "cart-b", kind: "gift", brand: null, sum: 120 },
    ]);
    expect(q).toMatchObject({ ok: true, base: 60, discount: 3 });
    expect(q.lines).toEqual(["cart-a"]);
  });

  it("is refused without the basket, rather than priced against the whole of it", async () => {
    const { code } = await issue();
    expect(await quotePromo(code, 200, 0)).toMatchObject({ ok: false, error: "no_match" });
  });
});

/* ---------- the link and the code under it ---------------------------------- */

describe("the letter's button restores the basket and carries the code", () => {
  it("signs both into the token, prints the code as well, and the route reads them back", async () => {
    await on();
    await cart("link@example.com", { remindedAgoMs: 4 * DAY });
    expect((await runAbandonedCartsDiscount(NOW)).sent).toBe(1);

    const letter = sent[0];
    const code = (await cartCodes())[0];
    // the fallback for a link a gateway has rewritten: the code, in the letter
    expect(letter.html).toContain(code);
    expect(letter.text).toContain(code);

    const token = resumeTokenIn(letter.text);
    expect(readResumeToken(token)).toEqual({
      code,
      items: [
        { id: "cart-a", size: null, qty: 1 },
        { id: "cart-b", size: null, qty: 1 },
      ],
    });

    const { GET } = await import("@/app/api/carts/resume/route");
    const res = await GET(makeRequest(`/api/carts/resume/?t=${encodeURIComponent(token)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, code });

    /* …and a token somebody edited is not a discount. The signature is the
       whole difference between «скидка применена» and a string in a URL. */
    const bad = await GET(makeRequest(`/api/carts/resume/?t=${encodeURIComponent(token.slice(0, -2))}`));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("bad_token");
  });

  it("the FIRST letter's link still carries no code at all", async () => {
    await on();
    await cart("plain@example.com", { quietMs: 4 * HOUR });
    expect((await runAbandonedCarts(NOW)).sent).toBe(1);
    expect(readResumeToken(resumeTokenIn(sent[0].text))?.code).toBe("");
  });
});

/* ---------- a letter that never left ---------------------------------------- */

describe("a send the mail layer skipped", () => {
  it("leaves the basket owed and takes the code back with the stamp", async () => {
    await on();
    const id = await cart("nokey@example.com", { remindedAgoMs: 4 * DAY });
    delete process.env.RESEND_API_KEY;

    const dry = await runAbandonedCartsDiscount(NOW);
    expect(dry.sent).toBe(0);
    expect(dry.skipped).toBe(1);
    expect(dry.reason).toBe("no_api_key");
    expect(await cartRow(id)).toEqual({ discount_at: null, discount_code: null });
    // nothing was promised to anybody, so nothing is left lying in «Промокоды»
    expect(await cartCodes()).toHaveLength(0);

    process.env.RESEND_API_KEY = "re_test_key";
    const wet = await runAbandonedCartsDiscount(NOW + HOUR);
    expect(wet.sent).toBe(1);
    expect((await cartRow(id)).discount_code).toBe((await cartCodes())[0]);
  });
});

describe("a basket that was bought is a new story", () => {
  it("markCartRecovered() clears the second letter's stamp along with the first's", async () => {
    await on();
    const id = await cart("again@example.com", { remindedAgoMs: 4 * DAY });
    expect((await runAbandonedCartsDiscount(NOW)).sent).toBe(1);
    expect((await cartRow(id)).discount_code).not.toBeNull();

    const { markCartRecovered } = await import("@/lib/customers");
    await markCartRecovered("again@example.com");
    /* Both stamps, not one. Keeping `discount_at` would let the reminder fire
       again on the next basket and hold the discounted letter back for ever,
       and the code left on the row was written for a basket already bought. */
    expect(await cartRow(id)).toEqual({ discount_at: null, discount_code: null });
    const [row] = await query<{ reminded_at: string | null }>(
      "select reminded_at from carts where id = $1",
      [id],
    );
    expect(row.reminded_at).toBeNull();
  });
});

/* ---------- the switch, and the daily job ----------------------------------- */

describe("the pair runs on one switch", () => {
  it("«Брошенная корзина» off means neither letter", async () => {
    await setSetting("flows", { abandoned: false });
    await cart("off@example.com", { remindedAgoMs: 4 * DAY });
    const run = await runAbandonedCartsDiscount(NOW);
    expect(run).toMatchObject({ sent: 0, reason: "disabled" });
    expect(sent).toHaveLength(0);
  });

  it("the cron runs it beside the reminder and records it on its own line", async () => {
    await on();
    await cart("due@example.com", { remindedAgoMs: 4 * DAY });
    const report = await runFlows(NOW);
    expect(report.abandonedDiscount.sent).toBe(1);
    const runs = await getFlowRuns();
    expect(runs.abandonedDiscount).toMatchObject({ by: "cron", sent: 1, at: new Date(NOW).toISOString() });
  });
});

/* ---------- the four numbers ------------------------------------------------ */

describe("settings.flows — the four new keys", () => {
  it("are Renat's out of the box", async () => {
    await setSetting("flows", { abandoned: true });
    expect(await getFlows()).toMatchObject({
      abandonedHours: 3,
      abandonedDiscountDays: 3,
      abandonedDiscountPercent: 5,
      abandonedDiscountMinTotal: 100,
    });
    expect(FLOW_DEFAULTS.abandonedHours).toBe(3);
  });

  it("take what the panel may send", async () => {
    await on({
      abandonedHours: 12,
      abandonedDiscountDays: 7,
      abandonedDiscountPercent: 15,
      abandonedDiscountMinTotal: 49.5,
    });
    expect(await getFlows()).toMatchObject({
      abandonedHours: 12,
      abandonedDiscountDays: 7,
      abandonedDiscountPercent: 15,
      abandonedDiscountMinTotal: 49.5,
    });
  });

  it("refuse what it may not, each falling back to its own default", async () => {
    /* The panel clamps too; this is the door that cannot be walked round —
       the same posture unpaidRemindDays has had since 07.09.2026. A percent
       above 90 would be written onto a real promo code the checkout then
       refuses, in front of a customer the letter has already promised it. */
    for (const bad of [0, -1, 169, "soon", null, Number.NaN]) {
      await on({ abandonedHours: bad });
      expect((await getFlows()).abandonedHours, String(bad)).toBe(3);
    }
    for (const bad of [0, 61, "три", {}]) {
      await on({ abandonedDiscountDays: bad });
      expect((await getFlows()).abandonedDiscountDays, String(bad)).toBe(3);
    }
    for (const bad of [0, -5, 91, 120, "пять"]) {
      await on({ abandonedDiscountPercent: bad });
      expect((await getFlows()).abandonedDiscountPercent, String(bad)).toBe(5);
    }
    for (const bad of [-1, 10_001, "сто", []]) {
      await on({ abandonedDiscountMinTotal: bad });
      expect((await getFlows()).abandonedDiscountMinTotal, String(bad)).toBe(100);
    }
    // …and zero IS an answer for the floor: «всем, кому ушло первое письмо»
    await on({ abandonedDiscountMinTotal: 0 });
    expect((await getFlows()).abandonedDiscountMinTotal).toBe(0);
  });

  it("abandonedHours is the wait the FIRST letter really makes", async () => {
    await on({ abandonedHours: 6 });
    await cart("wait@example.com", { quietMs: 4 * HOUR });
    const early = await runAbandonedCarts(NOW);
    expect(early.sent).toBe(0);
    expect(early.skips).toEqual({ too_fresh: 1 });

    const due = await runAbandonedCarts(NOW + 3 * HOUR);
    expect(due.sent).toBe(1);
    expect(recipients()).toEqual(["wait@example.com"]);
  });
});
