/**
 * «Электронная доставка» — the order side of a basket that holds nothing but
 * gift cards.
 *
 * The rule is one line of createOrder(): a `digital` order pays no delivery,
 * and it is refused outright if it carries anything that would have to be
 * posted. The checkout in public/shop2/app.js decides the same thing from the
 * same basket, but this is the door — a body that says "digital" while holding
 * a bottle of shampoo would otherwise get free courier delivery.
 *
 * See docs/features.md § «Только подарочные карты» and docs/payments.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { exec, query } from "@/lib/db";
import { createOrder, OrderError, shipMethodOf } from "@/lib/orders";
import { computeShipping, DEFAULT_SHIPPING_RULES, resetShippingRulesCache } from "@/lib/shipping";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; s: string; p: number };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const digital = { method: "digital", country: "EE" };

function giftOrder(extra: Record<string, unknown> = {}) {
  return {
    lang: "ru",
    items: [{ id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com", message: "С днём рождения!" } }],
    customer,
    shipping: digital,
    ...extra,
  } as Parameters<typeof createOrder>[0];
}

describe("shipMethodOf", () => {
  it("accepts «digital» as a fourth method and never guesses it", () => {
    expect(shipMethodOf("digital")).toBe("digital");
    expect(shipMethodOf("DIGITAL")).toBe("digital");
    // words a shopper might type are mapped to the three physical shapes only
    expect(shipMethodOf("электронная доставка")).toBe("parcel");
    expect(shipMethodOf("e-mail")).toBe("parcel");
    expect(shipMethodOf("самовывоз")).toBe("pickup");
    expect(shipMethodOf("")).toBe("parcel");
  });
});

describe("createOrder — a gift-cards-only order", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    // truncateAll() wipes `settings`; the rules are cached for minutes
    resetShippingRulesCache();
  });

  it("stores method «digital» and charges no delivery", async () => {
    const o = await createOrder(giftOrder());
    expect(o.shipping.method).toBe("digital");
    expect(o.shippingPrice).toBe(0);
    expect(o.total).toBe(50);
    expect(o.items).toHaveLength(1);
    expect(o.items[0].kind).toBe("gift");
    // the recipient typed at checkout rides on the line, for issueGiftCards()
    expect(o.items[0].meta).toMatchObject({ name: "Mari", email: "mari@example.com" });
  });

  it("keeps none of a parcel's fields — there is no parcel", async () => {
    const o = await createOrder(
      giftOrder({
        shipping: {
          method: "digital",
          country: "EE",
          carrier: "omniva",
          pointId: "omniva-1",
          pointName: "Ülemiste",
          address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" },
        },
      }),
    );
    expect(o.shipping.carrier).toBeNull();
    expect(o.shipping.pointId).toBeNull();
    expect(o.shipping.pointName).toBeNull();
    expect(o.shipping.address).toBeNull();
    // the country is the customer's, not the parcel's — the export reads it
    expect(o.shipping.country).toBe("EE");
  });

  it("refuses a digital order that carries a physical product", async () => {
    const mixed = giftOrder({
      items: [{ id: "gift:50", qty: 1 }, { id: product.id, qty: 1 }],
    });
    await expect(createOrder(mixed)).rejects.toBeInstanceOf(OrderError);
    await expect(createOrder(mixed)).rejects.toMatchObject({ code: "not_digital" });
  });

  it("refuses a digital order made only of a physical product", async () => {
    await expect(
      createOrder(giftOrder({ items: [{ id: product.id, qty: 1 }] })),
    ).rejects.toMatchObject({ code: "not_digital" });
  });

  it("prices a mixed basket exactly as the shipping rules say — the gift line changes nothing", async () => {
    /* Something still has to be posted, so the ordinary flow applies. The
       expected figure comes from the rules themselves rather than a hard-coded
       euro amount: the free-shipping floor is the owner's to move, and a
       50 € card already clears the default one. */
    const items = [{ id: "gift:50", qty: 1 }, { id: product.id, qty: 1 }];
    const o = await createOrder(giftOrder({ items, shipping: { method: "courier", country: "EE" } }));
    const expected = await computeShipping({ country: "EE", method: "courier", subtotal: o.subtotal });
    expect(o.shipping.method).toBe("courier");
    expect(o.shippingPrice).toBe(expected.price);
    expect(o.total).toBe(Math.round((o.subtotal + o.shippingPrice) * 100) / 100);
  });

  it("bills a mixed basket below the free-shipping floor for real delivery", async () => {
    const cheap = { ...DEFAULT_SHIPPING_RULES, freeFrom: null };
    await exec("delete from settings where key = 'shipping_rules'");
    await query("insert into settings (key, value) values ('shipping_rules', $1::jsonb)", [
      JSON.stringify(cheap),
    ]);
    resetShippingRulesCache();
    const o = await createOrder(
      giftOrder({
        items: [{ id: "gift:25", qty: 1 }, { id: product.id, qty: 1 }],
        shipping: { method: "courier", country: "EE" },
      }),
    );
    expect(o.shippingPrice).toBeGreaterThan(0);
    // …while the same basket with the product taken out pays nothing
    const giftsOnly = await createOrder(giftOrder({ shipping: { method: "courier", country: "EE" } }));
    expect(giftsOnly.shippingPrice).toBe(0);
  });

  it("prices an all-gift-card basket at 0 even when the client asks for a courier", async () => {
    /* The old rule (nothing physical ⇒ no delivery) still stands on its own:
       a client that never learned about «digital» must not be billed for a
       courier that has nothing to carry. */
    const o = await createOrder(giftOrder({ shipping: { method: "courier", country: "EE" } }));
    expect(o.shipping.method).toBe("courier");
    expect(o.shippingPrice).toBe(0);
    expect(o.total).toBe(50);
  });
});
