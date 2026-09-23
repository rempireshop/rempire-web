/**
 * «Прислать пример» — every automatic letter, in the owner's own inbox, now.
 *
 * Dim, 23.09.2026, on staging: «I do not seem to have gotten the letter» about
 * the abandoned cart, and about its discounted follow-up «I cannot manually
 * force it». Both letters are sent by a job that runs once a day at 07:00 UTC,
 * so on a test day there was no way to SEE either of them. The panel now sends
 * a sample of any letter from its row, through the route that «Отправить мне
 * тест» in the letter's editor has always used (POST /api/admin/mail/test/).
 *
 * What a sample may and may not do, pinned here:
 *   · it is the real template, through the owner's own texts, with the owner's
 *     own numbers — the discount letter used to print the factory 5 % whatever
 *     «Размер скидки» said, because this route passed the birthday percent and
 *     forgot the cart one;
 *   · it says it is a sample: «[test]» in front of the subject;
 *   · it touches nothing: no cart is stamped as reminded, no promo code is
 *     written, no «Последний запуск» line moves. The code it prints is one the
 *     generator can never produce, so nobody can spend it.
 *
 * Real Postgres (PGlite), Resend stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { ADMIN_COOKIE, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const BASE = "https://test.rempireshop.com";
let admin = "";

interface Sent {
  to: string[];
  subject: string;
  html: string;
  text: string;
}
const sent: Sent[] = [];

function stubResend(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit) => {
      if (String(url).includes("api.resend.com")) {
        sent.push(JSON.parse(String(init.body)) as Sent);
        return new Response(JSON.stringify({ id: `re_${sent.length}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unstubbed" }), { status: 502 });
    }),
  );
}

async function sample(template: string, to = "dim@example.com"): Promise<Response> {
  const { POST } = await import("@/app/api/admin/mail/test/route");
  return POST(
    new Request(`${BASE}/api/admin/mail/test/`, {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ template, to, lang: "RU" }),
    }),
  );
}

async function setFlows(value: Record<string, unknown>): Promise<void> {
  await query(
    `insert into settings (key, value) values ('flows', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(value)],
  );
}

/* Every letter the panel offers a sample of from a row with a switch — the
   four automatic ones and the discounted cart letter that follows the first. */
const FLOW_TEMPLATES = ["order-unpaid", "back-in-stock", "abandoned-cart", "abandoned-cart-discount", "birthday"];

let savedKey: string | undefined;

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = BASE;
  savedKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key";
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
  vi.unstubAllGlobals();
  await teardownDb();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimits();
  sent.length = 0;
  stubResend();
});

describe("a sample of the discounted cart letter", () => {
  it("offers the percent the owner set, not the factory five", async () => {
    await setFlows({ abandoned: true, abandonedDiscountPercent: 12 });
    const res = await sample("abandoned-cart-discount");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("12 %");
    expect(sent[0].subject).not.toContain("5 %");
    expect(sent[0].text).toContain("12 %");
  });

  it("prints a code the shop could never have issued", async () => {
    await sample("abandoned-cart-discount");
    const code = /REM-CART-[A-Z0-9]+/.exec(sent[0].text)?.[0] ?? "";
    expect(code, "the sample carries no code at all").not.toBe("");
    // cartPromoCode() writes six characters after the prefix — never four
    expect(code).not.toMatch(/^REM-CART-[A-Z2-9]{6}$/);
    const rows = await query("select 1 from promo_codes where code = $1", [code]);
    expect(rows).toHaveLength(0);
  });
});

describe("every automatic letter can be sampled now, and the sample says what it is", () => {
  for (const template of FLOW_TEMPLATES) {
    it(`${template}: [test] in the subject, sent to the typed address`, async () => {
      const res = await sample(template, "owner@example.com");
      expect(res.status, template).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toEqual(["owner@example.com"]);
      expect(sent[0].subject.startsWith("[test] "), sent[0].subject).toBe(true);
    });
  }
});

describe("a sample touches nothing a real run would", () => {
  it("stamps no cart, writes no code and records no run", async () => {
    await setFlows({ abandoned: true, abandonedHours: 1, abandonedDiscountDays: 1, abandonedDiscountMinTotal: 0 });
    // a basket due for the first letter, and one due for the second
    await query(
      `insert into carts (email, lang, items, total, updated_at, reminded_at) values
         ('fresh@example.com', 'RU', '[{"id":"x","title":"X","qty":1,"price":120}]'::jsonb, 120, now() - interval '5 hours', null),
         ('due@example.com',   'RU', '[{"id":"y","title":"Y","qty":1,"price":120}]'::jsonb, 120, now() - interval '5 days', now() - interval '3 days')`,
    );
    const promosBefore = await query<{ n: number }>("select count(*)::int as n from promo_codes");

    for (const template of FLOW_TEMPLATES) {
      expect((await sample(template)).status, template).toBe(200);
    }

    const carts = await query<{ email: string; reminded: boolean; discounted: boolean }>(
      `select email, reminded_at is not null as reminded, discount_at is not null as discounted
         from carts order by email`,
    );
    expect(carts).toEqual([
      { email: "due@example.com", reminded: true, discounted: false },
      { email: "fresh@example.com", reminded: false, discounted: false },
    ]);
    const promosAfter = await query<{ n: number }>("select count(*)::int as n from promo_codes");
    expect(promosAfter[0].n).toBe(promosBefore[0].n);
    const runs = await query("select 1 from settings where key = 'flow_runs'");
    expect(runs).toHaveLength(0);
    // …and every letter went to the owner, not to the two shoppers
    expect(sent.flatMap((m) => m.to)).not.toContain("fresh@example.com");
    expect(sent.flatMap((m) => m.to)).not.toContain("due@example.com");
  });
});
