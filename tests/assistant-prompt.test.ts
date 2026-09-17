/**
 * What the admin assistant is told about the panel it lives in
 * (adminPrompt() in src/app/api/assistant/route.ts). The panel runs on the
 * shop's real database, so the prompt must never call the figures a demo
 * or fictional, must carry the owner's own products with their sizes, and
 * must offer update_product for them — and the route must let that action
 * through for a `c-…` id it listed. OpenAI is stubbed at fetch; what is
 * asserted is the system message the route composed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { getOverviewSummary } from "@/lib/analytics";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { createCustomProduct } from "@/lib/custom-products";
/* The Tallinn calendar, never getUTC*: a date built in UTC passes on a machine
   set to Tallinn and fails on the build server three hours away. */
import { addShopDays, shopDay, shopDayStart } from "@/lib/day";
import { recordLogin } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { listCustomersAdmin } from "@/lib/loyalty";
import { createOrder } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

/* The panel's own suggestion chips, read out of public/shop2/app.js the way
   tests/i18n-rules.test.ts reads the translation tables — the literal itself,
   evaluated, not a copy of it kept in step by hand. A chip added there and
   nowhere else is what CANNED_SUGGESTIONS below is for. */
const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const appSrc = readFileSync(APP_JS, "utf8");
function sliceLiteral(marker: string, terminator: string): string {
  const at = appSrc.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = appSrc.indexOf(terminator, at);
  if (end < 0) throw new Error(`${marker} in public/shop2/app.js has no terminator ${JSON.stringify(terminator)}`);
  return appSrc.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}
const ADM_ASK = runInNewContext("(" + sliceLiteral("var ADM_ASK = ", "\n  ];") + ")") as string[];
const ASK_CHOICES = runInNewContext("(" + sliceLiteral("var ASK_CHOICES = ", "\n  };") + ")") as Record<string, string[]>;

function req(body: unknown, cookie: string) {
  return new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
}

/** Records the request the route sends to OpenAI and answers with `reply`. */
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

