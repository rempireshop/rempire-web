/**
 * Does the number on the shopper's screen equal the number the server bills?
 *
 * That question is the whole of audit row 5 («the promo code is client-side
 * only … two shoppers see two different totals depending on which number the
 * server ends up trusting») and row 10 («the panel quotes a different price
 * table from the one checkout charges»). The storefront is a vanilla-JS IIFE
 * with no DOM here, so the three functions that do the arithmetic are **sliced
 * out of public/shop2/app.js by source text** and run against stubs — retyping
 * them would test this file instead of the shop, and the slice fails loudly if
 * app.js drops or renames one of them.
 *
 * The server half is imported for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { quoteFromPromo, type Promo } from "@/lib/promos";
import { DEFAULT_SHIPPING_RULES, quoteFromRules, type ShippingRules } from "@/lib/shipping";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** Read a `var <name> = { … };` literal out of app.js and evaluate it. */
function literal<T>(name: string): T {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      return new Function(`return ${src.slice(src.indexOf("{", start), i + 1)};`)() as T;
    }
  }
  throw new Error(`unbalanced braces around ${name} in app.js`);
}

type ClientOut = { discount: number; ship: number; sum: number; goods: number; base: number };
type PromoInfo = {
  code: string; kind: string; value: number; minSubtotal: number;
  /** 170_promo_scope: 'order' | 'brand' | 'product', and what it names. */
  scope?: string; scopeValue?: string | null;
} | null;

/**
 * Run the storefront's own discount() / promoLive() / shipPriceFor() over a
 * basket, with the handful of neighbours they call stubbed to the same values
 * the server is given.
 */
function client(
  promoInfo: PromoInfo,
  cartSum: number,
  rules: ShippingRules,
  country = "EE",
  method = "parcel",
  carrier = "",
  countryIso = "",
  /** How much of `cartSum` is a gift card's face value — see promoGoods(). */
  giftFace = 0,
  /** 170_promo_scope: the brand on the one product line, when a code names one. */
  brand = "",
): ClientOut {
  /* threshold() and orderCountry() are sliced out of app.js too rather than
     restated here. Both learned about the real country on 07.09.2026 — the
     shop prices Greece and Germany apart now — and a stub would have hidden
     exactly the drift this file exists to catch. */
  /* promoGoods() likewise: since 14.09.2026 a promo code may not touch a gift
     card's face value (codeDiscount() in src/lib/orders.ts draws the same
     line), and a stub here would hide exactly that. It walks the basket, so
     the basket is what the harness builds — one product line and, when a
     card is in play, one gift line. */
  /* promoBase()/promoLines()/promoLineIn() are sliced too, since 170: a code
     narrowed to one brand or one product is priced on the lines it matches,
     and those four functions ARE that arithmetic on the browser's side. A stub
     would hide the one drift that matters — a subset the screen and the server
     disagree about. byIdOrNull() is the only genuine stub: the harness's
     basket is one product line, and this is its brand. */
  const body = `
    ${slice("discount")}
    ${slice("promoGoods")}
    ${slice("promoLines")}
    ${slice("promoBrandKey")}
    ${slice("promoLineIn")}
    ${slice("promoBase")}
    ${slice("promoLive")}
    ${slice("shipPriceFor")}
    ${slice("shipRulePrice")}
    ${slice("threshold")}
    ${slice("orderCountry")}
    function byIdOrNull(id) { return { id: id, brand: BRAND, name: id }; }
    function lineUnit(l) { return l.type === "gift" ? GIFT_FACE : CART_SUM - GIFT_FACE; }
    function cartSum() { return CART_SUM; }
    function freeShip() { return cartSum() >= threshold(); }
    function shipMethod() { return METHOD; }
    function shipCarrier() { return S.ship.carrier; }
    function shipCost() { return shipPriceFor(shipMethod(), shipCarrier()); }
    return {
      discount: discount(), ship: shipCost(), sum: cartSum(),
      goods: promoGoods(), base: promoBase(S.promoInfo)
    };
  `;
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  /* MONTONIO_PRICE is the storefront's own copy of what an empty box charges —
     what shipRulePrice() falls back to when a carrier or a courier has no cell
     of its own, the same step quoteFromRules() takes on the server. Read out
     of app.js rather than restated, so the two cannot drift. */
  /* CARRIERS_BY_COUNTRY and COURIER_CARRIERS likewise: since 22.09.2026 a
     carrier prices a delivery only where the country offers it for that
     delivery type — a locker AND, since that day, a courier (owner's decision,
     Montonio-calculator carrier choice) — and shipRulePrice() reads the two
     lists to know. */
  const run = new Function(
    "S", "CART_SUM", "SHIP_RULES", "METHOD", "MONTONIO_PRICE", "GIFT_FACE", "BRAND",
    "CARRIERS_BY_COUNTRY", "COURIER_CARRIERS", body,
  ) as (
    s: unknown, n: number, r: ShippingRules, m: string, d: unknown, g: number, b: string,
    p: unknown, c: unknown,
  ) => ClientOut;
  const cart: Array<Record<string, unknown>> = [{ id: "p", qty: 1 }];
  if (giftFace > 0) cart.push({ type: "gift", id: "gift:50", qty: 1 });
  return run(
    { promoInfo, country, countryIso, ship: { carrier }, cart },
    cartSum, rules, method, literal<unknown>("MONTONIO_PRICE"), giftFace, brand,
    literal<unknown>("CARRIERS_BY_COUNTRY"), literal<unknown>("COURIER_CARRIERS"),
  );
}

