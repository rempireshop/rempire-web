/**
 * «Партнёры и баллы» — the one switch above wholesale pricing and the points
 * programme (settings.pricing.partnersOn, Dim 07.09.2026: default OFF,
 * «Renat said later»).
 *
 * The point of the switch is that nothing BREAKS while it is off and nothing
 * is LOST either: an approved partner is billed retail, no points are earned
 * or spent, and the moment it goes back on every stored number is exactly
 * where it was. That is what this file proves — the half a browser cannot.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { query } from "@/lib/db";
import { recordLogin } from "@/lib/customers";
import { createOrder, priceItems, upsertOverride } from "@/lib/orders";
import {
  accountLoyaltySummary,
  adjustLoyaltyPoints,
  approveProCustomer,
  earnLoyaltyPoints,
  getLoyaltyBalance,
} from "@/lib/loyalty";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const plain = CATALOGUE.find((p) => p.s === "in")!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const ship = { method: "parcel", country: "EE" };

async function setPricing(value: Record<string, unknown>): Promise<void> {
  await query(
    `insert into settings (key, value) values ('pricing', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(value)],
  );
}
async function proCustomer(email: string): Promise<string> {
  const c = await recordLogin(email, "RU");
  await approveProCustomer(c.id);
  return c.id;
}

describe("«Партнёры и баллы» off — the default", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("bills an approved partner at retail and records the order as retail", async () => {
    await setPricing({ proDiscountPct: 40, loyalty: { enabled: true, earnPct: 5 } });
    const id = await proCustomer("salon-off@example.com");
    const { lines, pricingTier } = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(pricingTier, "an order was priced as wholesale with the programme off").toBe("retail");
    expect(lines[0].price).toBe(plain.p);
  });

  it("ignores a per-product salon price too", async () => {
    await setPricing({ proDiscountPct: 40 });
    await upsertOverride(plain.id, { proPrice: 1 });
    const id = await proCustomer("salon-off2@example.com");
    const { lines } = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(lines[0].price, "a per-product salon price leaked through the off switch").toBe(plain.p);
  });

  it("earns no points, whatever wrote the sale", async () => {
    await setPricing({ loyalty: { enabled: true, earnPct: 50 } });
    const c = await recordLogin("points-off@example.com", "RU");
    const out = await earnLoyaltyPoints(c.id, "11111111-1111-1111-1111-111111111111", 100);
    expect(out.ok).toBe(true);
    expect(out.points).toBe(0);
    expect(await getLoyaltyBalance(c.id)).toBe(0);
  });

  it("spends none either — «Использовать баллы» is quoted at zero", async () => {
    await setPricing({ loyalty: { enabled: true, earnPct: 5, redeemMaxPct: 100, minRedeem: 0 } });
    const c = await recordLogin("redeem-off@example.com", "RU");
    await adjustLoyaltyPoints(c.id, 50, "seed");
    const order = await createOrder(
      { lang: "ru", items: [{ id: plain.id, qty: 1 }], customer, shipping: ship, redeemPoints: true },
      { customerId: c.id },
    );
    expect(order.loyaltyDiscount, "points came off a basket with the programme off").toBe(0);
    expect(await getLoyaltyBalance(c.id), "the balance was touched").toBe(50);
  });

  it("tells the cabinet the programme is off, while keeping the balance", async () => {
    await setPricing({ loyalty: { enabled: true, earnPct: 5 } });
    const c = await recordLogin("cabinet-off@example.com", "RU");
    await adjustLoyaltyPoints(c.id, 12, "seed");
    const summary = await accountLoyaltySummary(c.id);
    expect(summary.settings.enabled).toBe(false);
    expect(summary.balance, "the stored balance was lost").toBe(12);
  });

  it("keeps the partner's own row, so the switch back on restores everything", async () => {
    await setPricing({ proDiscountPct: 25, loyalty: { enabled: true, earnPct: 5 } });
    const id = await proCustomer("salon-back@example.com");
    await adjustLoyaltyPoints(id, 30, "seed");

    // off: retail, no points
    const off = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(off.pricingTier).toBe("retail");
    expect((await accountLoyaltySummary(id)).settings.enabled).toBe(false);

    // …and on again: exactly what was stored, with nothing re-entered
    await setPricing({ partnersOn: true, proDiscountPct: 25, loyalty: { enabled: true, earnPct: 5 } });
    const on = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(on.pricingTier).toBe("pro");
    expect(on.lines[0].price).toBe(Math.round(plain.p * 0.75 * 100) / 100);
    const back = await accountLoyaltySummary(id);
    expect(back.settings.enabled).toBe(true);
    expect(back.balance, "the balance did not survive the switch").toBe(30);
  });

  it("the storefront feed says so, without ever naming the discount", async () => {
    await setPricing({ proDiscountPct: 42, proMinOrder: 77, loyalty: { enabled: true, earnPct: 8 } });
    const { GET } = await import("@/app/api/overrides/route");
    const body = await (await GET()).json();
    expect(body.settings.pricing).toEqual({ partnersOn: false, loyalty: { enabled: false, earnPct: 8 } });
    expect(JSON.stringify(body)).not.toContain("42");
  });
});
