/**
 * A counter is not a parcel machine, and the shop must stop saying it is.
 *
 * Ренат, 14.09.2026: «Currently when I choose "nova Post" in checkout (for
 * estonia), it offers me package lockers - are you sure?»
 *
 * He was right to ask, and the data answers him without any guessing:
 * Montonio's pickup-point rows carry their own `type` — parcelMachine,
 * parcelShop, postOffice — and mapMontonioPickupPoints() has always folded it
 * into parcel_machine / pickup_point / post_office. /api/shipping/points/ has
 * always put it on the wire. Only the shop threw it away and printed
 * «Пакомат» over all of it.
 *
 * Measured against the live lists on 14.09.2026 (staging, four countries,
 * five carriers): 10 432 points, of which 1 295 are not machines — Nova Post
 * keeps 129 manned counters in Latvia, 110 in Lithuania and 3 in Estonia, and
 * Finnish DPD counts 1 053 against 1 519 machines. Every other carrier-country
 * pair is machines end to end.
 *
 * The owner chose to label each point rather than hide the counters, so this
 * file holds down the chain that makes the label true from the picker to the
 * letter: parser → order row → delivery line → shipped letter, plus the shop's
 * own POINT_KIND, sliced out of app.js the way the other storefront tests do.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { deliveryLine } from "@/emails/common";
import { renderOrderShipped } from "@/emails/order-shipped";
import { createOrder, getOrder, shipPointTypeOf } from "@/lib/orders";
import { mapMontonioPickupPoints } from "@/lib/shipping/montonio";
import { setupDb, teardownDb, truncateAll } from "./helpers";

/* ---------- 1. the parser: Montonio's own word, not a guess -------------- */

describe("mapMontonioPickupPoints keeps the kind Montonio sent", () => {
  const body = {
    countryCode: "LV",
    pickupPoints: [
      {
        id: "1",
        name: "Ādažu TC Apelsīns Venipak pakomāts",
        type: "parcelMachine",
        carrierCode: "novaPost",
        streetAddress: "Rīgas gatve 5",
        locality: "Ādaži",
      },
      {
        id: "2",
        name: "Rīgas DROGAS Avotu iela Venipak Pickup punkts",
        type: "parcelShop",
        carrierCode: "novaPost",
        streetAddress: "Avotu iela 26",
        locality: "Rīga",
      },
      { id: "3", name: "Some post office", type: "postOffice", carrierCode: "novaPost" },
    ],
  };

  it("folds parcelMachine / parcelShop / postOffice into our three words", () => {
    const out = mapMontonioPickupPoints(body);
    expect(out.map((p) => p.type)).toEqual(["parcel_machine", "pickup_point", "post_office"]);
  });

  /* The one thing that makes the label honest rather than a guess: the counter
     rows are counters because Montonio says so, not because their name reads
     like one. A name-reader would in fact be right about counters (not one of
     the 1 295 carries a machine word) and badly wrong about machines — an
     Itella automat is called «Viljandi Turu Konsum» — so the field is the only
     source, and a row without one stays a machine rather than being invented
     into a counter. */
  it("treats an unknown or missing type as a counter, never as a machine by accident", () => {
    const out = mapMontonioPickupPoints({
      countryCode: "EE",
      pickupPoints: [
        { id: "a", name: "Something new", type: "smartLocker" },
        { id: "b", name: "No type at all" },
      ],
    });
    expect(out.map((p) => p.type)).toEqual(["pickup_point", "pickup_point"]);
  });
});

/* ---------- 2. the order row: the kind is stored, and whitelisted -------- */

describe("shipPointTypeOf", () => {
  it("accepts the three kinds and nothing else", () => {
    expect(shipPointTypeOf("parcel_machine")).toBe("parcel_machine");
    expect(shipPointTypeOf(" Pickup_Point ")).toBe("pickup_point");
    expect(shipPointTypeOf("post_office")).toBe("post_office");
    expect(shipPointTypeOf("parcelMachine")).toBeNull();
    expect(shipPointTypeOf("<script>")).toBeNull();
    expect(shipPointTypeOf(null)).toBeNull();
    expect(shipPointTypeOf(42)).toBeNull();
  });
});

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

