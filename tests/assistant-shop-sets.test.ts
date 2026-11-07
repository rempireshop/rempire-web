/**
 * The shop's sets in the CUSTOMER's chat (Dim, 07.11.2026) —
 * src/app/api/assistant/shop-sets.ts and the shop half of
 * src/app/api/assistant/route.ts.
 *
 * Tried on the live chat before any of it was written: asked «есть набор для
 * бороды?» it put two loose bottles together and called them a set, while the
 * search box listed seven real ones; asked «подарок девушке до 50 €» it said
 * the shop sold only men's care; asked about tattoo aftercare it said there
 * was nothing, with four Yumain products in stock. The fixtures below are
 * shaped like the live sets of that day.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { relevantProducts } from "@/lib/catalogue-slice";
import { upsertBundle, validateBundle } from "@/lib/bundles";
import { setSetting, upsertOverride } from "@/lib/orders";
import { resetRateLimits } from "@/lib/auth";
import { fittingSets, resetShopSetsCache, setsForPrompt, type ShopSet } from "@/app/api/assistant/shop-sets";
import { setupDb, teardownDb } from "./helpers";

const set = (id: string, cat: string, RU: string, items: string[], price: number, ET = RU, EN = RU): ShopSet =>
  ({ id, cat, title: { RU, ET, EN }, items, price, save: 3 });

const SETS: ShopSet[] = [
  set("beard-start", "beard", "Борода — стартовый набор", ["oil-wood", "lotion-green", "balm-sid"], 49.82, "Habe — stardikomplekt", "Beard starter kit"),
  set("barberism", "beard", "Captain Fawcett Barberism — борода и усы", ["barb-oil", "barb-balm"], 52.64),
  set("gift-rempire", "body", "Подарочный набор Rempire", ["oil-azur", "lotion-green", "balm-nebula"], 49.82, "Rempire kinkekomplekt", "Rempire gift set"),
  set("hydrate", "hair", "Сухие волосы зимой — Kevin.Murphy Hydrate-Me", ["hyd-wash", "hyd-rinse"], 83.66),
  set("tattoo-care", "body", "Уход за татуировкой", ["yu-foam", "yu-balm", "yu-cream"], 30),
  set("scalp-oily", "hair", "Жирная кожа головы и перхоть — System 4", ["s4-sh1", "s4-tonic"], 39.48),
];
const CAT: Record<string, string> = {
  "oil-wood": "beard", "lotion-green": "beard", "balm-sid": "beard", "barb-oil": "beard", "barb-balm": "beard",
  "oil-azur": "beard", "balm-nebula": "beard", "hyd-wash": "hair", "hyd-rinse": "hair",
  "yu-foam": "body", "yu-balm": "body", "yu-cream": "body", "s4-sh1": "hair", "s4-tonic": "hair",
  naxos: "perfume", aventus: "perfume",
};
const catOf = (id: string) => CAT[id];

describe("which sets an answer carries (fittingSets)", () => {
  it("«есть набор для бороды?» — the two sets named for beards first, never the tattoo one", () => {
    const out = fittingSets(SETS, { question: "Есть набор для бороды?", productIds: [], catOf });
    expect(out.slice(0, 2).sort()).toEqual(["barberism", "beard-start"]);
    expect(out).not.toContain("tattoo-care");
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("products offered — the set that holds them", () => {
    expect(fittingSets(SETS, { question: "Сухие волосы зимой, что взять?", productIds: ["hyd-wash", "hyd-rinse"], catOf }))
      .toEqual(["hydrate"]);
    // three System 4 products, two of them in the oily-scalp set
    expect(fittingSets(SETS, { question: "Средство от перхоти", productIds: ["s4-sh1", "s4-tonic", "s4-other"], catOf }))
      .toEqual(["scalp-oily"]);
  });

  it("no set fits — none is forced (there is no perfume set)", () => {
    expect(fittingSets(SETS, { question: "Посоветуй парфюм", productIds: ["naxos", "aventus"], catOf })).toEqual([]);
  });

  it("no set holds the products — one from their own section", () => {
    expect(fittingSets(SETS, { question: "Чем помыть бороду?", productIds: ["beard-wash-x", "beard-wash-y"], catOf: (id) => CAT[id] ?? "beard" }))
      .toHaveLength(1);
  });

  it("a gift for a husband with a beard — a gift set and the set holding the oil", () => {
    const out = fittingSets(SETS, { question: "Что подарить мужу, у него борода?", productIds: ["barb-oil"], catOf });
    expect(out).toHaveLength(2);
    expect(out).toContain("gift-rempire");
    expect(out).toContain("barberism");
  });

  it("a gift for a woman is never a beard set, and the budget holds", () => {
    const out = fittingSets(SETS, { question: "Подарок девушке до 50 €", productIds: [], catOf });
    expect(out).not.toContain("beard-start");
    expect(out).not.toContain("barberism");
    expect(out).not.toContain("gift-rempire"); // its parts are beard care
    expect(out).not.toContain("hydrate");      // 83,66 € is over the 50 € asked
    expect(fittingSets(SETS, { question: "набор для бороды до 50 €", productIds: [], catOf })).not.toContain("barberism");
  });

  it("the Estonian «kinkekomplekt» is the gift set", () => {
    expect(fittingSets(SETS, { question: "kas teil on kinkekomplekt?", productIds: [], catOf })[0]).toBe("gift-rempire");
  });

  it("keeps the model's own pick first and drops an id the shop does not have", () => {
    const out = fittingSets(SETS, { question: "масло для бороды", productIds: ["barb-oil"], catOf, modelIds: ["made-up", "beard-start"] });
    expect(out[0]).toBe("beard-start");
    expect(out).not.toContain("made-up");
    expect(fittingSets(SETS, { question: "x", productIds: [], catOf, modelIds: "beard-start" })).toEqual([]);
  });
});

describe("which sets the model is shown (setsForPrompt)", () => {
  it("«уход после татуировки» — the tattoo set, by its Russian name", () => {
    expect(setsForPrompt(SETS, { question: "Нужен уход после татуировки", productIds: [], catOf }).map((s) => s.id))
      .toContain("tattoo-care");
  });
  it("a bare «наборы?» — the shelf from the top", () => {
    expect(setsForPrompt(SETS, { question: "а наборы есть?", productIds: [], catOf }, 4)).toHaveLength(4);
  });
  it("a question no set has to do with — no block at all", () => {
    expect(setsForPrompt(SETS, { question: "Посоветуй парфюм", productIds: ["naxos"], catOf })).toEqual([]);
  });
});

describe("the chat's catalogue slice finds a topic asked in Russian (TOPIC_KW)", () => {
  it("«уход после татуировки» reaches the Yumain products, whose names say «Tattoo»", () => {
    const ids = relevantProducts("Нужен уход после татуировки").slice(0, 12).map((p) => p.id);
    expect(ids).toContain("yumain-tattoo-balm-the-ultimate-care-for-your-tattoos");
    expect(ids).toContain("yumain-aftercare-washing-foam-expert-care-for-your-tattoos");
    expect(ids).toContain("yumain-tattoo-cream");
  });
  it("…and «kiharad» or «кудрявые волосы» the curl line", () => {
    const ids = relevantProducts("шампунь для кудрявых волос").slice(0, 12).map((p) => p.id);
    expect(ids.some((id) => /curl/i.test(id))).toBe(true);
  });
});

/* ---- the route, end to end, on the test database ----------------------- */

