/**
 * POST /api/admin/ai/text — the description format's three doors (02.11.2026):
 *   · "sections" («Разбить на разделы») hands back the owner's words laid out,
 *     or refuses (`changed_words`) — the box would save whatever came back;
 *   · "translate" with format "desc" keeps the headings, the «— » points and
 *     the bold, or refuses (`lost_structure`);
 *   · "describe" answers a heading for its points, the points cleaned of a
 *     marker or a full stop the model put on them.
 * OpenAI is a stub; the database is the suite's own (./helpers).
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { DESC_FORMAT_EXAMPLE } from "@/lib/ai-prompts";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
function req(body: unknown, cookie: string) {
  return new NextRequest(`${ORIGIN}/api/admin/ai/text/`, {
    method: "POST", headers: { "content-type": "application/json", host: "rempireshop.com", cookie }, body: JSON.stringify(body),
  });
}
function answer(content: unknown) {
  return new Response(JSON.stringify({ model: "gpt-6-luna", choices: [{ message: { content: JSON.stringify(content) } }], usage: {} }),
    { status: 200, headers: { "content-type": "application/json" } });
}
const SOURCE = "Шампунь для тонких волос, которым не хватает объёма. Мягко очищает и делает волосы плотнее на ощупь. Преимущества: объём без утяжеления, подходит для ежедневного мытья и лёгкий свежий аромат. Применение: нанесите на влажные волосы, вспеньте, смойте.";

describe("the description format at the AI route", () => {
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
  afterEach(() => { vi.unstubAllGlobals(); });

  it("«Разбить на разделы»: the same words under headings and in a list come back", async () => {
    const fetchMock = vi.fn(async () => answer({ text: DESC_FORMAT_EXAMPLE }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "sections", lang: "RU", input: { text: SOURCE } }, admin));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, text: DESC_FORMAT_EXAMPLE });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body));
    expect(sent.messages[0].content).toContain("WITHOUT changing a single fact or word");
    expect(sent.messages[1].content).toContain(SOURCE);
  });

  it("…a rewritten text is refused, and nothing is handed to the box", async () => {
    vi.stubGlobal("fetch", async () => answer({
      text: "Лучший шампунь для густых и блестящих волос с кератином.\n\nПреимущества:\n— объём на весь день\n— салонный уход дома",
    }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "sections", lang: "RU", input: { text: SOURCE } }, admin));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "changed_words" });
    expect(body.text).toBeUndefined();
  });

  it("…bold the owner never had is taken back out, not refused", async () => {
    vi.stubGlobal("fetch", async () => answer({ text: DESC_FORMAT_EXAMPLE.replace("объём без утяжеления", "**объём** без утяжеления") }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "sections", lang: "RU", input: { text: SOURCE } }, admin));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe(DESC_FORMAT_EXAMPLE);
  });

  it("«Перевести» of a description: a translation that kept the layout is taken, one that lost the list is refused", async () => {
    const text = "Шампунь для объёма.\n\nПреимущества:\n— объём без утяжеления\n— **лёгкий** аромат";
    const input = { text, sourceLang: "RU", targetLangs: ["ET", "EN"], format: "desc" };
    const { POST } = await import("@/app/api/admin/ai/text/route");

    vi.stubGlobal("fetch", async () => answer({
      ET: "Kohevust andev šampoon.\n\nEelised:\n— kohevus ilma raskuseta\n— **kerge** lõhn",
      EN: "A volumising shampoo.\n\nBenefits:\n— volume without weight\n— a **light** scent",
    }));
    const ok = await POST(req({ task: "translate", lang: "RU", input }, admin));
    expect(ok.status).toBe(200);
    expect((await ok.json()).texts.ET).toContain("Eelised:\n— kohevus");

    vi.stubGlobal("fetch", async () => answer({
      ET: "Kohevust andev šampoon. Eelised: kohevus ilma raskuseta, kerge lõhn.",
      EN: "A volumising shampoo.\n\nBenefits:\n— volume without weight\n— a **light** scent",
    }));
    const lost = await POST(req({ task: "translate", lang: "RU", input }, admin));
    expect(lost.status).toBe(502);
    expect(await lost.json()).toMatchObject({ ok: false, error: "lost_structure", detail: "ET" });

    // any other text the translator carries is not held to it
    vi.stubGlobal("fetch", async () => answer({ ET: "Üks lõik." }));
    const other = await POST(req({ task: "translate", lang: "RU", input: { text, sourceLang: "RU", targetLangs: ["ET"] } }, admin));
    expect(other.status).toBe(200);
  });

  it("«Написать черновик»: a heading for the points, a dash or a full stop on a point taken off", async () => {
    vi.stubGlobal("fetch", async () => answer({
      description: "Масло для бороды.", heading: "Преимущества:", bullets: ["— смягчает бороду.", "- лёгкий аромат", "блеск"],
    }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "describe", lang: "RU", input: { name: "Beard Oil — масло для бороды" } }, admin));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toEqual({ description: "Масло для бороды.", heading: "Преимущества", bullets: ["смягчает бороду", "лёгкий аромат", "блеск"] });
  });
});
