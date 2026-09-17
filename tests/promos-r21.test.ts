/**
 * Round 21, the promo-code and gift-card findings that were real.
 *
 * Five defects, each with the one sentence that says what went wrong:
 *
 *   · a code that took NOTHING off an order still spent one of its uses when
 *     the order was paid — an expired «первым двадцати» burned on a customer
 *     who paid full price (src/lib/payments/apply.ts);
 *   · a salon sale with the cashier's percent on it wrote a
 *     `promo_consume_failed` audit row about «POS -15%», a label that was
 *     never a code (same file);
 *   · a code shaped like a gift card («RMP» plus eight) could be created,
 *     was listed as live, and answered «Карта не найдена» to every shopper
 *     who typed it, because both the browser and the checkout route by shape
 *     before they look anything up (src/lib/promos.ts validatePromo);
 *   · «Удалить» on a row reading «использован 0» came back «Код уже
 *     использован» — the code was sitting in an order nobody had paid for
 *     (src/lib/promos.ts deletePromo);
 *   · saving a code in the panel wiped its start date, so a code the
 *     assistant had made for December went live in September (the round trip
 *     public/shop2/app.js → validatePromo → upsertPromo).
 *
 * …plus the two screens that said something untrue: the checkout's «добавьте
 * ещё на 0,00 €» after the basket had grown, and «Выпущенные карты» showing a
 * cancelled card as an ordinary spent one with its PDF still on offer.
 *
 * Real Postgres (PGlite) for the server half. The browser half is **sliced out
 * of app.js by source text** and run against stubs — the technique
 * tests/admin-panel-truth.test.ts uses, so a renamed function fails loudly
 * instead of silently testing nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { exec, query } from "@/lib/db";
import { createOrder } from "@/lib/orders";
import { deletePromo, getPromo, upsertPromo, validatePromo } from "@/lib/promos";
import { applyPaymentResult, type ApplyDeps, type PaymentBlob } from "@/lib/payments/apply";
import type { VerifyResult } from "@/lib/payments/types";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const plain = CATALOGUE.find((p) => p.s === "in" && p.p > 0)!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

/** The two stubs every applyPaymentResult() here needs, plus a spy on the journal. */
function deps(over: Partial<ApplyDeps> = {}): ApplyDeps & { writeAudit: ReturnType<typeof vi.fn> } {
  const writeAudit = vi.fn(async () => ({}));
  return {
    setOrderPayment: vi.fn(async (_i: string, _p: PaymentBlob) => ({})),
    setOrderStatus: vi.fn(async () => ({})),
    writeAudit,
    ...over,
  } as ApplyDeps & { writeAudit: ReturnType<typeof vi.fn> };
}

const paidTicket = (number: string, amount: number): VerifyResult => ({
  orderRef: number,
  status: "paid",
  providerRef: `ref-${number}`,
  amount,
  currency: "EUR",
});

/* ========================================================================= */

