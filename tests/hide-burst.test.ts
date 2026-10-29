/**
 * A burst of hides is refused, and a mass hide that got through is reported.
 *
 * 28.10.2026: the panel's «Показывать в магазине» switches fired at machine
 * speed (a held key or a touch glitch) — 75 products in stock hidden in five
 * seconds. PUT /api/admin/overrides/ now refuses more than ten hides a minute
 * without `confirmHide`, and runHideWatch() (src/lib/build-watch.ts) writes
 * the next morning when products on the shelf were hidden en masse.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const sent: Array<{ to: string | string[]; subject: string; text?: string }> = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string | string[]; subject: string; text?: string }) => {
    sent.push(m);
    return { ok: true };
  },
}));

const ORIGIN = "https://rempireshop.com";
let admin = "";
const put = async (body: unknown) => {
  const { PUT } = await import("@/app/api/admin/overrides/route");
  return PUT(new Request(`${ORIGIN}/api/admin/overrides/`, {
    method: "PUT", headers: { cookie: admin, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `burst-product-${i}`);

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});
afterAll(teardownDb);
beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  process.env.RESEND_TO = "shop@example.com";
  delete process.env.DEV_ALERT_TO;
});

describe("PUT /api/admin/overrides/ — a burst of hides", () => {
  it("takes ten hides a minute and refuses the eleventh", async () => {
    for (const id of ids(10)) expect((await put({ id, hidden: true })).status).toBe(200);
    const res = await put({ id: "burst-product-10", hidden: true });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, error: "hide_burst", detail: "10" });
    const rows = await query<{ hidden: boolean }>("select hidden from product_overrides where product_id = 'burst-product-10'");
    expect(rows[0]?.hidden ?? false).toBe(false);
  });

  it("never limits showing a product, and lets a confirmed clear-out through", async () => {
    for (const id of ids(10)) await put({ id, hidden: true });
    for (const id of ids(10)) expect((await put({ id, hidden: false })).status).toBe(200);
    expect((await put({ items: ids(12).map((id) => ({ id, hidden: true })), confirmHide: true })).status).toBe(200);
  });

  it("counts every hide in one batch", async () => {
    const res = await put({ items: ids(11).map((id) => ({ id, hidden: true })) });
    expect(res.status).toBe(429);
  });
});

describe("runHideWatch()", () => {
  const stock = (id: string, qty: number) =>
    query("insert into stock_levels (product_id, variant, qty) values ($1, '', $2)", [id, qty]);

  it("writes when eight or more products on the shelf were hidden in a day", async () => {
    const { runHideWatch } = await import("@/lib/build-watch");
    for (const id of ids(8)) {
      await stock(id, 3);
      await put({ id, hidden: true });
    }
    expect(await runHideWatch()).toEqual({ sent: true, hidden: 8 });
    expect(sent[0].to).toEqual(["shop@example.com", "info@diipsolutions.eu"]);
    expect(sent[0].subject).toBe("REMPIRE — скрыто 8 товаров в наличии");
    expect(sent[0].text).toContain("— burst-product-0");
  });

  it("stays quiet for a few hides, for sold-out products and for products shown again", async () => {
    const { runHideWatch } = await import("@/lib/build-watch");
    for (const id of ids(8)) {
      await stock(id, id.endsWith("0") ? 3 : 0);
      await put({ id, hidden: true });
    }
    expect(await runHideWatch()).toEqual({ sent: false, hidden: 1 });
    expect(sent).toEqual([]);
  });
});
