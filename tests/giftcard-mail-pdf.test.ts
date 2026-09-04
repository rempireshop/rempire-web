/**
 * The gift-card letter carries the printable card.
 *
 * A code in the body is enough to spend the card; it is not enough to *give*
 * one. So the letter minted on the paid transition (src/lib/mail-hooks.ts
 * issueOrderGiftCards → sendGiftCards) attaches the A5 PDF, and the e2e mail
 * sink records that it did.
 *
 * Real Postgres (PGlite), a real order, a real card; `fetch` is stubbed so the
 * Resend payload can be read back. R2 is left unconfigured, which is what makes
 * storeGiftCardPdf() a no-op — the card is rendered on the spot instead.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, query } from "@/lib/db";
import { issueOrderGiftCards } from "@/lib/mail-hooks";
import { capturedMail } from "@/lib/mail";
import { createOrder, type Order } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

interface Sent {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const ENV_KEYS = ["RESEND_API_KEY", "MAIL_RETRY_DELAY_MS", "E2E_BOOTSTRAP", "SESSION_SECRET"] as const;
let saved: Record<string, string | undefined> = {};

function stubFetch() {
  const calls: Sent[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("api.resend.com")) throw new Error(`unexpected fetch: ${u}`);
    calls.push({
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ id: "msg_1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

async function paidGiftOrder(over: Record<string, unknown> = {}): Promise<Order> {
  const order = await createOrder({
    lang: "ru",
    items: [
      { id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com", message: "С днём рождения!" } },
    ],
    customer: { name: "Renat", email: "buyer@example.com", phone: "+372 5555 5555" },
    shipping: { method: "digital", country: "EE" },
    ...over,
  } as Parameters<typeof createOrder>[0]);
  return { ...order, status: "paid" };
}

describe("gift-card letter — the PDF rides along", () => {
  beforeAll(async () => {
    await setupDb();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_RETRY_DELAY_MS = "0";
    process.env.SESSION_SECRET = TEST_SECRET;
    // the e2e sink is double-gated: NODE_ENV must not be production (vitest
    // runs as "test") and E2E_BOOTSTRAP must be "1"
    process.env.E2E_BOOTSTRAP = "1";
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    await exec("truncate gift_card_uses, gift_cards restart identity cascade");
    (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("attaches one A5 PDF per issued code, named after the code", async () => {
    const calls = stubFetch();
    const order = await paidGiftOrder();
    const res = await issueOrderGiftCards(order);
    expect(res.ok).toBe(true);

    expect(calls).toHaveLength(1);
    const attachments = calls[0].body.attachments as Array<Record<string, string>>;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toMatch(/^rempire-gift-card-RMP-[A-Z0-9]{4}-[A-Z0-9]{4}\.pdf$/);
    expect(attachments[0].content_type).toBe("application/pdf");

    // …and the base64 really is a PDF, not a hopeful string
    const bytes = Buffer.from(attachments[0].content, "base64");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it("records the attachment's name in the e2e mail sink", async () => {
    stubFetch();
    await issueOrderGiftCards(await paidGiftOrder());
    const gift = capturedMail().filter((m) => m.template === "gift-card");
    expect(gift).toHaveLength(1);
    expect(gift[0].to).toEqual(["mari@example.com"]);
    expect(gift[0].attachments).toHaveLength(1);
    expect(gift[0].attachments[0]).toMatch(/^rempire-gift-card-RMP-/);
  });

  it("sends one letter with one card each when the order buys two", async () => {
    const calls = stubFetch();
    await issueOrderGiftCards(
      await paidGiftOrder({ items: [{ id: "gift:25", qty: 2, meta: { email: "mari@example.com" } }] }),
    );
    expect(calls).toHaveLength(2);
    const names = calls.map((c) => (c.body.attachments as Array<Record<string, string>>)[0].filename);
    expect(new Set(names).size).toBe(2); // a different card in each letter
  });

  it("still sends the letter when the card cannot be drawn", async () => {
    /* The code is in the body; a PDF that fails to render costs the customer
       the attachment, never the letter. The fonts are the one thing the
       renderer cannot do without, so this simulates losing them. */
    const pdf = await import("@/lib/giftcard-pdf");
    vi.spyOn(pdf, "buildGiftCardPdf").mockRejectedValue(new Error("asset_missing: fonts"));
    const calls = stubFetch();
    const res = await issueOrderGiftCards(await paidGiftOrder());
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.attachments).toBeUndefined();
    expect(String(calls[0].body.html)).toContain("RMP-");
  });

  it("carries no attachments on a letter that has none", async () => {
    const calls = stubFetch();
    const { onOrderShipped } = await import("@/lib/mail-hooks");
    await onOrderShipped({ ...(await paidGiftOrder()), status: "shipped" }, { code: "EE123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.attachments).toBeUndefined();
    const shipped = capturedMail().filter((m) => m.template === "order-shipped");
    expect(shipped[0].attachments).toEqual([]);
  });

  /* ---------- GET /api/giftcards/<code>/pdf/ ---------------------------- */

  describe("the download route", () => {
    async function issuedCode(): Promise<string> {
      stubFetch();
      await issueOrderGiftCards(await paidGiftOrder());
      const rows = await query<{ code: string }>("select code from gift_cards limit 1");
      expect(rows).toHaveLength(1);
      return rows[0].code;
    }

    it("serves the card as application/pdf to a valid token", async () => {
      const code = await issuedCode();
      const { GET } = await import("@/app/api/giftcards/[code]/pdf/route");
      const { giftPdfToken } = await import("@/lib/giftcard-pdf");
      const res = await GET(
        new Request(`https://shop.test/api/giftcards/${code}/pdf/?t=${giftPdfToken(code)}`),
        { params: Promise.resolve({ code }) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toContain(`${code}.pdf`);
      // never a shared cache: the URL is a bearer link
      expect(res.headers.get("cache-control")).toContain("private");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("404s on a bad token, a token for another card, and no token at all", async () => {
      const code = await issuedCode();
      const { GET } = await import("@/app/api/giftcards/[code]/pdf/route");
      const { giftPdfToken } = await import("@/lib/giftcard-pdf");
      const other = giftPdfToken("RMP-ACDE-4679");
      for (const t of ["", "junk", other, `${giftPdfToken(code)}x`]) {
        const res = await GET(
          new Request(`https://shop.test/api/giftcards/${code}/pdf/?t=${encodeURIComponent(t)}`),
          { params: Promise.resolve({ code }) },
        );
        expect(res.status, `token ${JSON.stringify(t)}`).toBe(404);
        expect(res.headers.get("content-type")).toContain("application/json");
      }
    });

    it("404s for a code that was never issued, even with its own valid token", async () => {
      const { GET } = await import("@/app/api/giftcards/[code]/pdf/route");
      const { giftPdfToken } = await import("@/lib/giftcard-pdf");
      const ghost = "RMP-ACDE-4679";
      const res = await GET(
        new Request(`https://shop.test/api/giftcards/${ghost}/pdf/?t=${giftPdfToken(ghost)}`),
        { params: Promise.resolve({ code: ghost }) },
      );
      expect(res.status).toBe(404);
    });
  });
});