describe("createOrder stores what the point actually is", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("keeps pointType through the write and the read back", async () => {
    const o = await createOrder(
      order({
        method: "parcel",
        country: "LV",
        carrier: "novapost",
        pointId: "8b1f",
        pointName: "Rīgas DROGAS Avotu iela Venipak Pickup punkts",
        pointType: "pickup_point",
      }),
    );
    expect(o.shipping.pointType).toBe("pickup_point");
    expect((await getOrder(o.id))?.shipping.pointType).toBe("pickup_point");
  });

  it("stores null for an order that sends no kind", async () => {
    const old = await createOrder(
      order({ method: "parcel", country: "EE", carrier: "omniva", pointName: "Laagri Coop" }),
    );
    expect(old.shipping.pointType).toBeNull();
  });

  /* A digital order stores none of a parcel's fields at all — pointType goes
     the same way pointId and pointName already did (cleanShipping). */
  it("drops the kind on an all-gift-card order", async () => {
    const digital = await createOrder({
      lang: "ru",
      items: [{ id: "gift:50", qty: 1, meta: { email: "mari@example.com" } }],
      customer,
      shipping: { method: "digital", country: "EE", pointName: "Laagri Coop", pointType: "pickup_point" },
    } as Parameters<typeof createOrder>[0]);
    expect(digital.shipping.pointType).toBeNull();
    expect(digital.shipping.pointName).toBeNull();
  });
});

/* ---------- 3. the letters ---------------------------------------------- */

const AT_A_COUNTER = {
  method: "parcel",
  carrier: "novapost",
  pointName: "Rīgas DROGAS Avotu iela",
  pointType: "pickup_point",
  city: "Rīga",
};
const AT_A_MACHINE = { ...AT_A_COUNTER, pointType: "parcel_machine" };

describe("deliveryLine names the point, in three languages", () => {
  /* The letters put the carrier after the noun in RU and ET («Пакомат
     Omniva», «Pakiautomaat Omniva») and before it in EN — the shape the
     locker line has had all along, which the two new kinds follow. */
  it("calls a counter a counter", () => {
    expect(deliveryLine(AT_A_COUNTER, "ru")).toContain("Пункт выдачи Nova Post");
    expect(deliveryLine(AT_A_COUNTER, "et")).toContain("Pakipunkt Nova Post");
    expect(deliveryLine(AT_A_COUNTER, "en")).toContain("Nova Post pickup point");
  });

  it("never calls a counter a parcel machine", () => {
    expect(deliveryLine(AT_A_COUNTER, "ru")).not.toContain("Пакомат");
    expect(deliveryLine(AT_A_COUNTER, "et")).not.toContain("pakiautomaat");
    expect(deliveryLine(AT_A_COUNTER, "en")).not.toContain("parcel locker");
  });

  it("still calls a machine a machine", () => {
    expect(deliveryLine(AT_A_MACHINE, "ru")).toContain("Пакомат Nova Post");
    expect(deliveryLine(AT_A_MACHINE, "et")).toContain("Pakiautomaat Nova Post");
    expect(deliveryLine(AT_A_MACHINE, "en")).toContain("Nova Post parcel locker");
  });

  /* Every order placed before 14.09.2026 has no pointType at all, and the shop
     called all of them machines — so that is what they keep saying. */
  it("reads an order from before the field as a machine", () => {
    const { pointType: _drop, ...legacy } = AT_A_COUNTER;
    expect(deliveryLine(legacy, "ru")).toContain("Пакомат Nova Post");
  });

  it("names a post office as one", () => {
    expect(deliveryLine({ ...AT_A_COUNTER, pointType: "post_office" }, "ru")).toContain("Почта Nova Post");
    expect(deliveryLine({ ...AT_A_COUNTER, pointType: "post_office" }, "en")).toContain("Nova Post post office");
  });

  it("leaves the point's own name and town on the line", () => {
    expect(deliveryLine(AT_A_COUNTER, "ru")).toContain("Rīgas DROGAS Avotu iela");
    expect(deliveryLine(AT_A_COUNTER, "ru")).toContain("Rīga");
  });
});

