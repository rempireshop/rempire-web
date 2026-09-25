/**
 * «Рассылка» — the first save of a new letter is ONE draft (1a, 25.09.2026).
 *
 * The panel saves a letter by itself since the redesign: a second after the
 * last keystroke, again after every block moved. A first save whose answer
 * was lost is retried — and a POST that creates something has no memory of
 * having run, so the retry used to make a twin draft. The route now takes an
 * `Idempotency-Key` (src/lib/idempotency.ts, as the blog's POST does), and the
 * panel sends the same key with the same body until the first one lands
 * (saveNewsFields in public/shop2/app.js; its half is in
 * tests/admin-marketing-1a.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import { adminCookieHeader, makeRequest, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb } from "./helpers";

describe("POST /api/admin/newsletters/ with an Idempotency-Key", () => {
  let restoreEnv: () => void = () => {};
  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    await setupDb();
  });
  afterAll(async () => {
    restoreEnv();
    await teardownDb();
  });
  beforeEach(async () => {
    await exec("truncate newsletters cascade");
    await exec("truncate idempotency_keys");
  });
  async function post(body: Record<string, unknown>, key: string) {
    const { POST } = await import("@/app/api/admin/newsletters/route");
    const res = await POST(makeRequest("/api/admin/newsletters/", {
      method: "POST", body, cookie: adminCookieHeader(), headers: key ? { "idempotency-key": key } : {},
    }));
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }

  it("makes one draft for a retried save, and answers the retry with it", async () => {
    const body = { title: "Осень", subject: { RU: "Тема" }, blocks: [] };
    const one = await post(body, "news-save-0001-abcdef");
    const two = await post(body, "news-save-0001-abcdef");
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(two.body.newsletter.id).toBe(one.body.newsletter.id);
    const rows = await query<{ n: number }>("select count(*)::int as n from newsletters");
    expect(rows[0].n, "the retry made a twin draft").toBe(1);
  });

  it("refuses the same key with a different body, and still makes a draft without a key", async () => {
    await post({ title: "A", subject: { RU: "Тема" }, blocks: [] }, "news-save-0002-abcdef");
    const other = await post({ title: "B", subject: { RU: "Тема" }, blocks: [] }, "news-save-0002-abcdef");
    expect(other.status).toBe(409);
    expect(other.body.error).toBe("key_reused");
    const plain = await post({ title: "C", subject: { RU: "Тема" }, blocks: [] }, "");
    expect(plain.status).toBe(200);
  });
});

