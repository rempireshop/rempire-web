/**
 * Scoped promo codes — «−10 % на Davines», «−5 € на этот шампунь».
 * db/migrations/170_promo_scope.sql, priced by src/lib/promos.ts.
 *
 * The one rule everything here exists to hold: **a scoped code discounts the
 * matching lines and nothing else.** Renat chose that reading himself, against
 * the whole-basket ones, on the arithmetic that a shopper must not take ten
 * per cent off a 200 € order by adding one 9 € bottle to it.
 *
 * What is checked, beyond the arithmetic:
 *   · a fixed-euro code is capped at the matching lines' total;
 *   · a free-delivery code cannot be scoped at all — refused by validatePromo
 *     and, underneath it, by the table's own constraint;
 *   · a gift card's face value is out of reach of a scoped code, the way the
 *     audit of 14.09.2026 put it out of reach of a whole-basket one;
 *   · every code written before 170 prices exactly as it did.
 *
 * Runs on PGlite — a real Postgres, no server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { exec, query } from "@/lib/db";
import { createOrder } from "@/lib/orders";
import { earnableSubtotal } from "@/lib/payments/apply";
import {
  getPromo,
  promoBaseFor,
  promoLineMatches,
  quoteFromPromo,
  quotePromo,
  upsertPromo,
  validatePromo,
  type Promo,
  type PromoBasketLine,
} from "@/lib/promos";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];

/** Two products of one brand and one of another, all in stock and all priced. */
const inStock = CATALOGUE.filter((p) => p.s === "in" && p.p > 0);
const SCOPED_BRAND = inStock.find(
  (p) => inStock.filter((q) => q.b === p.b).length >= 2 && inStock.some((q) => q.b !== p.b),
)!.b;
const [mineA, mineB] = inStock.filter((p) => p.b === SCOPED_BRAND);
const other = inStock.find((p) => p.b !== SCOPED_BRAND)!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

async function make(over: Partial<Promo> & { code: string }): Promise<Promo> {
  const check = validatePromo({
    kind: "percent",
    value: 10,
    minSubtotal: 0,
    startsAt: null,
    endsAt: null,
    maxUses: null,
    active: true,
    note: null,
    scope: "order",
    ...over,
  });
  if (!check.ok) throw new Error("bad fixture: " + check.error);
  return upsertPromo(check.value);
}

const money = (n: number) => Math.round(n * 100) / 100;