/** The same basket the client harness builds, as src/lib/promos.ts reads it. */
function serverLines(cartSum: number, giftFace: number, brand: string) {
  const lines: Array<Record<string, unknown>> = [
    { id: "p", kind: "product", brand, sum: cartSum - giftFace },
  ];
  if (giftFace > 0) lines.push({ id: "gift:50", kind: "gift", brand, sum: giftFace });
  return lines;
}

const RULES: ShippingRules = {
  freeFrom: 59,
  methods: {
    parcel: { default: 4.99, EE: 3.49, LV: 4.99, LT: 4.99 },
    courier: { default: 9.9, EE: 5.99 },
    pickup: { default: 0 },
  },
};

const promo = (over: Partial<Promo>): Promo => ({
  code: "TESTCODE", kind: "percent", value: 10, minSubtotal: 0, startsAt: null, endsAt: null,
  maxUses: null, used: 0, active: true, note: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});

const cases: Array<[string, Promo | null, number]> = [
  ["no code at all", null, 40],
  ["10 % on a small basket", promo({ value: 10 }), 40],
  ["10 % on a basket that already ships free", promo({ value: 10 }), 80],
  ["a fixed code larger than the basket", promo({ kind: "fixed", value: 200 }), 12],
  ["a fixed code under the basket", promo({ kind: "fixed", value: 5 }), 40],
  ["free shipping on a paid delivery", promo({ kind: "free_shipping", value: 0 }), 40],
  ["free shipping on a basket that is already free", promo({ kind: "free_shipping", value: 0 }), 80],
  ["a code whose floor is not reached", promo({ value: 10, minSubtotal: 60 }), 40],
  ["a code whose floor is reached exactly", promo({ value: 10, minSubtotal: 60 }), 60],
  ["an odd basket, so the rounding shows", promo({ value: 15 }), 33.33],
];

/* The storefront is a static bundle: it cannot import the server's defaults,
   so it carries a copy of them. Twenty-five countries × two methods is far too
   much to keep in step by eye, and a single wrong cent is a shopper shown one
   price and billed another. */
