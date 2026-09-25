/**
 * A promo code the assistant proposes carries the terms the owner named and
 * no others — ai-assistant-promo e2 (verification pass on staging,
 * 25.09.2026): «сделай промокод CLAUDETEST10 на 10 %» came back as
 * «скидка 10% · до 30.09.2026 · 100 использований». Neither the date nor the
 * cap was asked for; they are the literal values of the create_promo example
 * in the assistant's prompt (src/app/api/assistant/route.ts), which the model
 * copied as if they were defaults.
 *
 * Two doors: the example no longer carries a date or a cap, and the prompt
 * says they go in only when the owner names them; and since a prompt is only
 * a request, the route holds the action to the owner's own recent words as
 * well (promoAsAsked in src/app/api/assistant/actions.ts) — an end or a start
 * stays only when he spoke of time, a cap only when he spoke of a number of
 * uses or a limit. OpenAI is a stubbed fetch; nothing leaves the machine.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { promoAsAsked } from "@/app/api/assistant/actions";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

function req(body: unknown, cookie: string) {
  return new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
}

/** Records what the route asks the model and answers with `reply`. */
function stubOpenAI(reply: Record<string, unknown>) {
  const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({ model: "gpt-4.1-mini", choices: [{ message: { content: JSON.stringify(reply) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }));
  return sent;
}

/* What staging's model answered: the example's date and cap copied in. */
const COPIED = { endsAt: "2026-09-30T23:59:59Z", maxUses: 100 };
const promo = (code: string, value: number, extra: Record<string, unknown> = {}) =>
  ({ type: "create_promo", promo: { code, kind: "percent", value, minSubtotal: 0, note: "", ...extra } });

describe("promoAsAsked — the owner's words decide a promo code's date and cap", () => {
  const withBoth = promo("X10", 10, { startsAt: "2026-09-26T00:00:00.000Z", ...COPIED }) as { promo: Record<string, unknown> };
  const kept = (words: string) => {
    const out = promoAsAsked({ type: "create_promo", promo: { ...withBoth.promo } }, words) as { promo: Record<string, unknown> };
    return { date: out.promo.endsAt !== null && out.promo.startsAt !== null, cap: out.promo.maxUses !== null };
  };

  it("a plain request: neither a date nor a cap survives", () => {
    for (const words of [
      "сделай промокод CLAUDETEST10 на 10 %",
      "сделай промокод на 10%",
      "промокод SUVI10 на бесплатную доставку",
      "сделай код с тем же названием ещё раз, на 20 %",
      "tee 10% sooduskood",
      "make a 10 % promo code",
    ]) {
      expect(kept(words), words).toEqual({ date: false, cap: false });
    }
  });

  it("a date or a period the owner named keeps the date, and only the date", () => {
    for (const words of [
      "код на бесплатную доставку до конца месяца",
      "промокод на 15 % на две недели",
      "скидка 10 % до 30.09",
      "промокод до воскресенья",
      "код на чёрную пятницу",
      "промокод на 10% до 1 октября",
      "sooduskood 10% kuni pühapäevani",
      "kood, mis kehtib nädal",
      "a 10% code valid until Sunday",
      "10 % off for a week",
    ]) {
      expect(kept(words), words).toEqual({ date: true, cap: false });
    }
  });

  it("a number of uses or a limit the owner named keeps the cap, and only the cap", () => {
    for (const words of [
      "промокод на 10 % на 100 использований",
      "код для первых 50 покупателей",
      "одноразовый промокод на 5 €",
      "промокод с лимитом",
      "kood esimesele 20 kliendile",
      "a code for the first 100 customers",
      "single-use code, 10 %",
    ]) {
      expect(kept(words), words).toEqual({ date: false, cap: true });
    }
  });

  it("both, when both were named", () => {
    expect(kept("AUTUMN15 на 15 % до конца октября, на 50 использований")).toEqual({ date: true, cap: true });
  });

  it("touches nothing but a proposed promo code", () => {
    const other = { type: "toggle_promo", code: "SUVI10", value: false };
    expect(promoAsAsked(other, "выключи промокод")).toBe(other);
    expect(promoAsAsked(null, "что-то")).toBeNull();
    const plain = promo("X10", 10, { endsAt: null, maxUses: null, startsAt: null });
    expect(promoAsAsked(plain, "сделай промокод на 10%"), "an action with nothing to drop is handed back as it came").toBe(plain);
  });
});

describe("POST /api/assistant — a promo code from a plain request carries no date and no cap", () => {
  let admin = "";
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    await teardownDb();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function ask(messages: Array<{ role: string; content: string }>, action: Record<string, unknown>, reply = "Сделал промокод — подтвердите.") {
    const sent = stubOpenAI({ reply, product_ids: [], tab: "promos", action });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages }, admin));
    expect(res.status).toBe(200);
    return { body: await res.json(), system: sent[0].messages[0].content };
  }

  it("the prompt's example is no longer a set of defaults, and it says the terms are the owner's to name", async () => {
    const { body, system } = await ask([{ role: "user", content: "сделай промокод CLAUDETEST10 на 10 %" }], promo("CLAUDETEST10", 10));
    expect(body.v).toBe(28);   // r28: a promo code's date and cap only when the owner names them
    const example = system.slice(system.indexOf('{"type":"create_promo"'), system.indexOf("\n", system.indexOf('{"type":"create_promo"')));
    expect(example, "the example still carries a date").not.toMatch(/endsAt|2026-09-30/);
    expect(example, "the example still carries a cap").not.toMatch(/maxUses|100/);
    expect(system).toMatch(/ONLY when the owner himself named a date or a period/);
    expect(system).toMatch(/ONLY when he named a number of uses or a limit/);
    /* …and it says what the action is: create_promo only ever MAKES a code —
       the panel posts it with `create: true` and the promo route answers 409
       «exists» for a name the shop has. «make or edit» invited the model to
       promise a change it could not make (staging: «уже создаётся с 20 %
       скидкой. Подтвердите…» over a code that stayed at 10 %). */
    expect(example, "the example still offers to edit a code").not.toMatch(/\bedit\b/i);
    expect(example).toMatch(/make a NEW promo code/);
    expect(example).toMatch(/«Маркетинг → Промокоды»/);
  });

  it("the model copies the old example anyway: the proposal the owner is shown has neither, and the reply says so", async () => {
    const { body } = await ask(
      [{ role: "user", content: "сделай промокод CLAUDETEST10 на 10 %" }],
      promo("CLAUDETEST10", 10, COPIED),
      "Сделал промокод CLAUDETEST10 на 10 % до 30.09.2026, на 100 использований — подтвердите.",
    );
    expect(body.action.type).toBe("create_promo");
    expect(body.action.promo).toMatchObject({ code: "CLAUDETEST10", kind: "percent", value: 10, endsAt: null, startsAt: null, maxUses: null });
    expect(body.reply).toContain("Срок и лимит использований не ставлю — вы их не называли.");
  });

  it("what the owner named stays: a date and a cap asked for are proposed as asked, with nothing added to the reply", async () => {
    const { body } = await ask(
      [{ role: "user", content: "промокод AUTUMN15 на 15 % до конца октября, на 50 использований" }],
      promo("AUTUMN15", 15, { endsAt: "2026-10-31T23:59:59Z", maxUses: 50 }),
      "Сделал AUTUMN15 — подтвердите.",
    );
    expect(body.action.promo).toMatchObject({ code: "AUTUMN15", value: 15, endsAt: "2026-10-31T23:59:59.000Z", maxUses: 50 });
    expect(body.reply).toBe("Сделал AUTUMN15 — подтвердите.");
  });

  it("a date named two messages back still counts — the owner answered a question in between", async () => {
    const { body } = await ask(
      [
        { role: "user", content: "сделай промокод на 10 % до конца месяца" },
        { role: "assistant", content: "Как назвать код?" },
        { role: "user", content: "назови SALE10" },
      ],
      promo("SALE10", 10, COPIED),
      "Сделал SALE10 — подтвердите.",
    );
    expect(body.action.promo.endsAt).toBe("2026-09-30T23:59:59.000Z");
    expect(body.action.promo.maxUses, "a cap nobody asked for").toBeNull();
    expect(body.reply).toContain("Лимит использований не ставлю — вы его не называли.");
  });

  it("the note is in the language the owner writes in", async () => {
    const { body } = await ask([{ role: "user", content: "make a 10 % promo code AUTUMN10 please" }], promo("AUTUMN10", 10, COPIED), "Done — confirm below.");
    expect(body.action.promo).toMatchObject({ endsAt: null, maxUses: null });
    expect(body.reply).toContain("No end date or usage limit — you did not name one.");
  });
});