describe("promo codes scoped to a brand or a product", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("170_promo_scope.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
  });

  /* ---------- the matcher, on its own ---------- */

  it("matches a line by brand and by product id, and never a gift card", () => {
    const shampoo: PromoBasketLine = { id: mineA.id, kind: "product", brand: SCOPED_BRAND, sum: 20 };
    const stranger: PromoBasketLine = { id: other.id, kind: "product", brand: other.b, sum: 30 };
    const card: PromoBasketLine = { id: "gift:100", kind: "gift", brand: SCOPED_BRAND, sum: 100 };
    const set: PromoBasketLine = { id: "bundle:starter", kind: "bundle", brand: null, sum: 60 };

    expect(promoLineMatches("brand", SCOPED_BRAND, shampoo)).toBe(true);
    expect(promoLineMatches("brand", SCOPED_BRAND, stranger)).toBe(false);
    expect(promoLineMatches("product", mineA.id, shampoo)).toBe(true);
    expect(promoLineMatches("product", other.id, shampoo)).toBe(false);

    // the brand is folded for case and stray spaces, and for nothing else
    expect(promoLineMatches("brand", SCOPED_BRAND.toLowerCase() + "  ", shampoo)).toBe(true);
    expect(promoLineMatches("brand", SCOPED_BRAND.replace(/[aeiou]/i, "x"), shampoo)).toBe(false);

    /* A gift card is out of reach of every scope there is — including a
       product code that names the card's own line, which is the one way a
       scoped code could have walked around the rule createOrder() keeps for
       whole-basket ones (audit 14.09.2026). */
    expect(promoLineMatches("order", null, card)).toBe(false);
    expect(promoLineMatches("brand", SCOPED_BRAND, card)).toBe(false);
    expect(promoLineMatches("product", "gift:100", card)).toBe(false);

    // a set carries no brand of its own; it answers to its own id and nothing else
    expect(promoLineMatches("brand", SCOPED_BRAND, set)).toBe(false);
    expect(promoLineMatches("product", "bundle:starter", set)).toBe(true);
  });

  it("adds up only the matching lines", () => {
    const basket: PromoBasketLine[] = [
      { id: mineA.id, kind: "product", brand: SCOPED_BRAND, sum: 20 },
      { id: mineB.id, kind: "product", brand: SCOPED_BRAND, sum: 41 },
      { id: other.id, kind: "product", brand: other.b, sum: 79 },
    ];
    expect(promoBaseFor({ scope: "brand", scopeValue: SCOPED_BRAND }, basket)).toEqual({
      base: 61,
      lines: [mineA.id, mineB.id],
    });
    expect(promoBaseFor({ scope: "product", scopeValue: mineB.id }, basket)).toEqual({
      base: 41,
      lines: [mineB.id],
    });
    expect(promoBaseFor({ scope: "order", scopeValue: null }, basket).base).toBe(140);
  });

  /* ---------- the arithmetic ---------- */

  const basket: PromoBasketLine[] = [
    { id: mineA.id, kind: "product", brand: SCOPED_BRAND, sum: 20 },
    { id: mineB.id, kind: "product", brand: SCOPED_BRAND, sum: 40 },
    { id: other.id, kind: "product", brand: other.b, sum: 140 },
  ];
  const GOODS = 200;

  it("takes a percent off the matching lines and leaves the rest at full price", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const q = await quotePromo("brand10", GOODS, 3.49, basket);
    // 10 % of 60, not 10 % of 200 — the whole point
    expect(q).toMatchObject({ ok: true, discount: 6, base: 60, scope: "brand", scopeValue: SCOPED_BRAND });
    expect(q.lines).toEqual([mineA.id, mineB.id]);
  });

  it("takes a percent off one product only", async () => {
    await make({ code: "ONEPROD", kind: "percent", value: 25, scope: "product", scopeValue: mineB.id });
    expect(await quotePromo("ONEPROD", GOODS, 0, basket)).toMatchObject({
      ok: true, discount: 10, base: 40, scope: "product", scopeValue: mineB.id,
    });
  });

  /* Renat's own arithmetic, written down as a test: the whole reason he chose
     «только на подходящие строки» over the whole-basket readings. */
  it("cannot be turned into ten per cent off a 200 € order by adding one small bottle", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const one: PromoBasketLine[] = [
      { id: mineA.id, kind: "product", brand: SCOPED_BRAND, sum: 9 },
      { id: other.id, kind: "product", brand: other.b, sum: 191 },
    ];
    expect((await quotePromo("BRAND10", 200, 0, one)).discount).toBe(0.9);
  });

  /* ---------- the fixed-euro rule ---------- */

  it("caps a fixed-euro code at the matching lines' total", async () => {
    await make({ code: "MINUS20", kind: "fixed", value: 20, scope: "brand", scopeValue: SCOPED_BRAND });
    // 60 € of the brand in the basket: the whole 20 € comes off
    expect((await quotePromo("MINUS20", GOODS, 0, basket)).discount).toBe(20);
    // …and 12 € of it: 12 €, never 20. A fixed code that could spill past its
    // own subset would be a whole-basket code wearing a brand's name.
    const thin: PromoBasketLine[] = [
      { id: mineA.id, kind: "product", brand: SCOPED_BRAND, sum: 12 },
      { id: other.id, kind: "product", brand: other.b, sum: 188 },
    ];
    const q = await quotePromo("MINUS20", 200, 0, thin);
    expect(q).toMatchObject({ ok: true, discount: 12, base: 12 });
  });

  /* ---------- free delivery has no lines to apply to ---------- */

  it("refuses to scope a free-delivery code, in the validator and in the table", async () => {
    expect(validatePromo({ code: "SHIPX", kind: "free_shipping", scope: "brand", scopeValue: SCOPED_BRAND }))
      .toMatchObject({ ok: false, error: "scope_free_shipping" });
    expect(validatePromo({ code: "SHIPX", kind: "free_shipping", scope: "product", scopeValue: mineA.id }))
      .toMatchObject({ ok: false, error: "scope_free_shipping" });
    // …and a free-delivery code with no scope is exactly as fine as it ever was
    expect(validatePromo({ code: "SHIPX", kind: "free_shipping" })).toMatchObject({ ok: true });

    /* The validator is the door; the constraint is the wall. A row written
       straight into the table with both must be refused, so no hand-patched
       row can reach quoteFromPromo() in a state it has no arithmetic for. */
    await expect(
      exec(
        `insert into promo_codes (code, kind, value, scope, scope_value)
         values ('SHIPBRAND', 'free_shipping', 0, 'brand', '${SCOPED_BRAND.replace(/'/g, "''")}')`,
      ),
    ).rejects.toThrow();
    // …as is a scoped code with nothing to scope to
    await expect(
      exec("insert into promo_codes (code, kind, value, scope, scope_value) values ('EMPTY', 'percent', 10, 'brand', '  ')"),
    ).rejects.toThrow();
  });

  /* «Не сказано» is not «весь заказ». The assistant's create_promo builds its
     body from a whitelist with no scope in it (src/app/api/assistant/actions.ts
     sanitizePromo), so an edit through it — «продли SUVI10 до конца месяца» —
     would otherwise widen a Davines code to the whole shop, with nothing on the
     confirm card to say so. */
  it("leaves a code's scope alone when the edit never mentioned it", async () => {
    await make({ code: "KEEPSCOPE", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });

    const edit = validatePromo({ code: "KEEPSCOPE", kind: "percent", value: 15, minSubtotal: 0 });
    expect(edit.ok && edit.value.scope).toBeUndefined();
    await upsertPromo((edit as { ok: true; value: Parameters<typeof upsertPromo>[0] }).value);

    const after = (await getPromo("KEEPSCOPE"))!;
    expect(after.value).toBe(15);                          // the edit landed…
    expect(after).toMatchObject({ scope: "brand", scopeValue: SCOPED_BRAND });   // …and only the edit
    expect((await quotePromo("KEEPSCOPE", GOODS, 0, basket)).base).toBe(60);
  });

  it("starts a brand-new code on «весь заказ» when nothing said otherwise", async () => {
    const fresh = validatePromo({ code: "FRESH", kind: "percent", value: 10 });
    expect(fresh.ok).toBe(true);
    const saved = await upsertPromo((fresh as { ok: true; value: Parameters<typeof upsertPromo>[0] }).value);
    expect(saved).toMatchObject({ scope: "order", scopeValue: null });
  });

  /* A narrowed code turned into a free-delivery one has no arithmetic left for
     its brand, and the table's constraint would refuse the row — so the scope
     goes with the kind rather than the save failing with a 500. */
  it("drops the scope when a scoped code becomes a free-delivery one", async () => {
    await make({ code: "WASBRAND", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const turn = validatePromo({ code: "WASBRAND", kind: "free_shipping" });
    expect(turn).toMatchObject({ ok: true, value: { scope: "order", scopeValue: null } });
    const saved = await upsertPromo((turn as { ok: true; value: Parameters<typeof upsertPromo>[0] }).value);
    expect(saved).toMatchObject({ kind: "free_shipping", scope: "order", scopeValue: null });
  });

  it("keeps a free-delivery code paying for delivery and nothing else", async () => {
    await make({ code: "SHIP0", kind: "free_shipping" });
    const q = await quotePromo("SHIP0", GOODS, 3.49, basket);
    expect(q).toMatchObject({ ok: true, discount: 3.49, freeShipping: true, scope: "order" });
  });

  /* ---------- refusals a shopper has to be able to read ---------- */

  it("says no_match when the basket holds none of what the code is for", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const without: PromoBasketLine[] = [{ id: other.id, kind: "product", brand: other.b, sum: 140 }];
    expect(await quotePromo("BRAND10", 140, 0, without)).toMatchObject({
      ok: false, error: "no_match", scope: "brand", scopeValue: SCOPED_BRAND,
    });
  });

  it("refuses a scoped code rather than pricing it on the whole basket when the lines are missing", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    // the old three-argument call, from a caller that has no basket to give
    expect(await quotePromo("BRAND10", GOODS, 0)).toMatchObject({ ok: false, error: "no_match" });
  });

  it("measures «минимальный заказ» on the part the code applies to", async () => {
    await make({
      code: "BRAND40", kind: "percent", value: 10, minSubtotal: 40,
      scope: "brand", scopeValue: SCOPED_BRAND,
    });
    // 60 € of the brand clears a 40 € floor, whatever the rest of the basket is
    expect(await quotePromo("BRAND40", GOODS, 0, basket)).toMatchObject({ ok: true, discount: 6 });
    /* …and 200 € of somebody else's goods does not clear it. Reading the floor
       as the whole basket would sell exactly what the scope refuses: spend
       200 € on anything and the one cheap bottle goes cheaper. */
    const thin: PromoBasketLine[] = [
      { id: mineA.id, kind: "product", brand: SCOPED_BRAND, sum: 12 },
      { id: other.id, kind: "product", brand: other.b, sum: 188 },
    ];
    expect(await quotePromo("BRAND40", 200, 0, thin)).toMatchObject({
      ok: false, error: "min_subtotal", minSubtotal: 40, base: 12,
    });
  });

  /* ---------- codes that already exist ---------- */

  it("prices a code written before the scope existed exactly as it did", async () => {
    await make({ code: "TEN", kind: "percent", value: 10 });
    const before = await getPromo("TEN");
    expect(before).toMatchObject({ scope: "order", scopeValue: null });
    // …with and without a basket, and with the same answer as the row alone gives
    expect((await quotePromo("TEN", 40, 3.49)).discount).toBe(4);
    expect((await quotePromo("TEN", 40, 3.49, basket)).discount).toBe(4);

    // a row from a database that never ran 170 has no columns at all to read
    const legacy = { ...before!, scope: undefined, scopeValue: undefined } as Promo;
    expect(quoteFromPromo(legacy, 40, 3.49).discount).toBe(4);
  });

  /* ---------- the order that quotes one ---------- */

  it("prices a real order on the matching lines and records what it discounted", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: mineA.id, qty: 1 }, { id: other.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "brand10",
    });
    const mine = o.items.find((l) => l.id === mineA.id)!;
    expect(o.discount).toBeCloseTo(money(mine.sum * 0.1), 2);
    expect(o.discount).toBeLessThan(money(o.subtotal * 0.1));   // not the whole basket
    expect(o.total).toBeCloseTo(money(o.subtotal + o.shippingPrice - o.discount), 2);
    expect(o.discountScope).toMatchObject({
      kind: "brand", value: SCOPED_BRAND, base: money(mine.sum), lines: [mineA.id],
    });

    // and it is on the row, not only on the object the call handed back
    const [row] = await query<{ discount_scope: unknown }>(
      "select discount_scope from orders where id = $1", [o.id],
    );
    const stored = typeof row.discount_scope === "string"
      ? JSON.parse(row.discount_scope) : row.discount_scope;
    expect(stored).toMatchObject({ kind: "brand", value: SCOPED_BRAND });
  });

  it("charges full price when the basket has none of the brand, and records nothing", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: other.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "BRAND10",
    });
    expect(o.discount).toBe(0);
    expect(o.discountScope).toBe(null);
    expect(o.total).toBeCloseTo(money(o.subtotal + o.shippingPrice), 2);
  });

  it("leaves discount_scope null for a whole-basket code", async () => {
    await make({ code: "TEN", kind: "percent", value: 10 });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: mineA.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "TEN",
    });
    expect(o.discount).toBeGreaterThan(0);
    expect(o.discountScope).toBe(null);
  });

  /* ---------- the gift card the audit closed, and the scope reopening it ---------- */

  it("cannot discount a gift card's face value, however the code is scoped", async () => {
    /* A 100 € card and a 20 € bottle. Three codes that would each buy the card
       for ninety if the subset ever counted it: the whole-basket one the audit
       already fixed, a brand code (a card line carries no brand of its own —
       but the shop's own name is a brand in this catalogue), and a product
       code naming the card's line by id, which is the shape the scope made
       possible for the first time. */
    await make({ code: "ALL10", kind: "percent", value: 10 });
    await make({ code: "CARDBRAND", kind: "percent", value: 10, scope: "brand", scopeValue: "Rempire" });
    await make({ code: "CARDPROD", kind: "percent", value: 10, scope: "product", scopeValue: "gift:100" });

    const items = [{ id: "gift:100", qty: 1, meta: { name: "Kati", email: "kati@example.com" } }, { id: mineA.id, qty: 1 }];
    const bottle = inStock.find((p) => p.id === mineA.id)!;

    const whole = await createOrder({
      lang: "ru", items, customer,
      shipping: { method: "parcel", country: "EE" }, discountCode: "ALL10",
    });
    const goods = money(whole.items.filter((l) => l.kind !== "gift").reduce((s, l) => s + l.sum, 0));
    expect(whole.subtotal).toBeGreaterThan(100);       // the card is in the subtotal…
    expect(whole.discount).toBeCloseTo(money(goods * 0.1), 2);   // …and out of the discount
    expect(whole.discount).toBeLessThan(11);

    for (const code of ["CARDBRAND", "CARDPROD"]) {
      const o = await createOrder({
        lang: "ru", items, customer,
        shipping: { method: "parcel", country: "EE" }, discountCode: code,
      });
      /* CARDPROD matches nothing at all; CARDBRAND matches only a real Rempire
         product, which this basket has none of. Either way not one cent of the
         hundred euro is discounted. */
      expect(o.discount).toBe(0);
      expect(o.discountScope).toBe(null);
      expect(o.total).toBeCloseTo(money(o.subtotal + o.shippingPrice), 2);
    }
    expect(bottle.p).toBeGreaterThan(0);
  });

  /* ---------- what reads the discounted subtotal downstream ---------- */

  it("keeps points, the free-delivery floor and the invoice total agreeing after a partial discount", async () => {
    await make({ code: "BRAND10", kind: "percent", value: 10, scope: "brand", scopeValue: SCOPED_BRAND });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: mineA.id, qty: 1 }, { id: other.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "BRAND10",
    });

    /* 1. The free-delivery threshold reads the RETAIL goods subtotal, before
          any code touches it (createOrder hands shippingPrice() `subtotal`),
          so a partial discount cannot push a basket back over the floor or
          under it. Same rule as a whole-basket code has always had. */
    const { computeShipping } = await import("@/lib/shipping");
    const priced = await computeShipping({ country: "EE", method: "parcel", subtotal: o.subtotal });
    expect(o.shippingPrice).toBeCloseTo(typeof priced === "number" ? priced : priced.price, 2);

    /* 2. Points are earned on what was actually paid for goods —
          earnableSubtotal minus the discount (src/lib/payments/apply.ts
          earnBase). A smaller discount means a bigger base, which is right:
          the customer paid more. */
    const earnBase = money(earnableSubtotal(o) - o.discount - o.loyaltyDiscount);
    expect(earnBase).toBeCloseTo(money(o.subtotal - o.discount), 2);
    expect(earnBase).toBeGreaterThan(money(o.subtotal * 0.9));   // not a whole-basket 10 %

    /* 3. The invoice foots to the order's own total — the discount is one
          negative line, and the scope changes only how big it is. */
    const { invoiceLines } = await import("@/lib/invoices");
    const totals = invoiceLines(o, 24, "ru");
    expect(totals.total).toBeCloseTo(o.total, 2);
    const discountLines = totals.lines.filter((l) => l.kind === "discount");
    expect(discountLines).toHaveLength(1);
    expect(discountLines[0].gross).toBeCloseTo(-o.discount, 2);
  });
});
