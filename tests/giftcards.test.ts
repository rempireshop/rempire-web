import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import {
  applyGiftCard,
  checkGiftCard,
  cleanGiftAmounts,
  generateCode,
  getGiftCard,
  GIFT_AMOUNTS,
  GIFT_AMOUNTS_DEFAULT,
  issueGiftCards,
  listGiftCards,
  normaliseCode,
  parseGiftItemId,
  redeemGiftCard,
} from "@/lib/giftcards";
import { setupDb, teardownDb } from "./helpers";

describe("gift cards", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("020_gift_cards.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate gift_card_uses, gift_cards restart identity cascade");
  });

  /* ---------- codes ---------- */

  it("makes RMP-XXXX-XXXX codes from an unambiguous alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      expect(code).toMatch(/^RMP-[ACDEFGHJKMNPQRTUVWXY34679]{4}-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/);
      // the pairs people confuse must never appear
      expect(code.slice(4)).not.toMatch(/[OIL01258BSZ]/);
      seen.add(code);
    }
    expect(seen.size).toBe(500); // no collisions in 500 draws
  });

  it("accepts a code typed loosely and refuses a wrong one", () => {
    const code = "RMP-ACDE-4679";
    expect(normaliseCode("rmp acde 4679")).toBe(code);
    expect(normaliseCode("ACDE4679")).toBe(code);
    expect(normaliseCode("  RMP-acde-4679  ")).toBe(code);
    // a character outside the alphabet is an invalid code, never "corrected"
    expect(normaliseCode("RMP-ACDE-4670")).toBe("");
    expect(normaliseCode("RMP-ACDE-467")).toBe("");
    expect(normaliseCode("")).toBe("");
  });

  it("reads the cart line id", () => {
    expect(parseGiftItemId("gift:50")).toBe(50);
    expect(parseGiftItemId("gift:25")).toBe(25);
    expect(parseGiftItemId("gift:33")).toBe(null);   // not an amount we sell
    expect(parseGiftItemId("bundle:beard-start")).toBe(null);
    expect(GIFT_AMOUNTS).toEqual([25, 50, 75, 100]);
  });

  /* ---------- which denominations are on sale (settings.gift_amounts) ------
     The panel writes this from «Маркетинг → Подарочные карты»; the /gift/ page
     draws a button per value. What must hold is that the setting can never put
     an amount on the page that parseGiftItemId would then refuse at checkout,
     and can never leave the page with no button at all. */

  it("cleans the denominations setting down to amounts the checkout accepts", () => {
    expect(cleanGiftAmounts([25, 100])).toEqual([25, 100]);
    expect(cleanGiftAmounts([100, 25, 75])).toEqual([25, 75, 100]);     // sorted
    expect(cleanGiftAmounts([50, 50, 50])).toEqual([50]);               // de-duplicated
    expect(cleanGiftAmounts(["25", "100"])).toEqual([25, 100]);         // strings from jsonb
    expect(cleanGiftAmounts([25, 33, 1e9, -50])).toEqual([25]);         // unknown values dropped
    for (const amount of cleanGiftAmounts([25, 50, 75, 100])) {
      expect(parseGiftItemId(`gift:${amount}`)).toBe(amount);
    }
  });

  it("never leaves the gift page without a button", () => {
    for (const junk of [null, undefined, [], {}, "25,50", [33, 99], [{}, "x"]]) {
      expect(cleanGiftAmounts(junk)).toEqual(GIFT_AMOUNTS_DEFAULT);
    }
  });

  /* ---------- issuing ---------- */

  it("issues one card per gift line, with the recipient attached", async () => {
    const orderId = randomUUID();
    const cards = await issueGiftCards({
      id: orderId,
      lang: "ET",
      name: "Renat",
      items: [
        { id: "kevin-murphy-young-again-wash", qty: 2 },
        { id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com", message: "Palju õnne!" } },
        { id: "gift:25", qty: 2 },
      ],
    });

    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.amount).sort((a, b) => a - b)).toEqual([25, 25, 50]);
    for (const c of cards) {
      expect(c.balance).toBe(c.amount);
      expect(c.orderId).toBe(orderId);
      expect(c.lang).toBe("ET");
      expect(c.redeemedAt).toBe(null);
    }
    const fifty = cards.find((c) => c.amount === 50)!;
    expect(fifty.recipient.name).toBe("Mari");
    expect(fifty.recipient.email).toBe("mari@example.com");
    expect(fifty.recipient.message).toBe("Palju õnne!");
    // no recipient given → the buyer's own name is kept as the sender
    expect(cards.find((c) => c.amount === 25)!.recipient.from).toBe("Renat");
  });

  /* The admin panel's «Выпущенные карты» list (GET /api/admin/giftcards):
     newest first, and the unspent total it prints has to be the money still
     owed, not the money once taken. */
  it("lists every issued card, newest first", async () => {
    const older = randomUUID(), newer = randomUUID();
    await issueGiftCards({ id: older, items: [{ id: "gift:25", qty: 1 }] });
    await query("update gift_cards set created_at = now() - interval '2 days' where order_id = $1", [older]);
    await issueGiftCards({ id: newer, items: [{ id: "gift:100", qty: 1 }] });

    const cards = await listGiftCards();
    expect(cards.map((c) => c.amount)).toEqual([100, 25]);
    expect(cards.reduce((sum, c) => sum + c.balance, 0)).toBe(125);

    await redeemGiftCard(cards[0].code, 40, newer);
    const after = await listGiftCards();
    expect(after.reduce((sum, c) => sum + c.balance, 0)).toBe(85);
  });

  it("is idempotent — a second onOrderPaid does not double-issue", async () => {
    const orderId = randomUUID();
    const first = await issueGiftCards({ id: orderId, items: [{ id: "gift:100", qty: 1 }] });
    const second = await issueGiftCards({ id: orderId, items: [{ id: "gift:100", qty: 1 }] });
    expect(first).toHaveLength(1);
    expect(second.map((c) => c.code)).toEqual(first.map((c) => c.code));
    const rows = await query<{ n: string }>("select count(*) as n from gift_cards");
    expect(Number(rows[0].n)).toBe(1);
  });

  it("issues nothing for an order without a gift line", async () => {
    const cards = await issueGiftCards({ id: randomUUID(), items: [{ id: "handmade-soap-666", qty: 1 }] });
    expect(cards).toEqual([]);
  });

  /* ---------- checking ---------- */

  it("reports balance for a real code and stays quiet about a wrong one", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:50", qty: 1 }] });

    await expect(checkGiftCard(card.code)).resolves.toEqual({
      ok: true, code: card.code, balance: 50, amount: 50,
    });
    await expect(checkGiftCard("RMP-ACDE-4679")).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(checkGiftCard("nonsense")).resolves.toMatchObject({ ok: false, error: "bad_code" });
  });

  /* ---------- applying (read-only) ---------- */

  it("applies at most the order total and leaves the card untouched", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:50", qty: 1 }] });

    const small = await applyGiftCard(card.code, 20);
    expect(small).toMatchObject({ ok: true, discount: 20, remaining: 30 });

    const big = await applyGiftCard(card.code, 120);
    expect(big).toMatchObject({ ok: true, discount: 50, remaining: 0 });

    // nothing was spent — apply() only quotes
    expect((await getGiftCard(card.code))!.balance).toBe(50);
  });

  it("refuses to apply an unknown or empty card", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:25", qty: 1 }] });
    await redeemGiftCard(card.code, 25, randomUUID());

    expect(await applyGiftCard(card.code, 10)).toMatchObject({ ok: false, error: "empty", discount: 0 });
    expect(await applyGiftCard("RMP-ACDE-4679", 10)).toMatchObject({ ok: false, error: "not_found" });
    expect(await applyGiftCard("oops", 10)).toMatchObject({ ok: false, error: "bad_code" });
  });

  /* ---------- redeeming ---------- */

  it("spends a card across several orders and logs every use", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:100", qty: 1 }] });
    const orderA = randomUUID();
    const orderB = randomUUID();

    expect(await redeemGiftCard(card.code, 40, orderA)).toMatchObject({ ok: true, taken: 40, remaining: 60 });
    expect(await redeemGiftCard(card.code, 60, orderB)).toMatchObject({ ok: true, taken: 60, remaining: 0 });

    const after = (await getGiftCard(card.code))!;
    expect(after.balance).toBe(0);
    expect(after.redeemedAt).not.toBe(null);

    const uses = await query<{ order_id: string; amount: string }>(
      "select order_id, amount from gift_card_uses where code = $1 order by created_at",
      [card.code],
    );
    expect(uses.map((u) => Number(u.amount))).toEqual([40, 60]);
    expect(uses.map((u) => u.order_id)).toEqual([orderA, orderB]);
  });

  it("never lets a card go negative", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:25", qty: 1 }] });

    const tooMuch = await redeemGiftCard(card.code, 30, randomUUID());
    expect(tooMuch).toMatchObject({ ok: false, error: "insufficient", taken: 0, remaining: 25 });
    expect((await getGiftCard(card.code))!.balance).toBe(25);

    expect(await redeemGiftCard(card.code, 0, null)).toMatchObject({ ok: false, error: "bad_amount" });
    expect(await redeemGiftCard(card.code, -5, null)).toMatchObject({ ok: false, error: "bad_amount" });
    expect(await redeemGiftCard("RMP-ACDE-4679", 5, null)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("only one of two simultaneous redemptions of the same money wins", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:25", qty: 1 }] });
    const [a, b] = await Promise.all([
      redeemGiftCard(card.code, 20, randomUUID()),
      redeemGiftCard(card.code, 20, randomUUID()),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await getGiftCard(card.code))!.balance).toBe(5);
  });
});
