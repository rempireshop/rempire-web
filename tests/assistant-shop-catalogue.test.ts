/**
 * What the CUSTOMER's chat is told the shop has (shopPrompt() in
 * src/app/api/assistant/route.ts).
 *
 * That block used to be src/data/catalogue.min.json and nothing else — the
 * file as it was last committed. Two things were therefore untrue in it:
 *
 *   · price and stock. «Never recommend items with stock "out"» is the one
 *     rule the shop prompt states outright, and it was being enforced against
 *     a frozen file while the storefront itself drew that file with the
 *     owner's overrides on top (GET /api/overrides). A shampoo sold out this
 *     morning was still being recommended in the afternoon.
 *   · the owner's own products. They live in custom_products, they are on the
 *     storefront through the very same feed (customForFeed), and the chat
 *     could neither name one nor return it as a card — `known` did not carry
 *     the id, so even a correct answer lost its product.
 *
 * The admin half of the same prompt is tests/assistant-prompt.test.ts; the
 * article generator keeps the same rule about hidden and sold-out products
 * (tests/ai-text-route-articles.test.ts).
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { upsertOverride } from "@/lib/orders";
import { resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";
let ipN = 0;

/* One catalogue product whose price and stock the owner has since changed,
   and one he has hidden. Ids from the file itself, so this test keeps working
   when the catalogue is regenerated. */
const SOLD_OUT = "system-4-bio-botanical-shampoo";
const CHEAPER = "system-4-bio-botanical-serum";
const HIDDEN = "repair-me-wash";

function ask(question: string) {
  ipN += 1;
  return new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, "x-real-ip": `198.51.100.${ipN}` },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
}

/** Records the prompt the route composed and answers with `reply`. */
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

/** One line of the CATALOGUE block, by id. */
function line(prompt: string, id: string): string {
  const found = prompt.split("\n").find((l) => l.startsWith(id + "|"));
  return found ?? "";
}

describe("the shop chat's catalogue is the shop as it is now", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  let ownId = "";

  /* The route caches the live rows for a minute, so everything the shop has
     changed is written once, before the first question is asked. */
  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    await setupDb();
    await exec("truncate custom_products, product_overrides");
    await upsertOverride(SOLD_OUT, { stock: "out" });
    await upsertOverride(CHEAPER, { price: 4.5 });
    await upsertOverride(HIDDEN, { hidden: true });
    const own = await createCustomProduct({
      brand: "Proraso", name: "Beard Balm Cypress — бальзам для бороды", cat: "beard", price: 14.9,
    });
    ownId = own.id;
  });
  afterAll(async () => {
    await teardownDb();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimits();
  });

  it("shows the price and the stock the shop has right now, not the ones in the file", async () => {
    const sent = stubOpenAI({ reply: "Вот что подойдёт.", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    expect((await POST(ask("посоветуйте шампунь для кожи головы"))).status).toBe(200);
    const prompt = sent[0].messages[0].content;

    // the file says «in» for this one — the shop ran out
    expect(line(prompt, SOLD_OUT), "the catalogue file's own stock reached the customer").toMatch(/\|out$/);
    // …and the owner dropped this one's price
    expect(line(prompt, CHEAPER)).toContain("|4.5€|");
    // «Показывать в магазине» off: not a thing to recommend either
    expect(line(prompt, HIDDEN)).toMatch(/\|out$/);
    // the rule it is all for is still stated
    expect(prompt).toContain('Never recommend items with stock "out"');
  });

  it("carries the owner's own products, and lets the chat return one as a card", async () => {
    const sent = stubOpenAI({ reply: "Возьмите этот бальзам.", product_ids: [ownId] });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("посоветуйте бальзам для бороды"))).json();
    const prompt = sent[0].messages[0].content;

    expect(line(prompt, ownId), "the owner's own product is invisible to the shop chat")
      .toBe(`${ownId}|Proraso|Beard Balm Cypress — бальзам для бороды|beard|14.9€|in`);
    // …and the id survives the filter, so the answer keeps its product card
    expect(body.product_ids).toEqual([ownId]);
  });

  it("lets the chat put the owner's own product in the cart", async () => {
    stubOpenAI({ reply: "Положил в корзину.", product_ids: [], action: { type: "add_to_cart", ids: [ownId] } });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("добавь бальзам в корзину"))).json();
    expect(body.action).toEqual({ type: "add_to_cart", ids: [ownId] });
  });
});