describe("«Заказ отправлен» promises a door code only where there is a door", () => {
  const shipped = (shipping: Record<string, unknown>, lang: string) =>
    renderOrderShipped({ number: "R-100042", shipping, email: customer.email }, lang, {
      code: "CC123456789LV",
      carrier: "novapost",
    });

  it("tells a counter customer that a person hands the parcel over", () => {
    const ru = shipped(AT_A_COUNTER, "ru");
    expect(ru.text).toContain("посылку отдаст продавец");
    expect(ru.text).not.toContain("кодом дверцы");
    expect(shipped(AT_A_COUNTER, "et").text).toContain("annab üle müüja");
    expect(shipped(AT_A_COUNTER, "en").text).toContain("shop assistant hands the parcel over");
  });

  it("keeps the door-code note for a machine and for a pre-14.09 order", () => {
    expect(shipped(AT_A_MACHINE, "ru").text).toContain("кодом дверцы");
    const { pointType: _drop, ...legacy } = AT_A_COUNTER;
    expect(shipped(legacy, "ru").text).toContain("кодом дверцы");
  });
});

/* ---------- 4. the shop's own words ------------------------------------- */

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

describe("public/shop2/app.js labels each point", () => {
  /** Run app.js's own POINT_KIND / pointKind() — not a second copy of them. */
  const pointKind = new Function(
    "p",
    `${/\n\s+var POINT_KIND = \{[^}]*\};/.exec(src)?.[0] ?? ""}
     ${/\n\s+function pointKind\(p\) \{[^}]*\}/.exec(src)?.[0] ?? ""}
     return pointKind(p);`,
  ) as (p: { type?: string }) => string;

  it("says «Пакомат» for a machine and «Пункт выдачи» for a counter", () => {
    expect(pointKind({ type: "parcel_machine" })).toBe("Пакомат");
    expect(pointKind({ type: "pickup_point" })).toBe("Пункт выдачи");
    expect(pointKind({ type: "post_office" })).toBe("Почта");
  });

  it("never invents a machine out of a row with no kind", () => {
    expect(pointKind({})).toBe("Пункт выдачи");
    expect(pointKind({ type: "whatever" })).toBe("Пункт выдачи");
  });

  /* The three words have to be in the dictionary, or an ET/EN shopper reads
     Russian in the picker; tools/i18n-gaps.mjs checks the file as a whole, this
     checks the three that this change turns on. */
  it("has all three words in the ET and EN dictionaries", () => {
    for (const word of ['"Пункт выдачи": "Pakipunkt"', '"Почта": "Postkontor"', '"Пункт выдачи": "Pickup point"']) {
      expect(src).toContain(word);
    }
  });

  /* The heading over a mixed list. It has to widen, or the sentence Ренат
     objected to is still on the screen. */
  it("widens the picker heading only where the carrier's list really is mixed", () => {
    expect(src).toContain('var w = pointsMixed() ? "Пакомат или пункт выдачи" : "Пакомат";');
    expect(src).toContain("Пакомат или пункт выдачи (DPD|Omniva|SmartPosti|Unisend|Nova Post)");
  });

  /* No option may be filtered out — the alternative the owner did not pick. */
  it("filters nothing out of the list it draws", () => {
    const rows = /\n {2}function pointRows\(\) \{[\s\S]*?\n {2}\}/.exec(src)?.[0] ?? "";
    expect(rows).not.toContain("parcel_machine");
    expect(rows).toContain("pointKindLine(p)");
  });
});
