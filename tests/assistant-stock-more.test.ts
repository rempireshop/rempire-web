/**
 * «Что заканчивается?» — the assistant is told how many it was not shown.
 *
 * Verification pass on staging, 25.09.2026 (ai-assistant-ask): the stock
 * block of the admin prompt was lowStockSummary(12) and nothing else, so the
 * answer stopped at twelve lines with no word that there were more —
 * «Bio Botanical Serum 150/500 мл» were simply missing. The cap is ours, so
 * the count past it is ours to say: the block now carries the total and
 * tells the model to end the list with «…и ещё N» and the way to «Склад».
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { createCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { setQty } from "@/lib/inventory";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

function stubOpenAI() {
  const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({ model: "gpt-4.1-mini", choices: [{ message: { content: JSON.stringify({ reply: "ok", product_ids: [], tab: "", action: null }) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }));
  return sent;
}

describe("the admin prompt's stock block", () => {
  let admin = "";
  let nth = 0;
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
    await exec("truncate custom_products, stock_levels, stock_moves");
  });
  afterEach(() => vi.unstubAllGlobals());

  /** `n` of the owner's own products, each counted down to zero on the shelf. */
  async function emptyShelves(n: number) {
    for (let i = 0; i < n; i++) {
      const p = await createCustomProduct({ brand: "Proraso", name: `Wax ${String(i).padStart(2, "0")}`, cat: "styling", price: 9 });
      await setQty(p.id, "", 0);
    }
  }
  async function promptFor(message: string): Promise<string> {
    const sent = stubOpenAI();
    const { POST } = await import("@/app/api/assistant/route");
    nth += 1;
    await POST(new NextRequest(`${ORIGIN}/api/assistant/`, {
      method: "POST",
      headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie: admin, "x-real-ip": `10.9.0.${nth}` },
      body: JSON.stringify({ mode: "admin", messages: [{ role: "user", content: message }] }),
    }));
    return sent[0].messages[0].content;
  }
  const block = (prompt: string) => {
    const at = prompt.indexOf("STOCK — tracked products reading");
    return prompt.slice(at, prompt.indexOf("\n\nORDERS WAITING", at));
  };

  it("fifteen empty shelves: twelve named, and «…и ещё 3 товара» with the way to «Склад»", async () => {
    await emptyShelves(15);
    const stock = block(await promptFor("Что заканчивается и что дозаказать?"));
    expect(stock.match(/ — нет \(0 шт\)/g) || []).toHaveLength(12);
    expect(stock).toContain("15 in all; the first 12");
    expect(stock).toContain("…and 3 more not listed here");   // before: nothing — the list just stopped
    expect(stock).toContain("«…и ещё 3 товара»");
    expect(stock).toContain('"tab":"stock"');
  });

  it("the Russian word follows the number", async () => {
    await emptyShelves(13);
    expect(block(await promptFor("что заканчивается?"))).toContain("«…и ещё 1 товар»");
  });

  it("twelve or fewer: the whole list, nothing about more", async () => {
    await emptyShelves(12);
    const stock = block(await promptFor("что заканчивается?"));
    expect(stock.match(/ — нет \(0 шт\)/g) || []).toHaveLength(12);
    expect(stock).not.toContain("more not listed");
    expect(stock).not.toContain("и ещё");
  });
});
