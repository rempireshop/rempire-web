/**
 * What the admin assistant is told about the panel it lives in
 * (adminPrompt() in src/app/api/assistant/route.ts). The panel runs on the
 * shop's real database, so the prompt must never call the figures a demo
 * or fictional, must carry the owner's own products with their sizes, and
 * must offer update_product for them — and the route must let that action
 * through for a `c-…` id it listed. OpenAI is stubbed at fetch; what is
 * asserted is the system message the route composed.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { createCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

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
    expect(body.v).toBe(20);

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
});
