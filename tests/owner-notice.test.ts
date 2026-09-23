/**
 * The shop's own «оплачен заказ» letter — why it did not come, and how the
 * owner can see that without reading a server log.
 *
 * Renat, 23.09.2026 (/test, mail-owner-ping): «Phone notification arrived —
 * e-mail to shop@rempireshop.com not.» Two causes, and both are real:
 *
 *   1. Since 21.09.2026 (be60c4c) the letter is the FALLBACK: it goes only when
 *      the push reached no device, so a working phone means no letter by
 *      design. The checklist still promised one. The log now says so, once per
 *      order, instead of saying nothing.
 *   2. The letter's recipient is `RESEND_TO`, which has no default on purpose
 *      (src/lib/notify.ts) and is documented as not set on Vercel
 *      (docs/accounts.md). Unset, the fallback itself is dead — and until now
 *      the only trace was a warning in the log of a request nobody watches.
 *
 * So «Подключения» asks GET /api/admin/notify/ and draws a red line when the
 * address is missing, and «Проверить» (POST) sends one real letter through the
 * same code the order uses — which is also the only way a Resend refusal (an
 * unverified domain, a wrong key) reaches the owner as words.
 *
 * Real Postgres (PGlite) for the counter and the cron; Resend stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* The push is the other half of pingOwner(). Mocked, so a test can say
   «the phone took it» without VAPID keys and a subscription table. */
const push = vi.hoisted(() => ({ ok: false }));
vi.mock("@/lib/push", () => ({
  sendPush: async () => ({ ok: push.ok, configured: true, devices: push.ok ? 1 : 0, sent: push.ok ? 1 : 0, failed: 0, gone: 0 }),
}));

const BASE = "https://test.rempireshop.com";
const ENV = ["RESEND_API_KEY", "RESEND_TO", "RESEND_FROM", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "CRON_SECRET", "PUBLIC_BASE_URL"] as const;
let saved: Record<string, string | undefined> = {};
let admin = "";

interface Call {
  to: string[];
  subject: string;
  text?: string;
}
const resend: Call[] = [];
/** What Resend answers next: 200 by default, or a refusal. */
let answer: { status: number; body: Record<string, unknown> } = { status: 200, body: { id: "re_1" } };

function stubResend(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit) => {
      if (String(url).includes("api.resend.com")) {
        resend.push(JSON.parse(String(init.body)) as Call);
        return new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function req(path: string, init: RequestInit = {}, cookie = admin): Request {
  return new Request(`${BASE}${path}`, { ...init, headers: { cookie, "content-type": "application/json" } });
}

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await teardownDb();
});

beforeEach(async () => {
  for (const k of ENV) delete process.env[k];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.PUBLIC_BASE_URL = BASE;
  await truncateAll();
  resetRateLimits();
  resend.length = 0;
  answer = { status: 200, body: { id: "re_1" } };
  push.ok = false;
  stubResend();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/admin/notify/ — what «Подключения» draws the row from", () => {
  it("is for the owner only", async () => {
    const { GET } = await import("@/app/api/admin/notify/route");
    const res = await GET(req("/api/admin/notify/", {}, ""));
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
  });

  it("says the address is missing when RESEND_TO is not set", async () => {
    const { GET } = await import("@/app/api/admin/notify/route");
    const body = await (await GET(req("/api/admin/notify/"))).json();
    expect(body).toEqual({ ok: true, email: { key: true, to: "" } });
  });

  it("names the address when it is set, and never the key", async () => {
    process.env.RESEND_TO = " shop@rempireshop.com ";
    const { GET } = await import("@/app/api/admin/notify/route");
    const res = await GET(req("/api/admin/notify/"));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, email: { key: true, to: "shop@rempireshop.com" } });
    expect(text).not.toContain("re_test_key");
  });

  it("says the key is missing too — the letter needs both", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.RESEND_TO = "shop@rempireshop.com";
    const { GET } = await import("@/app/api/admin/notify/route");
    const body = await (await GET(req("/api/admin/notify/"))).json();
    expect(body.email).toEqual({ key: false, to: "shop@rempireshop.com" });
  });
});