describe("a promo code that took nothing off must not spend a use", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
    await exec("truncate orders restart identity cascade");
  });

  it("keeps the use when the code's quote failed and the customer paid full price", async () => {
    /* A floor nothing in this shop reaches: the order is charged in full and
       the code did nothing. Before this was fixed the paid transition counted
       a use all the same, so a «первым двадцати» code ran out on twenty
       customers who never got the discount. */
    await upsertPromo({
      code: "BIG40", kind: "percent", value: 10, minSubtotal: 10_000,
      startsAt: null, endsAt: null, maxUses: 20, active: true, note: null,
    });
    const order = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "BIG40",
    });
    expect(order.discount).toBe(0);            // the code took nothing off
    expect(order.discountCode).toBe("BIG40");  // …and the order still names it

    const d = deps();
    const out = await applyPaymentResult(order, paidTicket(order.number, order.total), "montonio", d);
    expect(out.status).toBe("paid");
    expect(out.giftShortfall).toBeUndefined();
    expect((await getPromo("BIG40"))!.used).toBe(0);
    // and nothing in the journal about it either — there was no failure
    expect(d.writeAudit).not.toHaveBeenCalled();
  });

  it("still spends free delivery on a basket that already ships free", async () => {
    /* The one code that honestly discounts nothing: «бесплатная доставка» on
       a pickup order where the parcel cost 0 € to begin with. The customer
       used the code, so the code is used. */
    await upsertPromo({
      code: "SHIP0", kind: "free_shipping", value: 0, minSubtotal: 0,
      startsAt: null, endsAt: null, maxUses: 5, active: true, note: null,
    });
    const order = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      // «Забрать в салоне» costs nothing, so there is nothing for the code to pay
      shipping: { method: "pickup", country: "EE" },
      discountCode: "SHIP0",
    });
    expect(order.shippingPrice).toBe(0);
    expect(order.discount).toBe(0);

    await applyPaymentResult(order, paidTicket(order.number, order.total), "montonio", deps());
    expect((await getPromo("SHIP0"))!.used).toBe(1);
  });

  it("says so in the journal when a code that DID discount cannot be counted", async () => {
    // the guard must not silence the shortfall the audit row exists for
    await upsertPromo({
      code: "GONE21", kind: "percent", value: 10, minSubtotal: 0,
      startsAt: null, endsAt: null, maxUses: 1, active: true, note: null,
    });
    await query("update promo_codes set used = 1 where code = 'GONE21'");
    const d = deps();
    const out = await applyPaymentResult(
      { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", number: "R-210001", status: "new", total: 36, discount: 4, discountCode: "GONE21" },
      paidTicket("R-210001", 36),
      "montonio",
      d,
    );
    expect(out.giftShortfall).toMatchObject({ code: "GONE21", error: "used_up" });
    expect(d.writeAudit).toHaveBeenCalledWith("system", "promo_consume_failed", expect.objectContaining({ code: "GONE21" }));
  });

  it("leaves a salon sale's «POS -15%» alone — it is a label, not a code", async () => {
    /* createOrder folds the cashier's percent into `discount_code` so the
       order card and the receipt show it. Sent down the promo branch it
       normalises to nothing (the «%» is not a code character) and every
       discounted sale wrote a `promo_consume_failed` row about a code nobody
       had typed. */
    const d = deps();
    const out = await applyPaymentResult(
      {
        id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", number: "R-210002", status: "new",
        total: 45, discount: 5, discountCode: "POS -10%", channel: "pos",
      },
      paidTicket("R-210002", 45),
      "pos",
      d,
    );
    expect(out.status).toBe("paid");
    expect(out.giftShortfall).toBeUndefined();
    expect(d.writeAudit).not.toHaveBeenCalled();
  });
});

/* ========================================================================= */

describe("a promo code cannot be shaped like a gift card", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);

  it("refuses RMP plus eight, in any spelling the owner might type", () => {
    for (const code of ["RMP12345678", "rmp-1234-5678", "RMP-ABCD-EFGH"]) {
      const out = validatePromo({ code, kind: "percent", value: 10, minSubtotal: 0, endsAt: null, maxUses: null, note: null });
      expect(out, code).toEqual({ ok: false, error: "gift_shape" });
    }
  });

  it("still takes every code that is not one", () => {
    for (const code of ["RMP10", "RMP-1234-567", "REM-BD-7QK4X9", "SUVI10", "RMPIRE-SUMMER"]) {
      const out = validatePromo({ code, kind: "percent", value: 10, minSubtotal: 0, endsAt: null, maxUses: null, note: null });
      expect(out.ok, code).toBe(true);
    }
  });
});

/* ========================================================================= */

