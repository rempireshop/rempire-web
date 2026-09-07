/**
 * The server halves of the eleven decisions Dim answered on 07.09.2026
 * (docs/audit/2026-09-07-storefront.md). The browser halves are in
 * e2e/storefront-sweep-2.spec.ts; these are the ones with no screen:
 *
 *   · which /shop2/ addresses answer 404 and which still answer the shell,
 *     and what the 404 page carries;
 *   · a gift-card denomination the owner switched off is refused at the till,
 *     not merely hidden in the window;
 *   · the newsletter tick at the checkout lands on customers.marketing, for a
 *     guest who has never signed in as well;
 *   · the printable gift card travels with the customer's order list;
 *   · the Estonian blog label the request-time pages carry.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import { getCustomer, listCustomerOrders, recordMarketingConsent, updateCustomer } from "@/lib/customers";
import { cleanGiftAmounts, giftAmountsOnSale } from "@/lib/giftcards";
import { giftPdfToken } from "@/lib/giftcard-pdf";
import { isKnownShopPath, notFoundPageResponse, shopPath } from "@/lib/notfound-page";
import { createOrder, OrderError, setSetting } from "@/lib/orders";
import { T } from "@/lib/seo-head.mjs";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

describe("404 — the address the shop has no page for", () => {
  it("reads the language prefix off the path and leaves the rest alone", () => {
    expect(shopPath("/shop2/")).toEqual({ seg: "", segs: [] });
    expect(shopPath("/shop2/et/")).toEqual({ seg: "et", segs: [] });
    expect(shopPath("/shop2/en/c/hair/")).toEqual({ seg: "en", segs: ["c", "hair"] });
    // /shop2/ru/… is 301'd by next.config.ts, but a hand-typed one still parses
    expect(shopPath("/shop2/ru/gift/")).toEqual({ seg: "", segs: ["gift"] });
    expect(shopPath("/anything-else/")).toBeNull();
    // a mangled percent-encoding is text, never a throw (safeDecode in app.js)
    expect(shopPath("/shop2/p/%E0/")?.segs).toHaveLength(2);
  });

  it("keeps every screen the shop really has, and only those", () => {
    // the six that live only in the browser, plus the owner's two
    for (const s of ["search", "brands", "account", "checkout", "done", "admin", "scan"]) {
      expect(isKnownShopPath([s]), s).toBe(true);
    }
    // the single prerendered pages
    for (const s of ["sets", "gift", "blog"]) expect(isKnownShopPath([s]), s).toBe(true);
    // shapes whose id lives in the database — accepted, and answered by their
    // own route (a post published an hour ago must not 404 here)
    expect(isKnownShopPath(["p", "c-whatever"])).toBe(true);
    expect(isKnownShopPath(["set", "beard-start"])).toBe(true);
    expect(isKnownShopPath(["blog", "some-slug"])).toBe(true);
    // closed sets, known at build time: checked
    expect(isKnownShopPath(["c", "all"])).toBe(true);
    expect(isKnownShopPath(["c", "hair"])).toBe(true);
    expect(isKnownShopPath(["c", "not-a-section"])).toBe(false);
    expect(isKnownShopPath(["b", "davines"])).toBe(true);
    expect(isKnownShopPath(["b", "not-a-brand"])).toBe(false);
    // and everything else
    expect(isKnownShopPath(["wat"])).toBe(false);
    expect(isKnownShopPath(["cart"])).toBe(false);
    expect(isKnownShopPath(["c", "hair", "extra"])).toBe(false);
  });

  it("answers 404 with the shop's own page, noindex, in the path's language", async () => {
    const res = await notFoundPageResponse("/shop2/et/no-such-page/");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<html lang="et"');
    expect(html).toContain("<title>Lehte ei leitud — REMPIRE</title>");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    /* The canonical is this address, not the home page's — a soft 404 used to
       tell Google that /shop2/anything/ WAS /shop2/. */
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/shop2\/et\/no-such-page\/"/);
    // …and a way out, in the page's own language
    expect(html).toContain('href="/shop2/et/c/all/"');
  });

  it("hands the plain shell, at 200, to a screen that only lives in the browser", async () => {
    /* Untouched, not merely 200: the shell is whatever the prerender wrote
       (its robots meta follows PUBLIC_BASE_URL, so THAT proves nothing here)
       — what matters is that no 404 page was built over it. */
    const shell = await (await notFoundPageResponse("/shop2/definitely-not-a-page/does-not-matter/extra/")).text();
    expect(shell).toContain("Страница не найдена");   // the sanity check for the check below
    for (const path of ["/shop2/search/", "/shop2/en/account/", "/shop2/brands/"]) {
      const res = await notFoundPageResponse(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html, path).not.toContain("Страница не найдена");
      expect(html, path).not.toContain("Lehte ei leitud");
      expect(html, path).not.toContain("Page not found");
    }
  });
});