describe("the admin prompt tells the truth about the panel", () => {
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
    await exec("truncate custom_products");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never calls the figures a demo, lists the owner's products with their sizes, and offers update_product for them", async () => {
    const balm = await createCustomProduct({ brand: "Proraso", name: "Beard Balm Cypress — бальзам для бороды", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] });
    const sent = stubOpenAI({ reply: "ок", product_ids: [], tab: "goods", action: { type: "update_product", id: balm.id, name: "Beard Balm Cypress & Vetyver — бальзам для бороды", sizes: [{ size: "100 мл", price: 16.9 }, { size: "250 мл", price: 24.9 }] } });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "переименуй бальзам" }] }, admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.v).toBe(22);

    expect(sent).toHaveLength(1);
    const system = sent[0].messages[0];
    expect(system.role).toBe("system");
    const prompt = system.content;
    // the stale claims, word for word: a demo panel, fictional figures, invented orders, demo changes
    expect(prompt).not.toMatch(/DEMO admin|DEMO FIGURES|figures are fictional|are still fictional|#1043|#1044|Google 44%|demo changes|applied in the panel\)/);
    expect(prompt).toContain("runs on the shop's real database");
    expect(prompt).toContain("Never call anything here a demo, a test or fictional");
    expect(prompt).toContain("«Настройки → Журнал»");
    expect(prompt).toContain(`${balm.id}|Proraso|Beard Balm Cypress — бальзам для бороды|beard|14.9€|in|sizes: 100 мл=14.9€, 250 мл=24.9€`);
    expect(prompt).toContain('{"type":"update_product"');
    expect(prompt).toContain("EXAMPLE — a product the owner created earlier");

    // …and the action the model wrote for that id survives the whitelist
    expect(body.action).toEqual({
      type: "update_product", id: balm.id,
      name: "Beard Balm Cypress & Vetyver — бальзам для бороды",
      sizes: ["100 мл", "250 мл"], prices: [16.9, 24.9],
    });
  });

  it("drops an update_product for an id the prompt did not list", async () => {
    stubOpenAI({ reply: "ок", action: { type: "update_product", id: "c-nobody-has-this", name: "x" } });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(req({ mode: "admin", messages: [{ role: "user", content: "переименуй" }] }, admin))).json();
    expect(body.action).toBeNull();
  });

  /* The CUSTOMERS block is the one place in the whole prompt where a shopper's
     own details would leave the shop — and it went out on any admin message
     carrying «балл», «клиент» or «партнёр», while the privacy policy tells that
     same shopper «Тексты помощника готовит OpenAI — без передачи ему ваших
     персональных данных» (public/shop/legal.ru.js). adjust_points has always
     taken the row id, so the id is what the model is given. */
  it("names a customer to the model by id, never by e-mail", async () => {
    await recordLogin("marta@example.com", "RU");
    await query("update customers set name = 'Марта' where email = $1", ["marta@example.com"]);
    const [row] = await listCustomersAdmin({ limit: 1 });

    const sent = stubOpenAI({ reply: "ок", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "начисли Марте 50 баллов" }] }, admin));
    expect(res.status).toBe(200);
    const prompt = sent[0].messages[0].content;

    // the block really was included, and it names her by row id
    expect(prompt).toContain(`Марта|${row.id}|retail|0`);
    // …and no address of hers reached OpenAI
    expect(prompt).not.toContain("marta@example.com");
    expect(prompt).not.toContain("@example.com");
  });

  /* «Набор» vs «промокод» — Dim, 07.09.2026: he asked for a set of products
     and got the live promo code «Beardset50». The words collide, so the route
     reads the owner's own sentence itself (src/app/api/assistant/intent.ts),
     tells the model which of the two it is looking at, and refuses the other
     one however confidently the model proposes it. Here the model is stubbed
     into making exactly the mistake it made for Dim. */
  describe("«набор» is never a promo code", () => {
    const cat = catalogueMin as Array<{ id: string }>;
    const two = [{ id: cat[0].id, variant: 0, qty: 1 }, { id: cat[1].id, variant: 0, qty: 1 }];
    const title = { RU: "Набор для бороды", ET: "Habemekomplekt", EN: "Beard set" };
    const beardset50 = {
      type: "create_promo",
      promo: { code: "BEARDSET50", kind: "percent", value: 50, minSubtotal: 0, note: "набор для бороды" },
    };

    /* The route's own per-IP limiter is ten messages a minute and lives in
       the module, not in resetRateLimits() — so every question here comes
       from an address of its own. */
    let nth = 0;
    function askReq(message: string) {
      nth += 1;
      return new NextRequest(`${ORIGIN}/api/assistant/`, {
        method: "POST",
        headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie: admin, "x-real-ip": `10.0.0.${nth}` },
        body: JSON.stringify({ mode: "admin", messages: [{ role: "user", content: message }] }),
      });
    }

    async function ask(message: string, action: unknown) {
      stubOpenAI({ reply: "Сделал.", product_ids: [], tab: "promos", action });
      const { POST } = await import("@/app/api/assistant/route");
      const res = await POST(askReq(message));
      return res.json();
    }

    it("refuses the promo code the assistant made for «хочу набор Beardset со скидкой 50 %»", async () => {
      const body = await ask("хочу набор Beardset со скидкой 50 %", beardset50);
      expect(body.action, "a live promo code for a request that said «набор»").toBeNull();
      expect(body.ask).toBe("bundle_or_promo");
      expect(body.reply).toContain("набор");
      expect(body.reply).toContain("промокод");
      expect(body.retry).toBeUndefined();
    });

    it("lets the same promo code through when the owner asked for one", async () => {
      const body = await ask("сделай промокод на 50 %", beardset50);
      expect(body.action).toMatchObject({ type: "create_promo", promo: { code: "BEARDSET50", value: 50 } });
      expect(body.ask).toBeUndefined();
    });

    it("lets a set proposal through for «собери набор для бороды»", async () => {
      const body = await ask("собери набор для бороды", { type: "propose_bundle", title, cat: "beard", items: two });
      expect(body.action).toMatchObject({ type: "propose_bundle", cat: "beard" });
      expect(body.action.items).toHaveLength(2);
      expect(body.ask).toBeUndefined();
    });

    it("refuses a set proposal when the owner asked for a promo code", async () => {
      const body = await ask("сделай купон на 10 %", { type: "propose_bundle", title, items: two });
      expect(body.action).toBeNull();
      expect(body.ask).toBe("bundle_or_promo");
    });

    it("asks — and proposes nothing — when the sentence could mean either", async () => {
      for (const action of [beardset50, { type: "propose_bundle", title, items: two }]) {
        const body = await ask("сделай скидку на несколько товаров", action);
        expect(body.action).toBeNull();
        expect(body.ask).toBe("bundle_or_promo");
        vi.unstubAllGlobals();
      }
    });

    it("still offers the chips when the model asked by itself", async () => {
      const body = await ask("сделай скидку на эти три товара", null);
      expect(body.action).toBeNull();
      expect(body.ask).toBe("bundle_or_promo");
    });

    it("tells the model which of the two the message is, and how they differ", async () => {
      const sent = stubOpenAI({ reply: "ок", action: null });
      const { POST } = await import("@/app/api/assistant/route");
      await POST(askReq("собери набор для бороды"));
      const prompt = sent[0].messages[0].content;
      expect(prompt).toContain("НАБОР or ПРОМОКОД");
      expect(prompt).toContain("THIS MESSAGE IS ABOUT A SET");
      expect(prompt).toContain("create_promo is forbidden for this message");
      // …and the set's own SEO budget rides along with it
      expect(prompt).toContain("SETS («наборы», propose_bundle / set_bundle) in detail");
      expect(prompt).toContain("THE FIRST 155 CHARACTERS BECOME THE GOOGLE SNIPPET");
    });

    /* «Помощнику нужен delete?» — Dim, 08.09.2026: yes. It reaches the panel
       for a sentence that asked for it, and it is held to the owner's words
       as hard as making a set is, because there is no journal entry behind it
       to undo with. */
    it("lets a delete through for «удали набор», and never for a sentence about a promo code", async () => {
      const gone = await ask("удали набор для бороды", { type: "delete_bundle", id: "beard-start", title });
      expect(gone.action, "the assistant may delete a set now").toEqual({ type: "delete_bundle", id: "beard-start" });
      expect(gone.ask).toBeUndefined();
      vi.unstubAllGlobals();

      const kept = await ask("выключи промокод SUVI10", { type: "delete_bundle", id: "beard-start" });
      expect(kept.action, "a sentence about a promo code deleted a set").toBeNull();
      expect(kept.ask).toBe("bundle_or_promo");
    });

    it("tells the model that a delete cannot be undone, and what to reach for instead", async () => {
      const sent = stubOpenAI({ reply: "ок", action: null });
      const { POST } = await import("@/app/api/assistant/route");
      await POST(askReq("удали набор для бороды"));
      const prompt = sent[0].messages[0].content;
      expect(prompt).toContain('{"type":"delete_bundle","id":"<id from SETS above>"}');
      expect(prompt).toContain("This cannot be undone");
      // …and the cheaper thing to do instead, so it is not the first reach
      expect(prompt).toContain("a hidden set keeps its address, a deleted one does not");
    });

    it("leaves an ordinary price change alone", async () => {
      const body = await ask("подними цену на PLUMPING.WASH до 9 евро", {
        type: "set_price", id: "kevin-muprhy-plumping-wash", value: 9,
      });
      expect(body.action).toMatchObject({ type: "set_price", value: 9 });
      expect(body.ask).toBeUndefined();
    });
  });

  /* Renat's acceptance run, 13.09.2026. Two faults in one sentence: «I am
     asking in english which orders are waiting to be shipped and get russian
     answer that such information is not loaded.» */
  describe("the language of the question, and the parcels waiting to go out", () => {
    let nth = 200;
    function askReq(message: string, panelLang?: string) {
      nth += 1;
      return new NextRequest(`${ORIGIN}/api/assistant/`, {
        method: "POST",
        headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie: admin, "x-real-ip": `10.0.1.${nth - 200}` },
        body: JSON.stringify({ mode: "admin", lang: panelLang, messages: [{ role: "user", content: message }] }),
      });
    }
    async function promptFor(message: string, panelLang?: string) {
      const sent = stubOpenAI({ reply: "ok", product_ids: [], tab: "", action: null });
      const { POST } = await import("@/app/api/assistant/route");
      await POST(askReq(message, panelLang));
      return sent[0].messages[0].content;
    }

    it("is told to answer in the language of the owner's message, not the panel's", async () => {
      // his own case: English question, Russian panel
      const en = await promptFor("which orders are waiting to be shipped?", "RU");
      expect(en).toContain("ANSWER IN ENGLISH");
      expect(en).not.toMatch(/ANSWER IN RUSSIAN/);
      vi.unstubAllGlobals();

      // and the other way round: Russian question, English panel
      const ru = await promptFor("какие заказы ждут отправки?", "EN");
      expect(ru).toContain("ANSWER IN RUSSIAN");
      vi.unstubAllGlobals();

      // nothing in the words to go on → the panel's language, as before
      const bare = await promptFor("Proraso 30 ml", "ET");
      expect(bare).toContain("ANSWER IN ESTONIAN");
    });

    it("carries the queue «Обзор» counts, by name, and no longer says it is not loaded", async () => {
      /* A paid web order is a parcel waiting to go out — the same predicate
         qAttention()'s `to_ship` uses (tests/overview.test.ts covers it). */
      const { createOrder } = await import("@/lib/orders");
      const order = await createOrder({
        lang: "ru",
        items: [{ id: "kevin-muprhy-plumping-wash", qty: 1 }],
        customer: { name: "Мария Тамм", email: "maria-toship@example.com", phone: "+372 5555 5555" },
        shipping: { method: "parcel", country: "EE" },
      });
      await query("update orders set status = 'paid' where id = $1", [order.id]);
      try {
        const prompt = await promptFor("какие заказы ждут отправки?");
        expect(prompt).toContain("ORDERS WAITING TO BE SHIPPED");
        expect(prompt).toContain(order.number);
        expect(prompt).toContain("Мария Тамм");
        // the sentence that told the model to deny it, gone
        expect(prompt).not.toMatch(/orders waiting to be shipped are not in this prompt/);
        expect(prompt).toContain("never say it is not loaded");
      } finally {
        await query("delete from orders where id = $1", [order.id]);
      }
    });

    it("says the queue is empty rather than inventing one", async () => {
      const prompt = await promptFor("what do I have to ship?");
      expect(prompt).toContain("ORDERS WAITING TO BE SHIPPED");
      expect(prompt).toContain("nothing is waiting to go out right now");
    });
  });

  /* Renat, 14.09.2026: «The assistant offers a question "show me analytics for
     this week" — but when I ask it, then it says that analytics are not loaded
     to assistant — open the analytics page.»

     The assistant was telling the truth and the chip was lying: the prompt
     carried exactly one sales window, «SALES, last 30 days», built from what
     the panel had already fetched — and when it had not fetched it, that block
     told the model in so many words to say the figures were not available.
     Nothing in the prompt was ever seven days long. */
  describe("the week, and the chips that promise it", () => {
    let nth = 0;
    function askReq(message: string, panelLang?: string) {
      nth += 1;
      return new NextRequest(`${ORIGIN}/api/assistant/`, {
        method: "POST",
        headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie: admin, "x-real-ip": `10.0.2.${nth}` },
        body: JSON.stringify({ mode: "admin", lang: panelLang, messages: [{ role: "user", content: message }] }),
      });
    }
    async function promptFor(message: string, panelLang?: string) {
      const sent = stubOpenAI({ reply: "ok", product_ids: [], tab: "", action: null });
      const { POST } = await import("@/app/api/assistant/route");
      await POST(askReq(message, panelLang));
      const prompt = sent[0].messages[0].content;
      vi.unstubAllGlobals();
      return prompt;
    }

    /** A real order, priced by createOrder(), then backdated, paid and given a
     *  round total — the shape the paid transition leaves behind
     *  (tests/overview.test.ts orderAt()). `daysBack` is counted on the Tallinn
     *  calendar and the order is placed at noon of that day, so neither a day
     *  boundary nor the 168-hour window's own edge can move it. */
    async function paidOrderAt(daysBack: number, total: number): Promise<string> {
      const day = addShopDays(shopDay(new Date()), -daysBack);
      const at = new Date(shopDayStart(day).getTime() + 12 * 3_600_000);
      const o = await createOrder({
        lang: "ru",
        items: [{ id: "kevin-muprhy-plumping-wash", qty: 1 }],
        customer: { name: "Мария Тамм", email: "maria-week@example.com", phone: "+372 5555 5555" },
        shipping: { method: "parcel", country: "EE" },
      });
      await query(
        "update orders set status = 'paid', created_at = $2, updated_at = $2, total = $3 where id = $1",
        [o.id, at.toISOString(), total],
      );
      return day;
    }

    beforeEach(async () => {
      await exec("truncate orders restart identity cascade");
    });

    it("carries the week's takings, orders, average order, days and the change — and they are «Обзор»'s own numbers", async () => {
      const d1 = await paidOrderAt(1, 120);
      const d2 = await paidOrderAt(2, 60);
      await paidOrderAt(3, 20);
      await paidOrderAt(9, 100); // the week before, for the comparison

      const prompt = await promptFor("покажи аналитику за неделю");
      expect(prompt).toContain("SALES THIS WEEK");
      // the five figures the owner asked for, and no sixth
      expect(prompt).toContain("takings 200.00 €, 3 orders, average order 66.67 €, 28.57 € a day on average.");
      expect(prompt).toContain("Against the previous week: +100% against the previous 7 days (100.00 €, 1 orders).");
      expect(prompt).toContain(`${d1} | 120.00 € | 1`);
      expect(prompt).toContain(`${d2} | 60.00 € | 1`);

      /* …and the same figures «Обзор» puts on the first screen. Not "close to":
         the same window and the same two queries (weekSales in
         src/lib/analytics.ts), so the owner can never be shown two numbers. */
      const over = await getOverviewSummary();
      expect(over.revenue7d).toEqual({ total: 200, perDay: 28.57, orders: 3 });
      expect(prompt).toContain(`takings ${over.revenue7d.total.toFixed(2)} €, ${over.revenue7d.orders} orders`);
      expect(prompt).toContain(`${over.revenue7d.perDay.toFixed(2)} € a day on average`);
      for (const row of over.revenueByDay) {
        expect(prompt, "a day «Обзор» draws that the prompt does not carry").toContain(
          `${row.day} | ${row.revenue.toFixed(2)} € | ${row.orders}`,
        );
      }
    });

    it("no longer tells the model to answer that the figures are not available", async () => {
      const prompt = await promptFor("сколько продали за неделю?");
      // the sentence the assistant was reading out to him, gone
      expect(prompt).not.toMatch(/say the figures are not available right now/);
      expect(prompt).toContain("never say the week is not loaded");
      /* The thirty-day window is still the panel's to load, and most questions
         arrive before it has — saying so must no longer deny the week. */
      expect(prompt).toContain("the 30-day window is not open in this panel right now");
      expect(prompt).toContain("the week above still stands");
    });

    it("says the week is empty rather than inventing one", async () => {
      const prompt = await promptFor("how much did we sell this week?");
      expect(prompt).toContain("takings 0.00 €, 0 orders, average order 0.00 €");
      expect(prompt).toContain("(no paid orders on any day of this week)");
      expect(prompt).toContain("the previous 7 days took nothing");
    });

    /* The rule settled on 13.09.2026 — the answer goes in the language of the
       question — is a paragraph UNDER these data blocks, so a new block above
       it is exactly what could bury it. */
    it("still answers the week in the language of the question, not the panel's", async () => {
      await paidOrderAt(1, 120);
      const en = await promptFor("show me analytics for this week", "RU");
      expect(en).toContain("ANSWER IN ENGLISH");
      expect(en).not.toMatch(/ANSWER IN RUSSIAN/);
      expect(en).toContain("SALES THIS WEEK");
      expect(en).toContain("takings 120.00 €");

      const ru = await promptFor("сколько продали за неделю?", "EN");
      expect(ru).toContain("ANSWER IN RUSSIAN");
      expect(ru).toContain("SALES THIS WEEK");
    });

    /* Every question the panel offers with one tap is a PROMISE. This is the
       table of what backs each one; a chip added to public/shop2/app.js and
       not to this table fails here rather than in front of the owner. */
    const CANNED_SUGGESTIONS: Array<{ chip: RegExp; needs: string[] }> = [
      // «Что заканчивается и что дозаказать?» — stockSummaryForPrompt()
      { chip: /заканчива|дозаказ/i, needs: ["STOCK — tracked products reading"] },
      // «Какие заказы ждут отправки?» — toShipForPrompt(), 13.09.2026
      { chip: /ждут отправки/i, needs: ["ORDERS WAITING TO BE SHIPPED"] },
      // «Сколько продали за неделю?» — weekForPrompt(), this change
      { chip: /продали за неделю/i, needs: ["SALES THIS WEEK", "takings "] },
      // the two chips the route offers when «набор» and «промокод» collide
      { chip: /набор/i, needs: ['{"type":"propose_bundle"', "SETS («наборы», propose_bundle / set_bundle) in detail"] },
      { chip: /промокод/i, needs: ['{"type":"create_promo"', "PROMO CODES (create_promo) in detail"] },
    ];

    it("every canned suggestion has the data behind it — asked as the owner would tap it", async () => {
      const chips = [...ADM_ASK, ...Object.values(ASK_CHOICES).flat()];
      expect(chips.length, "the chips could not be read out of public/shop2/app.js").toBeGreaterThanOrEqual(5);
      await paidOrderAt(1, 120);
      for (const chip of chips) {
        const cap = CANNED_SUGGESTIONS.find((c) => c.chip.test(chip));
        expect(cap, `the chip «${chip}» promises something no capability in this table covers`).toBeTruthy();
        const prompt = await promptFor(chip);
        for (const needle of cap!.needs) {
          expect(prompt, `«${chip}» is offered, but the prompt carries no ${needle}`).toContain(needle);
        }
      }
    });
  });
});