describe("«Удалить» says which code it is refusing", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
    await exec("truncate orders restart identity cascade");
  });

  it("answers on_order for a code sitting in an order nobody paid for", async () => {
    /* The shopper applied the code and walked away from the bank's page. The
       counter reads 0 — «использован 0» on the row, «Удалить» on offer — and
       the panel used to be told `in_use` and say «Код уже использован». */
    await upsertPromo({
      code: "ABANDON", kind: "percent", value: 10, minSubtotal: 0,
      startsAt: null, endsAt: null, maxUses: null, active: true, note: null,
    });
    const order = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "abandon",
    });
    expect(order.status).toBe("new");
    expect((await getPromo("ABANDON"))!.used).toBe(0);

    expect(await deletePromo("ABANDON")).toEqual({ ok: false, error: "on_order" });
    expect(await getPromo("ABANDON")).not.toBe(null);
  });

  it("still answers in_use for a code somebody has paid with", async () => {
    await upsertPromo({
      code: "SPENT21", kind: "percent", value: 10, minSubtotal: 0,
      startsAt: null, endsAt: null, maxUses: null, active: true, note: null,
    });
    await query("update promo_codes set used = 1 where code = 'SPENT21'");
    expect(await deletePromo("SPENT21")).toEqual({ ok: false, error: "in_use" });
  });
});

/* ========================================================================= */
/* ---------- the panel, sliced out of app.js ------------------------------ */

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

/** Build a callable from one or more sliced functions plus named stubs. */
function build<T>(names: string[], scope: Record<string, unknown>, expr = names[0]): T {
  const keys = Object.keys(scope);
  const body = names.map(slice).join("\n") + `\nreturn ${expr};`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}

describe("the start date survives a save in the panel", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
  });

  it("carries startsAt from the row it loaded into the body it posts", async () => {
    /* The whole round trip, across the boundary the bug lived on: a code the
       assistant made with a start date, opened in «Изменить промокод», saved
       with nothing changed. The body is the whole code as far as the server
       is concerned, so a key the form did not send was stored as null. */
    const made = await upsertPromo({
      code: "DECEMBER", kind: "percent", value: 15, minSubtotal: 0,
      startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z",
      maxUses: null, active: true, note: null,
    });
    expect(made.startsAt).toBe("2026-12-01T00:00:00.000Z");

    const S: Record<string, unknown> = {};
    const form = build<(p: unknown) => Record<string, unknown>>(["promoFormFrom"], { S })(made);
    S.promoForm = form;
    const body = build<() => Record<string, unknown>>(["promoFormPayload"], { S })();

    expect(body.startsAt).toBe("2026-12-01T00:00:00.000Z");

    const check = validatePromo(body);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const saved = await upsertPromo(check.value);
    expect(saved.startsAt).toBe("2026-12-01T00:00:00.000Z");
    expect(saved.value).toBe(15);
  });

  it("sends no start date for a brand-new code", () => {
    const S: Record<string, unknown> = {};
    const blank = build<() => Record<string, unknown>>(["blankPromo"], { S })();
    S.promoForm = { ...blank, code: "SUVI10" };
    const body = build<() => Record<string, unknown>>(["promoFormPayload"], { S })();
    expect(body.startsAt).toBe(null);
  });
});