describe("gift cards — the denominations on sale", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate settings, gift_card_uses, gift_cards, orders restart identity cascade");
  });

  it("falls back to the three the shop has always sold", async () => {
    expect(await giftAmountsOnSale()).toEqual([25, 50, 100]);
    expect(cleanGiftAmounts(["50", 75, 999, null])).toEqual([50, 75]);
  });

  it("reads the owner's own switches", async () => {
    await setSetting("gift_amounts", [100, 25]);
    expect(await giftAmountsOnSale()).toEqual([25, 100]);
  });

  /* The window and the till are one list now. Before 07.09.2026 the checkout
     validated against the four the module allows, so a card the owner had
     switched off went through if it was already in a basket — or if the item
     id was posted by hand. */
  it("refuses a denomination the owner switched off", async () => {
    await setSetting("gift_amounts", [25, 50]);
    const body = {
      lang: "ru",
      items: [{ id: "gift:75", qty: 1 }],
      customer: { name: "Mari", email: "mari@example.com", phone: "+372 5555 5555" },
      shipping: { method: "digital", country: "EE" },
    } as Parameters<typeof createOrder>[0];
    await expect(createOrder(body)).rejects.toThrow(OrderError);
    await expect(createOrder(body)).rejects.toMatchObject({ code: "gift_unavailable" });

    // …and one that IS on sale still sells
    const ok = await createOrder({ ...body, items: [{ id: "gift:50", qty: 1 }] });
    expect(ok.total).toBe(50);
  });

  it("sells all three defaults when the owner has set nothing", async () => {
    for (const amount of [25, 50, 100]) {
      const o = await createOrder({
        lang: "ru",
        items: [{ id: `gift:${amount}`, qty: 1 }],
        customer: { name: "Mari", email: `m${amount}@example.com`, phone: "+372 5555 5555" },
        shipping: { method: "digital", country: "EE" },
      } as Parameters<typeof createOrder>[0]);
      expect(o.total).toBe(amount);
    }
  });
});

describe("the newsletter tick at the checkout", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate customers restart identity cascade");
  });

  it("creates a row for a guest who has never signed in", async () => {
    expect(await getCustomer("guest@example.com")).toBeNull();
    expect(await recordMarketingConsent("Guest@Example.COM", "ET")).toBe(true);
    const c = await getCustomer("guest@example.com");
    expect(c?.marketing).toBe(true);
    expect(c?.lang).toBe("ET");
  });

  /* Not ticking a box at a checkout is not a withdrawal: the shopper may have
     said yes in their account last month, and an order is no place to revoke
     that silently. Consent only ever goes ON from here. */
  it("never turns an existing consent off", async () => {
    await recordMarketingConsent("someone@example.com");
    expect((await getCustomer("someone@example.com"))?.marketing).toBe(true);
    // the account screen is where it comes off…
    await updateCustomer("someone@example.com", { marketing: false });
    expect((await getCustomer("someone@example.com"))?.marketing).toBe(false);
    // …and a second order with the box ticked turns it back on
    await recordMarketingConsent("someone@example.com");
    expect((await getCustomer("someone@example.com"))?.marketing).toBe(true);
  });

  it("says no rather than throwing on something that is not an address", async () => {
    expect(await recordMarketingConsent("")).toBe(false);
    expect(await recordMarketingConsent("not-an-address")).toBe(false);
  });
});

