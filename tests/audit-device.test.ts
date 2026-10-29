/**
 * The journal records which device made a change (db/migrations/225_audit_device.sql):
 * the request's User-Agent, so a burst like the one of 28.10.2026 can be traced
 * to a phone or a computer. Outside a request there is none, and nothing fails.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll } from "./helpers";

let ua: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => {
    if (ua === null) throw new Error("outside a request");
    return new Headers({ "user-agent": ua });
  },
}));

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(truncateAll);

const last = async () =>
  (await query<{ action: string; device: string | null }>("select action, device from admin_audit order by id desc limit 1"))[0];

describe("writeAudit() — the device", () => {
  it("stores the request's User-Agent, cut to 300 characters", async () => {
    const { writeAudit } = await import("@/lib/orders");
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1 " + "x".repeat(400);
    await writeAudit("admin", "override.set", { id: "p", patch: { hidden: true } }, { before: { hidden: false } });
    const row = await last();
    expect(row.device?.startsWith("Mozilla/5.0 (iPhone")).toBe(true);
    expect(row.device?.length).toBe(300);
  });

  it("keeps no device on a customer's row — only the panel's own", async () => {
    const { writeAudit } = await import("@/lib/orders");
    ua = "Mozilla/5.0 (Android 15) Chrome/141";
    await writeAudit("someone@example.com", "account.consent", { marketing: true });
    expect(await last()).toEqual({ action: "account.consent", device: null });
  });

  it("writes the row without one outside a request", async () => {
    const { writeAudit } = await import("@/lib/orders");
    ua = null;
    await writeAudit("system", "flows.run", { ok: true });
    expect(await last()).toEqual({ action: "flows.run", device: null });
  });
});

describe("writeAudit() — before migration 225 has run", () => {
  it("still writes the row, without the device", async () => {
    const { writeAudit } = await import("@/lib/orders");
    await query("alter table admin_audit drop column device");
    try {
      ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/141";
      await writeAudit("admin", "override.set", { id: "p", patch: { hidden: false } });
      const rows = await query<{ action: string }>("select action from admin_audit order by id desc limit 1");
      expect(rows[0].action).toBe("override.set");
    } finally {
      await query("alter table admin_audit add column if not exists device text");
    }
  });
});