describe("«добавьте ещё на 0,00 €»", () => {
  type State = { promoErr: string; promoMin: number; promoErrScope: string; promoErrValue: string; lang: string };
  /** promoErrText() over a basket worth `have` euro of goods. */
  function textFor(S: State, have: number): string {
    return build<() => string>(["promoErrText"], {
      S,
      PROMO_ERRS: { min_subtotal: "Код действует не на эту корзину.", unavailable: "Сейчас не получилось проверить код." },
      promoScopeName: () => "",
      promoBase: () => have,
      promoGoods: () => have,
      eur: (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €",
    })();
  }
  const under: State = { promoErr: "min_subtotal", promoMin: 40, promoErrScope: "", promoErrValue: "", lang: "RU" };

  it("says what is missing while something is missing", () => {
    expect(textFor(under, 28)).toBe("Код действует от 40 € — добавьте ещё на 12 €.");
  });

  it("says nothing once the basket has grown past the floor", () => {
    /* The refusal is from whenever «Применить» was last pressed; the shortfall
       is counted against the basket as it is now. Do as you are told and the
       same line read «добавьте ещё на 0,00 €» and stayed there — nothing but
       typing in the box, «убрать» or a finished order ever cleared it. */
    expect(textFor(under, 40)).toBe("");
    expect(textFor(under, 55)).toBe("");
  });

  it("draws no error box at all when there is nothing to say", () => {
    const html = (S: State, have: number) =>
      build<() => string>(["promoErrHTML", "promoErrText"], {
        S,
        PROMO_ERRS: { min_subtotal: "x", unavailable: "x" },
        promoScopeName: () => "",
        promoBase: () => have,
        promoGoods: () => have,
        eur: (n: number) => String(n),
        esc: (s: string) => String(s),
      })();
    expect(html(under, 28)).toContain('role="alert"');
    expect(html(under, 55)).toBe("");
    // a refusal that is not about the basket's size is untouched
    expect(html({ ...under, promoErr: "expired" }, 55)).toContain('role="alert"');
  });
});

describe("«Выпущенные карты» and a cancelled card", () => {
  const card = {
    code: "RMP-ACDE-4679",
    amount: 100,
    balance: 0,
    recipient: { name: "Мария" },
    createdAt: "2026-09-01T10:00:00.000Z",
    validUntil: "2027-09-01",
    pdfUrl: "/api/giftcards/RMP-ACDE-4679/pdf/",
  };
  const row = (over: Record<string, unknown>) =>
    build<(c: unknown) => string>(["admGiftRowHTML", "esc"], {
      S: { lang: "RU" },
      eur: (n: number) => String(n) + " €",
      shortDate: () => "01.09.2026",
    })({ ...card, ...over });

  it("badges a card the refund cancelled, and takes its PDF away", () => {
    /* voidGiftCards() leaves balance 0 and `voided_at` stamped. This list read
       only the balance, so the card stood here as an ordinary spent one and
       still offered a PDF saying «на карте 100 €» about money the shop had
       already handed back. */
    const html = row({ voidedAt: "2026-09-15T12:00:00.000Z" });
    expect(html).toContain("Аннулирована");
    expect(html).toContain('data-giftvoid="RMP-ACDE-4679"');
    expect(html).not.toContain("data-giftpdf");
  });

  it("leaves an ordinary spent card exactly as it was", () => {
    const html = row({ voidedAt: null });
    expect(html).not.toContain("Аннулирована");
    expect(html).toContain('data-giftpdf="RMP-ACDE-4679"');
  });
});

describe("the panel's «Удалить» refusal", () => {
  const ON_ORDER = "Код есть в незавершённом заказе — его можно только выключить";
  const IN_USE = "Код уже использован — его можно только выключить";

  it("has a sentence of its own for a code on an unfinished order", () => {
    /* Both branches are whole sentences — a glued «… — его можно только
       выключить» tail would be its own text node and stay Russian in the
       middle of an English panel (tools/i18n-gaps.mjs, ASSEMBLED). */
    const fn = slice("deletePromoByCode");
    expect(fn).toContain('"on_order"');
    expect(fn).toContain(ON_ORDER);
    expect(fn).toContain(IN_USE);
  });

  it("is in the dictionary in both other languages, and so is the gift-shape refusal", () => {
    /* Bounded exactly as tools/i18n-gaps.mjs bounds them — `var UI = {` to
       `var UI_RX = [`, split at `EN: {`. A sentence that reaches only the
       Estonian side is `untranslated` in English and the shop shows it in
       Russian to an English shopper. */
    const dict = src.slice(src.indexOf("var UI = {"), src.indexOf("var UI_RX = ["));
    const enAt = dict.indexOf("EN: {");
    expect(dict.indexOf("ET: {")).toBeGreaterThanOrEqual(0);
    expect(enAt).toBeGreaterThan(0);
    const et = dict.slice(dict.indexOf("ET: {"), enAt);
    const en = dict.slice(enAt);
    const shape = "Такой код похож на подарочную карту — придумайте другой.";
    for (const key of [ON_ORDER, IN_USE, shape]) {
      expect(et, key).toContain(key);
      expect(en, key).toContain(key);
    }
    // …and the panel actually reaches for it, under the error the server sends
    expect(src).toContain("gift_shape: " + JSON.stringify(shape));
  });
});