describe("the printable gift card in the customer's account", () => {
  beforeAll(async () => {
    await setupDb();
    process.env.SESSION_SECRET = TEST_SECRET;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate gift_card_uses, gift_cards, orders restart identity cascade");
  });

  it("carries the card and its signed link on the order that bought it", async () => {
    const email = "buyer@example.com";
    const order = await createOrder({
      lang: "ru",
      items: [{ id: "gift:50", qty: 1 }],
      customer: { name: "Mari", email, phone: "+372 5555 5555" },
      shipping: { method: "digital", country: "EE" },
    } as Parameters<typeof createOrder>[0]);

    const code = "RMP-ACDE-4679";
    await query(
      "insert into gift_cards (code, amount, balance, order_id, lang) values ($1, 50, 50, $2, 'RU')",
      [code, order.id],
    );

    const [row] = await listCustomerOrders(email);
    expect(row.number).toBe(order.number);
    expect(row.giftCards).toHaveLength(1);
    expect(row.giftCards[0].code).toBe(code);
    expect(row.giftCards[0].amount).toBe(50);
    /* The same signed path the receipt and the letter carry — the browser
       cannot make the token up, and it only ever reaches a request that has
       already proved it owns this mailbox. */
    expect(row.giftCards[0].pdfUrl).toBe(
      `/api/giftcards/${code}/pdf/?t=${encodeURIComponent(giftPdfToken(code))}`,
    );
  });

  it("leaves an ordinary order with an empty list", async () => {
    const order = await createOrder({
      lang: "ru",
      items: [{ id: "gift:25", qty: 1 }],
      customer: { name: "Mari", email: "plain@example.com", phone: "+372 5555 5555" },
      shipping: { method: "digital", country: "EE" },
    } as Parameters<typeof createOrder>[0]);
    expect(order.number).toBeTruthy();
    const [row] = await listCustomerOrders("plain@example.com");
    expect(row.giftCards).toEqual([]);
  });

  it("does not fail the order list when the cards cannot be read", async () => {
    await createOrder({
      lang: "ru",
      items: [{ id: "gift:25", qty: 1 }],
      customer: { name: "Mari", email: "resilient@example.com", phone: "+372 5555 5555" },
      shipping: { method: "digital", country: "EE" },
    } as Parameters<typeof createOrder>[0]);
    await exec("drop table gift_cards cascade");
    const rows = await listCustomerOrders("resilient@example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0].giftCards).toEqual([]);
    // put it back for whatever runs next in this file
    await exec(`create table if not exists gift_cards (
      code text primary key, amount numeric(10,2) not null, balance numeric(10,2) not null,
      order_id uuid, recipient jsonb not null default '{}'::jsonb, lang text not null default 'RU',
      created_at timestamptz not null default now(), redeemed_at timestamptz)`);
  });
});

describe("the Estonian blog label", () => {
  it("is «Blogi» in the request-time head, the same word app.js says", () => {
    expect(T.ET.blog).toBe("Blogi");
    expect(T.RU.blog).toBe("Блог");
    expect(T.EN.blog).toBe("Blog");
  });

  it("has the 404 copy in all three languages", () => {
    for (const code of ["RU", "ET", "EN"] as const) {
      expect(T[code].notFound, code).toBeTruthy();
      expect(T[code].notFoundText, code).toBeTruthy();
    }
    expect(T.ET.notFound).toBe("Lehte ei leitud");
  });

  it("builds the gift description from the amounts on sale", () => {
    expect(T.RU.giftDesc("25 €, 50 €")).toContain("25 €, 50 €");
    expect(T.EN.giftDesc("€25, €50")).toContain("€25, €50");
    expect(T.RU.giftDesc("25 €")).not.toContain("100");
  });
});
