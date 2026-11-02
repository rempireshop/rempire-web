/**
 * The shop chat with no database at all — the salon guides (src/app/api/
 * assistant/blog-digest.ts) must not be the reason it stops answering.
 *
 * docs/backend.md, "Without the API": the shop chat keeps working when there
 * is no database. Every optional block of its prompt already holds to that
 * (live stock, the owner's own products); the blog's digests are one more
 * read, and this is the database that is not there — the real driver with no
 * address to connect to, so every query throws, exactly as on a deployment
 * whose DATABASE_URL is missing. tests/assistant-shop-guides.test.ts covers the
 * other case: a database that answers and a blog that does not.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetGuideCache } from "@/app/api/assistant/blog-digest";
import { resetRateLimits } from "@/lib/auth";

const g = globalThis as unknown as { __rempireDb?: unknown };

describe("POST /api/assistant with no database", () => {
  const saved = { key: process.env.OPENAI_API_KEY, driver: process.env.DB_DRIVER, url: process.env.DATABASE_URL };

  beforeAll(() => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    process.env.DB_DRIVER = "pg";
    delete process.env.DATABASE_URL;
    g.__rempireDb = undefined;
    resetGuideCache();
  });
  afterAll(() => {
    for (const [k, v] of [["OPENAI_API_KEY", saved.key], ["DB_DRIVER", saved.driver], ["DATABASE_URL", saved.url]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    g.__rempireDb = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimits();
  });

  it("answers the question, with its products, and no blog in the prompt or the answer", async () => {
    const sent: Array<{ messages: Array<{ content: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({
        model: "gpt-6-luna",
        choices: [{ message: { content: JSON.stringify({
          reply: "Возьмите уплотняющую пару.",
          product_ids: ["kevin-muprhy-plumping-wash"],
          article: "kak-vybrat-shampun-kevin-murphy-pod-svoi-volosy",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(new NextRequest("https://rempireshop.com/api/assistant/", {
      method: "POST",
      headers: { "content-type": "application/json", host: "rempireshop.com", origin: "https://rempireshop.com", "x-real-ip": "198.51.100.77" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "тонкие окрашенные волосы без объёма" }],
        lang: "RU",
        article: "kak-vybrat-shampun-kevin-murphy-pod-svoi-volosy",
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("Возьмите уплотняющую пару.");
    expect(body.product_ids).toEqual(["kevin-muprhy-plumping-wash"]);
    // the model named an article, but there is no blog to hold it to: no card
    expect(body.article).toBeUndefined();
    const prompt = sent[0].messages[0].content;
    expect(prompt).toContain("CATALOGUE");
    expect(prompt).not.toContain("SALON GUIDES");
    expect(prompt).not.toContain("BLOG ARTICLES");
  });
});
