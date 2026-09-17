/**
 * «+ Партнёр» and the row that appeared in between — src/lib/loyalty.ts
 * upsertPartner(), POST /api/admin/customers.
 *
 * The function reads the customer row first, and creates it with `on conflict
 * (email) do nothing` when there is none. recordLogin() creates exactly that
 * row at a customer's first sign-in, so one landing between the read and the
 * insert leaves the insert with nothing to do and the tier still 'retail' —
 * while `promoted`, computed from the read that opened the call, said the
 * opposite. The route sends «Цены для салонов включены» on `promoted`, so the
 * customer was told salon prices were on while they were still paying retail,
 * and the audit line claimed a row this call had not made.
 *
 * Microseconds wide and impossible to hit by timing in a test, so the
 * interleave is driven directly: `@/lib/db` is wrapped, and the hook runs the
 * concurrent sign-in the moment upsertPartner's own read comes back. Everything
 * else goes to the real PGlite underneath — this is the shop's own query(),
 * with one seam in it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Runs once, right after the next `getCustomerAdminByEmail` read. */
let onNextCustomerRead: null | (() => Promise<void>) = null;

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    query: async (sql: string, params?: unknown[]) => {
      const rows = await actual.query(sql, params);
      if (onNextCustomerRead && sql.includes("where lower(c.email) = $1")) {
        const hook = onNextCustomerRead;
        onNextCustomerRead = null; // one shot: the re-read afterwards is untouched
        await hook();
      }
      return rows;
    },
  };
});

/* Static, like every other suite: vitest hoists the vi.mock() above them, so
   the modules below are already wired to the wrapper when they load. */
import { recordLogin } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { upsertPartner } from "@/lib/loyalty";
import { setupDb, teardownDb } from "./helpers";

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await teardownDb();
});

beforeEach(async () => {
  onNextCustomerRead = null;
  await exec("truncate customers restart identity cascade");
});

describe("upsertPartner — the promotion it reports is the one that happened", () => {
  it("promotes and creates the ordinary way", async () => {
    const out = await upsertPartner({ email: "new@example.com", company: "OÜ Näidis", tier: "pro" });
    expect(out).toMatchObject({ created: true, promoted: true });
    expect(out?.customer.tier).toBe("pro");
  });

  it("promotes a row that already existed, without claiming to have made it", async () => {
    await recordLogin("shopper@example.com", "RU");
    const out = await upsertPartner({ email: "shopper@example.com", tier: "pro" });
    expect(out).toMatchObject({ created: false, promoted: true });
    expect(out?.customer.tier).toBe("pro");
  });

  it("a partner who is already pro is not promoted twice", async () => {
    await upsertPartner({ email: "twice@example.com", tier: "pro" });
    const again = await upsertPartner({ email: "twice@example.com", tier: "pro" });
    expect(again).toMatchObject({ created: false, promoted: false });
  });

  it("reports no promotion when a first sign-in created the row in between", async () => {
    const email = "race@example.com";
    onNextCustomerRead = async () => {
      await recordLogin(email, "RU"); // the customer signs in, microseconds early
    };

    const out = await upsertPartner({ email, company: "OÜ Näidis", tier: "pro" });
    expect(out).toBeTruthy();
    // `on conflict do nothing` found the row and left it alone
    expect(out?.customer.tier).toBe("retail");
    const [row] = await query<{ tier: string }>("select tier from customers where email = $1", [email]);
    expect(row.tier).toBe("retail");

    // so no letter is due and no row was created here — both were claimed
    expect(out?.promoted).toBe(false);
    expect(out?.created).toBe(false);
  });
});
