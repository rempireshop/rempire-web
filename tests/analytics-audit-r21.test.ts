/**
 * Two things «Аналитика» said that were not so (r21 audit, medium):
 *
 *   · «Брошенные корзины» counted every basket saved inside the window,
 *     including the one a shopper had put something in a minute ago, and called
 *     it «Человек оставил почту и собрал корзину, но заказ так и не оформил.»
 *     The reminder letter waits three hours before it calls a cart abandoned;
 *     the figure beside it did not wait at all.
 *
 *   · «Путь до покупки» led with «Числа всегда убывают», which the query cannot
 *     promise: the five stages are five independent count(distinct sid) filters
 *     over different event types, and a shopper who adds to the basket from a
 *     catalogue card without opening the product page makes «в корзину» larger
 *     than «карточка товара».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAnalyticsSummary } from "@/lib/analytics";
import { ABANDONED_AFTER_MS } from "@/lib/flows";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00Z");
const MINUTE = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function cart(email: string, updatedAt: Date, recoveredAt: Date | null = null) {
  await query(
    "insert into carts (email, items, total, updated_at, recovered_at) values ($1, '[]'::jsonb, 30, $2, $3)",
    [email, updatedAt.toISOString(), recoveredAt ? recoveredAt.toISOString() : null],
  );
}

async function event(at: Date, sid: string, type: string) {
  await query("insert into events (at, sid, type) values ($1, $2, $3)", [at.toISOString(), sid, type]);
}

describe("«Брошенные корзины» waits as long as the letter does", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate events, carts restart identity cascade");
  });

  it("does not count a basket somebody is still filling", async () => {
    await cart("busy@example.com", ago(MINUTE)); // put something in a minute ago
    await cart("gone@example.com", ago(5 * 60 * MINUTE)); // five hours ago, nothing since
    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.abandonedCarts, "only the one that was really left behind").toBe(1);
  });

  it("uses the reminder letter's own three hours, to the minute", async () => {
    await cart("young@example.com", ago(ABANDONED_AFTER_MS - MINUTE));
    expect((await getAnalyticsSummary("7d", NOW)).abandonedCarts).toBe(0);

    await exec("truncate carts restart identity cascade");
    await cart("old@example.com", ago(ABANDONED_AFTER_MS + MINUTE));
    expect((await getAnalyticsSummary("7d", NOW)).abandonedCarts).toBe(1);
  });

  it("still leaves out a cart that became an order", async () => {
    await cart("bought@example.com", ago(5 * 60 * MINUTE), ago(4 * 60 * MINUTE));
    expect((await getAnalyticsSummary("7d", NOW)).abandonedCarts).toBe(0);
  });
});

describe("«Путь до покупки» and what the screen promises about it", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate events, carts restart identity cascade");
  });

  it("can hand the panel a step that is bigger than the one before it", async () => {
    // one visitor who put a product in the basket straight from a catalogue card
    await event(ago(60 * MINUTE), "sid-catalogue", "view");
    await event(ago(59 * MINUTE), "sid-catalogue", "add_to_cart");

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.funnel.sessions).toBe(1);
    expect(a.funnel.product).toBe(0);
    expect(a.funnel.addToCart, "the stages are five independent counts, not a funnel").toBe(1);
    expect(a.funnel.addToCart).toBeGreaterThan(a.funnel.product);
  });

  it("no longer tells the owner the numbers always fall", () => {
    const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
    expect(app.includes("Числа всегда убывают"), "the query cannot keep that promise").toBe(false);
    // …and it still explains the one case that breaks the shape
    expect(app).toContain("шаг можно и перескочить");
  });
});
