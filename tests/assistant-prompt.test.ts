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
    expect(body.v).toBe(18);

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
});
