/**
 * The checkout names a carrier ("omniva" | "smartpost" | "dpd" | "unisend" |
 * "novapost") in shipping.carrier. It must survive createOrder() and come back
 * out of the database, so Montonio Shipping (src/lib/shipping/montonio.ts) does
 * not have to guess it from a point id or a method label.
 *
 * The list this is checked against is deliberately one longer than the one the
 * shop offers — see SHIP_CARRIERS in src/lib/orders.ts. It answers «what may an
 * arriving order say», not «what do we sell».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { createOrder, getOrder } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, unknown>;
const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

function order(shipping: Record<string, unknown>) {
  return {
    lang: "ru",
    items: [{ id: plain.id, qty: 1 }],
    customer,
    shipping,
  } as Parameters<typeof createOrder>[0];
}

describe("createOrder keeps the carrier", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("stores shipping.carrier trimmed and lowercased, and reads it back", async () => {
    const o = await createOrder(
      order({ method: "parcel", country: "EE", carrier: " Omniva ", pointId: "omniva-96243", pointName: "Laagri Coop" }),
    );
    expect(o.shipping.carrier).toBe("omniva");

    const again = await getOrder(o.id);
    expect(again?.shipping.carrier).toBe("omniva");
  });

  it("stores null when the checkout sends no carrier", async () => {
    const courier = await createOrder(
      order({ method: "courier", country: "EE", carrier: "", address: { addr: "Kai 11", zip: "10111", city: "Tallinn" } }),
    );
    expect(courier.shipping.carrier).toBeNull();

    const absent = await createOrder(order({ method: "parcel", country: "EE" }));
    expect(absent.shipping.carrier).toBeNull();
    expect((await getOrder(absent.id))?.shipping.carrier).toBeNull();
  });

  /* A carrier the shop stopped offering is not junk, and the difference costs
     a parcel. Venipak went on 14.09.2026; a browser holding the bundle from
     before that draws the old chip, and the order it posts carries a Venipak
     pickup-point UUID. Refusing the name would keep the point and lose the
     only thing that says what the point is — resolvePickupPointId() has no
     carrier to look it up under, and Renat has no name to ring the shopper
     about. So it is stored, exactly as sent. */
  it("keeps a carrier the shop no longer offers, so a stale tab loses nothing", async () => {
    const stale = await createOrder(
      order({ method: "parcel", country: "EE", carrier: "Venipak", pointId: "30552d26-f4c5-4e88-b0bc-365da4f88222", pointName: "Narva Kreenholmi Maxima Venipak pakiautomaat" }),
    );
    expect(stale.shipping.carrier).toBe("venipak");
    expect((await getOrder(stale.id))?.shipping.carrier).toBe("venipak");
    // …and the point it came with is still on the order to address it by
    expect((await getOrder(stale.id))?.shipping.pointId).toBe("30552d26-f4c5-4e88-b0bc-365da4f88222");
  });

  it("stores null for a carrier it does not know, rather than junk", async () => {
    const unknown = await createOrder(order({ method: "parcel", country: "EE", carrier: "posti" }));
    expect(unknown.shipping.carrier).toBeNull();

    const long = await createOrder(order({ method: "parcel", country: "EE", carrier: "x".repeat(40) }));
    expect(long.shipping.carrier).toBeNull();
  });
});
