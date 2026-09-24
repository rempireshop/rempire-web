/**
 * POST /api/admin/mail/test/ with `texts` — the letter as the editor has it.
 *
 * «Отправить мне тест» in a letter's editor mailed the SAVED text while the
 * fields above it showed the draft (map of the panel, 23.09.2026, #14). The
 * editor now sends the open letter's three strings in its language, and the
 * route lays them over the saved ones for that one render — cleaned as a
 * save would clean them, and gone again before the next letter is rendered.
 *
 * Real Postgres (PGlite), Resend stubbed — the same harness as
 * tests/mail-flow-samples.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { ADMIN_COOKIE, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { mailTextsOverride } from "@/emails/texts";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const BASE = "https://test.rempireshop.com";
let admin = "";

interface Sent { to: string[]; subject: string; html: string; text: string }
const sent: Sent[] = [];

function stubResend(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit) => {
      if (String(url).includes("api.resend.com")) {
        sent.push(JSON.parse(String(init.body)) as Sent);
        return new Response(JSON.stringify({ id: `re_${sent.length}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unstubbed" }), { status: 502 });
    }),
  );
}

async function test(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import("@/app/api/admin/mail/test/route");
  return POST(
    new Request(`${BASE}/api/admin/mail/test/`, {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ template: "order-confirmed", to: "dim@example.com", lang: "RU", ...body }),
    }),
  );
}

let savedKey: string | undefined;

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = BASE;
  savedKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key";
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
  vi.unstubAllGlobals();
  await teardownDb();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimits();
  sent.length = 0;
  stubResend();
  // what the owner saved: his own subject for «Заказ принят» in Russian
  await query(
    `insert into settings (key, value) values ('mail_texts', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify({ "order-confirmed": { ru: { subject: "Сохранённая тема {order}" } } })],
  );
});

describe("the editor's test letter is the letter on the screen", () => {
  it("without `texts` it is the saved letter, as «Прислать пример» expects", async () => {
    const res = await test({});
    expect(res.status).toBe(200);
    expect(sent[0].subject).toMatch(/^\[test\] Сохранённая тема /);
  });

  it("with `texts` it is the draft — and the saved texts are back for the next letter", async () => {
    const res = await test({ texts: { subject: "Черновик темы {order}", intro: "Абзац из черновика." } });
    expect(res.status).toBe(200);
    expect(sent[0].subject, "the test mailed the saved subject, not the draft").toMatch(/^\[test\] Черновик темы /);
    expect(sent[0].text).toContain("Абзац из черновика.");
    // the draft was for this one render only
    expect(mailTextsOverride()["order-confirmed"]?.ru?.subject).toBe("Сохранённая тема {order}");
    await test({});
    expect(sent[1].subject).toMatch(/^\[test\] Сохранённая тема /);
  });

  it("an empty `texts` is the standard text, as a save of it would be", async () => {
    await test({ texts: {} });
    expect(sent[0].subject).not.toContain("Сохранённая тема");
  });

  it("the draft is cleaned like a save: no control characters, no unknown fields", async () => {
    const res = await test({ texts: { subject: "Тема\u0000 с мусором", evil: "<script>" } });
    expect(res.status).toBe(200);
    expect(sent[0].subject).toContain("Тема с мусором");
    expect(JSON.stringify(sent[0])).not.toContain("<script>");
  });

  it("a draft in one language does not touch the others", async () => {
    await test({ lang: "ET", texts: { subject: "Eesti mustand" } });
    expect(sent[0].subject).toContain("Eesti mustand");
    expect(mailTextsOverride()["order-confirmed"]?.et).toBeUndefined();
  });
});