describe("POST /api/admin/notify/ — «Проверить»", () => {
  it("refuses in words when RESEND_TO is missing, and sends nothing", async () => {
    const { POST } = await import("@/app/api/admin/notify/route");
    const res = await POST(req("/api/admin/notify/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
    expect(resend).toHaveLength(0);
  });

  it("sends one letter to the shop's address when it is set", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    const { POST } = await import("@/app/api/admin/notify/route");
    const res = await POST(req("/api/admin/notify/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, to: "shop@rempireshop.com" });
    expect(resend).toHaveLength(1);
    expect(resend[0].to).toEqual(["shop@rempireshop.com"]);
    expect(resend[0].subject).toContain("проверка");
  });

  it("hands back Resend's own reason when Resend refuses, and logs it", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    answer = { status: 403, body: { name: "validation_error", message: "The rempireshop.com domain is not verified." } };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/admin/notify/route");
    const res = await POST(req("/api/admin/notify/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "send_failed", status: 403 });
    expect(String(body.detail)).toContain("not verified");
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("403");
    expect(logged).toContain("not verified");
    expect(logged).not.toContain("re_test_key");
  });

  it("is for the owner only", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    const { POST } = await import("@/app/api/admin/notify/route");
    const res = await POST(req("/api/admin/notify/", { method: "POST", body: "{}" }, ""));
    expect(res.status).toBe(401);
    expect(resend).toHaveLength(0);
  });
});

const ORDER = {
  id: "aaaaaaaa-0000-4000-8000-000000000009",
  number: "R-100099",
  lang: "RU",
  email: null,
  name: "Renat",
  items: [{ id: "p1", title: "Fresh.Hair", brand: "Kevin.Murphy", qty: 1, price: 27, sum: 27 }],
  total: 27,
};

describe("a paid order: the log says why the shop's letter did or did not go", () => {
  it("the phone took the push — no letter, and one line saying that is the design", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    push.ok = true;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { onOrderPaid } = await import("@/lib/mail-hooks");
    const res = await onOrderPaid(ORDER);
    expect(res.notified).toBe(true);
    expect(resend, "the owner's letter went although the phone had the push").toHaveLength(0);
    const said = info.mock.calls.flat().join(" ");
    expect(said).toContain("RESEND_TO");
    expect(said).toContain("R-100099");
  });

  it("no phone answered and Resend refused — the refusal is in the log, word for word", async () => {
    process.env.RESEND_TO = "shop@rempireshop.com";
    answer = { status: 403, body: { message: "The rempireshop.com domain is not verified." } };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onOrderPaid } = await import("@/lib/mail-hooks");
    const res = await onOrderPaid(ORDER);
    expect(res.notified).toBe(false);
    expect(resend).toHaveLength(1);
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("403");
    expect(logged).toContain("not verified");
  });

  it("no phone answered and RESEND_TO is missing — the log names the variable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onOrderPaid } = await import("@/lib/mail-hooks");
    const res = await onOrderPaid(ORDER);
    expect(res.notified).toBe(false);
    expect(resend).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toContain("RESEND_TO");
  });
});

describe("the morning job says what it did", () => {
  it("one line per run, with every automatic letter's count", async () => {
    process.env.CRON_SECRET = "cron-secret-for-the-test";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/flows/route");
    const res = await GET(
      new Request(`${BASE}/api/cron/flows/`, { headers: { authorization: "Bearer cron-secret-for-the-test" } }),
    );
    expect(res.status).toBe(200);
    const line = info.mock.calls.map((c) => c.join(" ")).find((l) => l.includes("[api/cron/flows]")) ?? "";
    expect(line, "the cron wrote no summary line").not.toBe("");
    for (const flow of ["abandoned", "abandonedDiscount", "backstock", "birthday", "unpaid"]) {
      expect(line).toContain(`${flow}:`);
    }
    // a switched-off letter says so rather than a bare zero
    expect(line).toContain("disabled");
  });
});
