/**
 * The checkout names a carrier ("omniva" | "smartpost" | "dpd" | "venipak") in
 * shipping.carrier. It must survive createOrder() and come back out of the
 * database, so Montonio Shipping (src/lib/shipping/montonio.ts) does not have
 * to guess it from a point id or a method label.
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

  it("stores null for a carrier it does not know, rather than junk", async () => {
    const unknown = await createOrder(order({ method: "parcel", country: "EE", carrier: "posti" }));
    expect(unknown.shipping.carrier).toBeNull();

    const long = await createOrder(order({ method: "parcel", country: "EE", carrier: "x".repeat(40) }));
    expect(long.shipping.carrier).toBeNull();
  });
});