describe("the storefront's copy of the default rules is the server's", () => {
  const mirror = literal<ShippingRules>("SHIP_RULES");

  it("has the same price in every cell", () => {
    expect(mirror.methods).toEqual(DEFAULT_SHIPPING_RULES.methods);
  });

  /* Ренат, 13.09.2026: «we get prices from Montonio and we should use those,
     we do not need to make them up.» This used to be an explicit `null`, and
     an empty carrier cell fell through to the country's «Пакомат» number — so
     Finland charged one price for a DPD locker that costs 12.39 € and a
     SmartPosti one that costs 9.30 €. Both halves now carry a price per
     carrier, and they have to be the same table or the shopper reads one
     number and is billed another. */
  it("has the same carrier price in every cell", () => {
    expect(mirror.carriers).toEqual(DEFAULT_SHIPPING_RULES.carriers);
    expect(mirror.carriers?.dpd?.FI).not.toBe(mirror.carriers?.smartpost?.FI);
  });

  it("has the same free-delivery floors and the same countries switched off", () => {
    expect(mirror.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
    /* Dim, 08.09.2026: «Rest of EU — from €200». Both halves have to carry it,
       or the shopper reads one threshold in the basket and the server applies
       another — and this is the cell where that difference is 141 €. */
    expect(mirror.freeFromByCountry).toEqual(DEFAULT_SHIPPING_RULES.freeFromByCountry);
    expect(mirror.freeFromByCountry).toEqual({ EU: 200 });
    expect([...(mirror.countriesOff ?? [])].sort()).toEqual(
      [...(DEFAULT_SHIPPING_RULES.countriesOff ?? [])].sort(),
    );
  });
});

describe("the checkout total on screen equals the one the server bills", () => {
  for (const [label, p, sum] of cases) {
    it(label, () => {
      const info: PromoInfo = p
        ? { code: p.code, kind: p.kind, value: p.value, minSubtotal: p.minSubtotal }
        : null;
      const c = client(info, sum, RULES);

      const serverShip = quoteFromRules(RULES, { country: "EE", method: "parcel", subtotal: sum }).price;
      const quote = p ? quoteFromPromo(p, sum, serverShip, new Date(), serverLines(sum, 0, "")) : null;
      const serverDiscount = quote?.ok ? quote.discount : 0;

      expect(c.ship).toBe(serverShip);
      expect(c.discount).toBe(serverDiscount);
      expect(Math.round((c.sum - c.discount + c.ship) * 100) / 100)
        .toBe(Math.round((sum + serverShip - serverDiscount) * 100) / 100);
    });
  }

  /* A gift card in the basket. Its face value is money the shop owes back in
     full when the code is spent, so a promo may not take a percent of it —
     «−10 %» on a 100 € card was ten euro of the shop's own money, and the
     card was still minted at 100 € on the paid transition (audit
     14.09.2026). createOrder() hands quotePromo() the goods only; this is the
     browser drawing the same line, so the screen and the bill still agree. */
  describe("a promo code and a gift card in one basket", () => {
    const tenPct = promo({ value: 10 });
    const info: PromoInfo = { code: tenPct.code, kind: tenPct.kind, value: tenPct.value, minSubtotal: 0 };

    it("takes its percent off the goods and none off the card", () => {
      const c = client(info, 140, RULES, "EE", "parcel", "", "", 100);
      expect(c.goods).toBe(40);
      // the server is given the same 40 €, and both come to 4 €
      const serverShip = quoteFromRules(RULES, { country: "EE", method: "parcel", subtotal: 140 }).price;
      expect(c.discount).toBe(quoteFromPromo(tenPct, 40, serverShip).discount);
      expect(c.discount).toBe(4);
    });

    it("takes nothing off a basket that is only gift cards", () => {
      const c = client(info, 100, RULES, "EE", "digital", "", "", 100);
      expect(c.goods).toBe(0);
      expect(c.discount).toBe(0);
      expect(quoteFromPromo(tenPct, 0, 0).discount).toBe(0);
    });

    it("measures the code's floor against the goods too", () => {
      const floor = promo({ value: 10, minSubtotal: 60 });
      const withFloor: PromoInfo = { code: floor.code, kind: floor.kind, value: floor.value, minSubtotal: 60 };
      // 100 € of card plus 40 € of shampoo used to clear a 60 € floor
      const c = client(withFloor, 140, RULES, "EE", "parcel", "", "", 100);
      expect(c.discount).toBe(0);
      expect(quoteFromPromo(floor, 40, 0).ok).toBe(false);
    });
  });

  /* A code narrowed to one brand or one product (db/migrations/170_promo_scope).
     The subset is arithmetic the browser has to do too — it is what the
     summary shows while the shopper is still editing the basket — so this is
     the one place the two halves of that arithmetic are compared directly.
     The harness's basket is one product line, so «matches» and «does not» are
     the whole of the space, and the third case is the one that would hurt: a
     Davines code on a basket with no Davines in it must take nothing, not
     everything. */
  describe("a code narrowed to a brand or a product", () => {
    const cases: Array<[string, Partial<Promo>, string, number]> = [
      ["ten per cent off the brand in the basket", { value: 10, scope: "brand", scopeValue: "Davines" }, "Davines", 140],
      ["…and nothing when the basket is another brand", { value: 10, scope: "brand", scopeValue: "Davines" }, "Proraso", 140],
      ["a fixed code capped at the matching line", { kind: "fixed", value: 200, scope: "brand", scopeValue: "Davines" }, "Davines", 12],
      ["a product code that names the line", { value: 25, scope: "product", scopeValue: "p" }, "Davines", 80],
      ["…and one that names something else", { value: 25, scope: "product", scopeValue: "other" }, "Davines", 80],
      ["a floor measured on the subset, cleared", { value: 10, minSubtotal: 60, scope: "brand", scopeValue: "Davines" }, "Davines", 80],
      ["a floor measured on the subset, missed", { value: 10, minSubtotal: 60, scope: "brand", scopeValue: "Davines" }, "Davines", 40],
    ];

    for (const [label, over, brand, sum] of cases) {
      it(label, () => {
        const p = promo(over);
        const info: PromoInfo = {
          code: p.code, kind: p.kind, value: p.value, minSubtotal: p.minSubtotal,
          scope: p.scope, scopeValue: p.scopeValue ?? null,
        };
        const c = client(info, sum, RULES, "EE", "parcel", "", "", 0, brand);
        const serverShip = quoteFromRules(RULES, { country: "EE", method: "parcel", subtotal: sum }).price;
        const quote = quoteFromPromo(p, sum, serverShip, new Date(), serverLines(sum, 0, brand));
        expect(c.base).toBe(quote.ok || quote.error === "min_subtotal" ? quote.base : 0);
        expect(c.discount).toBe(quote.ok ? quote.discount : 0);
      });
    }

    it("never reaches a gift card, whichever way the code is pointed", () => {
      // a product code naming the card's own line — the one shape the scope
      // made possible, and the audit of 14.09.2026 closed for the other two
      const atCard = promo({ value: 10, scope: "product", scopeValue: "gift:50" });
      const info: PromoInfo = {
        code: atCard.code, kind: atCard.kind, value: atCard.value, minSubtotal: 0,
        scope: "product", scopeValue: "gift:50",
      };
      const c = client(info, 140, RULES, "EE", "parcel", "", "", 100, "Davines");
      expect(c.discount).toBe(0);
      const quote = quoteFromPromo(atCard, 40, 3.49, new Date(), serverLines(140, 100, "Davines"));
      expect(quote).toMatchObject({ ok: false, error: "no_match" });
    });
  });

  it("agrees about a country the owner priced separately", () => {
    const rules: ShippingRules = { ...RULES, freeFromByCountry: { LV: null }, methods: { ...RULES.methods, parcel: { ...RULES.methods.parcel, LV: 6.9 } } };
    const c = client(null, 500, rules, "LV");
    const server = quoteFromRules(rules, { country: "LV", method: "parcel", subtotal: 500 });
    // «never free in Latvia» has to survive on both sides, or a 500 € basket
    // ships free on screen and is billed 6,90 €
    expect(c.ship).toBe(6.9);
    expect(server.price).toBe(6.9);
  });

  /* «Другая страна Европы» → the second select. The shopper's screen has to
     price the country he actually picked, not the zone: this is the whole of
     the 07.09.2026 change, and getting it wrong shows 9,90 € for Greece and
     bills 43,19 €. */
  it("agrees about every country behind «Другая страна Европы»", () => {
    for (const iso of Object.keys(DEFAULT_SHIPPING_RULES.methods.courier)) {
      if (iso === "default") continue;
      const c = client(null, 40, DEFAULT_SHIPPING_RULES, "EU", "courier", "", iso);
      const server = quoteFromRules(DEFAULT_SHIPPING_RULES, {
        country: iso, method: "courier", subtotal: 40,
      });
      expect([iso, c.ship]).toEqual([iso, server.price]);
    }
  });

  /* The floors the shop actually ships with, not a fixture: 59 € at home and
     200 € for the rest of Europe (Dim, 08.09.2026). A 59 € basket to Germany
     is the exact case the audit found — free on screen, 22,29 € of courier off
     the shop (17,59 € since the 22.09.2026 re-quote for the 25 × 18 × 8 cm
     carton) — so it is the one worth pinning on both sides. */
  it("agrees about the default floors: 59 € at home, 200 € for the rest of Europe", () => {
    const at = (country: string, zone: string, sum: number, iso = "") => {
      const c = client(null, sum, DEFAULT_SHIPPING_RULES, zone, "courier", "", iso);
      const server = quoteFromRules(DEFAULT_SHIPPING_RULES, { country, method: "courier", subtotal: sum });
      expect([country, sum, c.ship]).toEqual([country, sum, server.price]);
      return server;
    };
    expect(at("EE", "EE", 59).price).toBe(0);
    expect(at("DE", "EU", 59, "DE").price).toBe(17.59);
    expect(at("DE", "EU", 199.99, "DE").price).toBe(17.59);
    expect(at("DE", "EU", 200, "DE").price).toBe(0);
    expect(at("GR", "EU", 59, "GR").freeFrom).toBe(200);
  });

  it("agrees about the free-delivery floor a zone sets for all of Europe", () => {
    const rules: ShippingRules = {
      ...DEFAULT_SHIPPING_RULES,
      freeFromByCountry: { EU: 150, GR: null },
    };
    for (const [iso, sum] of [["DE", 100], ["DE", 150], ["GR", 10_000]] as const) {
      const c = client(null, sum, rules, "EU", "courier", "", iso);
      const server = quoteFromRules(rules, { country: iso, method: "courier", subtotal: sum });
      expect([iso, sum, c.ship]).toEqual([iso, sum, server.price]);
    }
  });

  /* A carrier price is a parcel-machine price — the fill button writes no
     courier ones. Both halves have to ignore it for a courier, or the screen
     and the bill disagree the moment «Заполнить по тарифам Montonio» is used. */
  it("agrees that a carrier price does not price a courier", () => {
    const rules: ShippingRules = { ...RULES, carriers: { omniva: { EE: 2.99 } } };
    const c = client(null, 40, rules, "EE", "courier");
    const server = quoteFromRules(rules, {
      country: "EE", method: "courier", subtotal: 40, carrier: "omniva",
    });
    expect(c.ship).toBe(server.price);
    expect(c.ship).toBe(5.99);
  });

  /* …and the other half of the same rule: an EMPTY carrier cell is Montonio's
     own price for that carrier, not the country's «Пакомат» number. The
     screen has to say so too — this is the pair Renat found, one Finnish
     price for two different bills. */
  it("agrees that an empty carrier cell is priced per carrier", () => {
    const rules: ShippingRules = { ...RULES, methods: { ...RULES.methods, parcel: { ...RULES.methods.parcel, FI: 7.89 } } };
    for (const [carrier, expected] of [["dpd", 12.39], ["smartpost", 9.39]] as const) {
      const c = client(null, 40, rules, "FI", "parcel", carrier);
      const server = quoteFromRules(rules, { country: "FI", method: "parcel", subtotal: 40, carrier });
      expect(c.ship, carrier).toBe(server.price);
      expect(c.ship, carrier).toBe(expected);
    }
  });
});