const ORIGIN = "https://rempireshop.com";
let ipN = 0;
function ask(question: string, lang = "RU") {
  ipN += 1;
  return new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "rempireshop.com", origin: ORIGIN, "x-real-ip": `203.0.113.${ipN}` },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], lang }),
  });
}
function stubOpenAI(reply: Record<string, unknown>) {
  const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({ model: "gpt-6-luna", choices: [{ message: { content: JSON.stringify(reply) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }));
  return sent;
}

const BEARD = ["proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml", "proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml", "captain-fawcett-sid-sottung-barberism-beard-balm"];
const TATTOO = ["yumain-aftercare-washing-foam-expert-care-for-your-tattoos", "yumain-tattoo-balm-the-ultimate-care-for-your-tattoos", "yumain-tattoo-cream"];

describe("the shop chat with the shop's sets", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    await setupDb();
    for (const [id, cat, RU, items, price] of [
      ["t-beard", "beard", "Борода — стартовый набор", BEARD, 45],
      ["t-tattoo", "body", "Уход за татуировкой", TATTOO, 25],
    ] as const) {
      const v = validateBundle({
        id, cat, title: { RU, ET: RU, EN: RU }, desc: { RU: "", ET: "", EN: "" },
        items: items.map((productId) => ({ productId, variant: 0, qty: 1 })), price, active: true, sort: 1,
      });
      if (!v.ok) throw new Error("fixture " + id + ": " + v.error);
      await upsertBundle(v.value);
    }
  });
  afterAll(async () => {
    await teardownDb();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  beforeEach(() => resetShopSetsCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimits();
  });

  it("«есть набор для бороды?» — the prompt lists the real set, and the answer carries it even when the model forgot", async () => {
    const sent = stubOpenAI({ reply: "Да, есть стартовый набор для бороды.", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("Есть набор для бороды?"))).json();
    const prompt = sent[0].messages[0].content;
    expect(prompt).toContain("SETS — the shop's own ready-made sets");
    expect(prompt).toMatch(/^t-beard\|Борода — стартовый набор\|beard\|45€\|/m);
    expect(prompt).toContain("never put loose products together and call that a «набор»");
    expect(prompt).toContain('"bundle_ids"');
    // the test database also carries the eight sets of public/shop/bundles.js
    expect(body.bundle_ids).toContain("t-beard");
    expect(body.bundle_ids.length).toBeLessThanOrEqual(3);
    expect(body.bundle_ids).not.toContain("t-tattoo");
  });

  it("an answer that offers a product carries the set holding it; an invented set id never leaves", async () => {
    stubOpenAI({ reply: "Возьмите масло Proraso.", product_ids: [BEARD[0]], bundle_ids: ["made-up-set"] });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("посоветуйте масло для бороды"))).json();
    expect(body.product_ids).toEqual([BEARD[0]]);
    expect(body.bundle_ids).toEqual(["t-beard"]);
  });

  it("tattoo aftercare — the Yumain products and their set reach the model", async () => {
    const sent = stubOpenAI({ reply: "Для ухода после татуировки — пенка и бальзам Yumain.", product_ids: [TATTOO[0], TATTOO[1]] });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("Нужен уход после татуировки"))).json();
    const prompt = sent[0].messages[0].content;
    for (const id of TATTOO) expect(prompt).toMatch(new RegExp("^" + id + "\\|", "m"));
    expect(prompt).toMatch(/^t-tattoo\|Уход за татуировкой\|/m);
    expect(body.bundle_ids).toEqual(["t-tattoo"]);
  });

  it("is told the shop is for women and men alike", async () => {
    const sent = stubOpenAI({ reply: "Посмотрите уход за кожей.", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    await POST(ask("Подарок девушке до 50 €"));
    const prompt = sent[0].messages[0].content;
    expect(prompt).not.toMatch(/men's grooming e-shop/i);
    expect(prompt).toContain("for women and men alike");
    expect(prompt).toContain("Never say or imply the shop is only for men");
  });

  it("a set with a sold-out part is not offered", async () => {
    await upsertOverride(TATTOO[2], { stock: "out" });
    try {
      const sent = stubOpenAI({ reply: "Вот пенка Yumain.", product_ids: [TATTOO[0]], bundle_ids: ["t-tattoo"] });
      const { POST } = await import("@/app/api/assistant/route");
      const body = await (await POST(ask("Нужен уход после татуировки"))).json();
      expect(sent[0].messages[0].content).not.toMatch(/^t-tattoo\|/m);
      expect(body.bundle_ids ?? []).not.toContain("t-tattoo");
    } finally {
      await upsertOverride(TATTOO[2], { stock: "in" });
    }
  });

  it("«Наборы» switched off — no set in the prompt and none in the answer", async () => {
    await setSetting("bundles", false);
    try {
      const sent = stubOpenAI({ reply: "Можно взять масло и бальзам.", product_ids: [BEARD[0]], bundle_ids: ["t-beard"] });
      const { POST } = await import("@/app/api/assistant/route");
      const body = await (await POST(ask("Есть набор для бороды?"))).json();
      const prompt = sent[0].messages[0].content;
      expect(prompt).not.toContain("SETS — the shop's own");
      expect(prompt).toContain("do not call them a «набор»");
      expect(body.bundle_ids).toBeUndefined();
    } finally {
      await setSetting("bundles", true);
    }
  });
});
