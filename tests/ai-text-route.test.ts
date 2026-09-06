/**
 * POST /api/admin/ai/text — auth, rate limit, OpenAI request shape, per-task
 * response shaping, the "reply" signature append, and the admin_audit log.
 * OpenAI itself is a stubbed fetch, same idiom as
 * tests/assistant-admin-auth.test.ts — no real network call.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { listAudit } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

function req(body: unknown, opts: { cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: HOST };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`${ORIGIN}/api/admin/ai/text/`, { method: "POST", headers, body: JSON.stringify(body) });
}

function fakeCompletion(content: unknown, usage = { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }) {
  return new Response(
    JSON.stringify({
      model: "gpt-4.1-mini",
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("POST /api/admin/ai/text", () => {
  let admin = "";
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
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
    process.env.OPENAI_API_KEY = "sk-test-dummy";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401s with no admin cookie", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI before the admin check"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "describe", lang: "RU", input: { name: "x" } }));
    expect(res.status).toBe(401);
  });

  it("503s when OPENAI_API_KEY is not configured — even for an admin", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI with no key"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "describe", lang: "RU", input: { name: "x" } }, { cookie: admin }));
    expect(res.status).toBe(503);
  });

  it("400s an unknown task", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI for a bad task"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "frobnicate", lang: "RU", input: {} }, { cookie: admin }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_task");
  });

  it("400s bad input for a valid task (describe with no product name)", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI for bad input"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "describe", lang: "RU", input: {} }, { cookie: admin }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_name");
  });

  it("400s bad json", async () => {
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const bad = new NextRequest(`${ORIGIN}/api/admin/ai/text/`, {
      method: "POST",
      headers: { "content-type": "application/json", host: HOST, cookie: admin },
      body: "{not json",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });

  it("calls OpenAI with the fixed model/temperature/max_tokens and json_object format", async () => {
    const fetchMock = vi.fn(async () => fakeCompletion({ description: "d", bullets: ["a", "b", "c"] }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    await POST(req({ task: "describe", lang: "RU", input: { name: "Touchable" } }, { cookie: admin }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.max_tokens).toBe(900);
    expect(payload.temperature).toBe(0.4);
    expect(payload.response_format).toEqual({ type: "json_object" });
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[0].content).toMatch(/never invent/i);
  });

  it("describe: shapes the model's JSON into {text:{description,bullets}}, capped to 3 bullets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({
      description: "Лёгкая паста для укладки.",
      bullets: ["матовый финиш", "лёгкая фиксация", "смывается шампунем", "пятая деталь"],
    })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "describe", lang: "RU", input: { name: "Touchable" } }, { cookie: admin }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.text.description).toBe("Лёгкая паста для укладки.");
    expect(body.text.bullets).toEqual(["матовый финиш", "лёгкая фиксация", "смывается шампунем"]);
  });

  it("seo: shapes {text:{title,description}}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ title: "Touchable — Rempire", description: "Купите Touchable в Таллинне." })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "seo", lang: "RU", input: { name: "Touchable" } }, { cookie: admin }));
    const body = await res.json();
    expect(body.text).toEqual({ title: "Touchable — Rempire", description: "Купите Touchable в Таллинне." });
  });

  it("seo for a post: sends the article's own text, asks for the language wanted, shapes the same {text:{title,description}}", async () => {
    const fetchMock = vi.fn(async () => fakeCompletion({ title: "Habeme talvine hooldus", description: "Kolm harjumust külmaks hooajaks." }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({
      task: "seo", lang: "ET",
      input: { kind: "post", title: "Уход за бородой зимой", excerpt: "Три привычки.", body: "Зимой борода сохнет.", tags: ["борода"], products: ["Proraso Beard Balm"] },
    }, { cookie: admin }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.text).toEqual({ title: "Habeme talvine hooldus", description: "Kolm harjumust külmaks hooajaks." });

    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.messages[0].content).toMatch(/blog article, in Estonian/);
    expect(payload.messages[1].content).toContain("Article title: Уход за бородой зимой");
    expect(payload.messages[1].content).toContain("Excerpt: Три привычки.");
    expect(payload.messages[1].content).toContain("Proraso Beard Balm");
    expect(payload.messages[1].content).toContain("Зимой борода сохнет.");
  });

  it("seo for a post with no title is a 400 missing_title — OpenAI is never asked", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI for bad input"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "seo", lang: "RU", input: { kind: "post", body: "текст" } }, { cookie: admin }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_title");
  });

  it("seo: caps what the model wrote at what the editors store — 70 for the title, 170 for the description", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ title: "T".repeat(100), description: "D".repeat(300) })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "seo", lang: "RU", input: { kind: "post", title: "Заголовок" } }, { cookie: admin }));
    const body = await res.json();
    expect(body.text.title).toHaveLength(70);
    expect(body.text.description).toHaveLength(170);
  });

  it("translate: shapes {texts:{...}}, one key per requested target language", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ ET: "Eesti tekst", EN: "English text" })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(
      req({ task: "translate", lang: "RU", input: { text: "Русский текст", targetLangs: ["ET", "EN"] } }, { cookie: admin }),
    );
    const body = await res.json();
    expect(body.texts).toEqual({ ET: "Eesti tekst", EN: "English text" });
    expect(body.text).toBeUndefined();
  });

  it("blog_outline: shapes {text:{title,h2,meta}}, capped to 8 headings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({
      title: "Уход за бородой зимой",
      h2: ["Раз", "Два", "Три", "Четыре", "Пять", "Шесть"],
      metaTitle: "Уход за бородой зимой | Rempire",
      metaDescription: "Как ухаживать за бородой зимой — простые советы.",
    })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "blog_outline", lang: "RU", input: { topic: "борода зимой" } }, { cookie: admin }));
    const body = await res.json();
    expect(body.text.title).toBe("Уход за бородой зимой");
    expect(body.text.h2).toHaveLength(6);
    expect(body.text.meta.title).toBe("Уход за бородой зимой | Rempire");
  });

  it("reply: the response text starts with the model's reply and always ends with the shop signature, never the model's own", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ reply: "Ваш заказ уже собран и скоро отправится." })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(
      req(
        { task: "reply", lang: "RU", input: { customerMessage: "Когда придёт?", order: { number: "R-100042" } } },
        { cookie: admin },
      ),
    );
    const body = await res.json();
    expect(typeof body.text).toBe("string");
    expect(body.text.startsWith("Ваш заказ уже собран и скоро отправится.")).toBe(true);
    // signature comes from settings.content (mergeContent's defaults with no
    // row saved yet) — never invented by the model
    expect(body.text).toContain("info@rempireshop.com");
    expect(body.text).toContain("Rempire");
  });

  it("logs token usage to admin_audit as ai.text with the task", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ title: "t", description: "d" })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    await POST(req({ task: "seo", lang: "RU", input: { name: "Touchable" } }, { cookie: admin }));

    const audit = await listAudit(10);
    const row = audit.find((a) => a.action === "ai.text");
    expect(row).toBeDefined();
    const payload = row!.payload as Record<string, unknown>;
    expect(payload.task).toBe("seo");
    expect(payload.totalTokens).toBe(200);
  });

  it("502s when OpenAI itself errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 500 })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "describe", lang: "RU", input: { name: "x" } }, { cookie: admin }));
    expect(res.status).toBe(502);
  });

  /* A 200 whose body is not JSON — a proxy's HTML error page, a truncated
     stream. `await r.json()` had no catch, so the SyntaxError escaped the
     handler and Next answered with an opaque 500 the panel could only call
     «не получилось». It is the same thing as the case above: an upstream
     that did not answer properly. */
  it("502s when OpenAI answers 200 with a body that is not JSON", async () => {
    const { POST } = await import("@/app/api/admin/ai/text/route");
    for (const body of ["<html>502 Bad Gateway</html>", "", '{"choices":['] ) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })));
      const res = await POST(req({ task: "describe", lang: "RU", input: { name: "x" } }, { cookie: admin }));
      expect(res.status, `body ${JSON.stringify(body)}`).toBe(502);
      expect((await res.json()).error).toBe("upstream");
    }
  });

  it("502s when OpenAI answers 200 with valid JSON that is not an object", async () => {
    const { POST } = await import("@/app/api/admin/ai/text/route");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200, headers: { "content-type": "application/json" } })));
    const res = await POST(req({ task: "describe", lang: "RU", input: { name: "x" } }, { cookie: admin }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream");
  });

  it("rate-limits at 30 calls/hour per admin session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ description: "d", bullets: [] })));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    let last;
    for (let i = 0; i < 31; i++) {
      last = await POST(req({ task: "describe", lang: "RU", input: { name: "x" + i } }, { cookie: admin }));
    }
    expect(last!.status).toBe(429);
  });
});
