/**
 * The gift card's recipient, all the way from the cart line to the issued card.
 *
 * The audit row this covers: `orderPayload()` in public/shop2/app.js used to
 * map only {id, variant, qty}, so the {name, email, message} the shopper typed
 * on /shop2/gift/ never left the browser — every card was e-mailed to the buyer
 * and the personal message was lost, while `giftMeta()` on the server sat
 * waiting for it. The browser half is a one-line change in app.js; this pins
 * down the server half so it cannot rot back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import { issueGiftCards } from "@/lib/giftcards";
import { createOrder, getOrder } from "@/lib/orders";
import { setupDb, teardownDb } from "./helpers";

const customer = { name: "Renat Ostrovski", email: "buyer@example.com", phone: "+372 5555 5555" };

const recipient = {
  name: "Мария Тамм",
  email: "maria@example.com",
  message: "С днём рождения!",
};

describe("gift-card recipient passthrough", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("020_gift_cards.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate gift_card_uses, gift_cards restart identity cascade");
    await exec("truncate orders restart identity cascade");
  });

  it("stores the recipient on the order line", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{ id: "gift:50", qty: 1, meta: recipient }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    const line = o.items.find((l) => l.kind === "gift")!;
    expect(line.meta).toMatchObject(recipient);
    // gift cards ship nothing
    expect(o.shippingPrice).toBe(0);
    expect(o.total).toBe(50);

    // and it survives the round trip through jsonb
    const back = await getOrder(o.id);
    expect(back!.items[0].meta).toMatchObject(recipient);
  });

  it("keeps only the four recipient fields, trimmed and capped", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{
        id: "gift:25",
        qty: 1,
        meta: {
          name: "  Мария  ",
          email: "maria@example.com",
          message: "x".repeat(400),
          from: "Ренат",
          // a client that sends extra keys must not get them stored
          balance: 999,
          admin: true,
        },
      }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    const meta = o.items[0].meta as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["email", "from", "message", "name"]);
    expect(meta.name).toBe("Мария");
    expect(String(meta.message)).toHaveLength(300);
  });

  it("issues the card to the recipient, not to the buyer", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{ id: "gift:50", qty: 1, meta: { ...recipient, from: "Ренат" } }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    const cards = await issueGiftCards(o);
    expect(cards).toHaveLength(1);
    expect(cards[0].recipient).toMatchObject({
      name: "Мария Тамм",
      email: "maria@example.com",
      message: "С днём рождения!",
      from: "Ренат",
    });
    // the card's e-mail goes to the recipient's address — the whole point of
    // «подарите сразу получателю»
    expect(cards[0].recipient.email).not.toBe(customer.email);
  });

  it("falls back to the buyer's name for «from» when the form left it blank", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{ id: "gift:25", qty: 1, meta: recipient }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    const cards = await issueGiftCards(o);
    expect(cards[0].recipient.from).toBe(customer.name);
  });

  it("gives every card on a multi-quantity line the same recipient", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{ id: "gift:25", qty: 3, meta: recipient }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    const cards = await issueGiftCards(o);
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c.recipient.email).toBe(recipient.email);
    const rows = await query<{ n: string }>("select count(*)::text as n from gift_cards");
    expect(rows[0].n).toBe("3");
  });

  it("carries two cards for two different people separately", async () => {
    const other = { name: "Jaan", email: "jaan@example.com", message: "Palju õnne!" };
    const o = await createOrder({
      lang: "ru",
      items: [
        { id: "gift:25", qty: 1, meta: recipient },
        { id: "gift:50", qty: 1, meta: other },
      ],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    const cards = await issueGiftCards(o);
    const byAmount = Object.fromEntries(cards.map((c) => [c.amount, c.recipient.email]));
    expect(byAmount[25]).toBe(recipient.email);
    expect(byAmount[50]).toBe(other.email);
  });

  it("still issues a card when the line carries no recipient at all", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{ id: "gift:100", qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    expect(o.items[0].meta ?? null).toBe(null);
    const cards = await issueGiftCards(o);
    expect(cards).toHaveLength(1);
    expect(cards[0].recipient.email).toBeUndefined();   // mail-hooks falls back to the buyer
    expect(cards[0].recipient.from).toBe(customer.name);
  });
});
