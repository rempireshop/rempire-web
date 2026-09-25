import { expect, type Browser, type Page, test } from "@playwright/test";
import {
  continueButton,
  eur,
  freshEmail,
  ipHeaders,
  loginAsAdmin,
  PRODUCT,
  PRODUCT_2,
  shopUrl,
  waitForScreen,
} from "./fixtures";

/**
 * «Товары → Наборы» — the sets, now that Renat owns them.
 *
 * The whole point of moving them out of tools/bundles.config.mjs and into the
 * `bundles` table is this walk: build a set in the panel, see it on the shelf,
 * buy it at the price the panel says, change that price and watch the shop
 * follow, then hide it, then delete it. Anything less and the sets are still
 * a developer's file with a nicer wrapper.
 *
 * Desktop only, RU only — the admin panel is Renat's own tool, see
 * docs/testing.md "Why most specs run on desktop only".
 *
 * Serial, and each test gets its own fake IP through its own nested describe:
 * admin login is rate-limited at 5 tries a minute per IP (src/lib/auth.ts) and
 * this file signs in eight times — the same arrangement e2e/admin.spec.ts uses
 * and for the same reason.
 *
 * Both sets this file creates ("e2e-set" through the editor, "e2e-set-assist"
 * through the API) are deleted before it ends — one by the owner's own
 * «Удалить набор», one by the assistant's — so the suite leaves the shop with
 * exactly the sets it started with. Everything else it touches (PRODUCT,
 * PRODUCT_2) it only reads.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin spec — desktop project only, see docs/testing.md");
});

const SET_ID = "e2e-set";
/** 1a: the address is written from the Russian name (bundleSuggestId) — a latin
 *  word stays as it is and «набор» becomes «set», so this name is «e2e-set». */
const SET_NAME = "E2E набор для проверки";
/** A second set, made through the API and deleted by the assistant — so the
 *  walk above is never the thing the delete test is aiming at. */
const ASSIST_ID = "e2e-set-assist";
const ASSIST_NAME = "Набор для помощника";
/** Well under PRODUCT (9 € at its first size) + PRODUCT_2 (8 €) — the panel
 *  refuses anything that is not cheaper than the parts. */
const SET_PRICE = 12.9;
const NEW_PRICE = 11.4;

/** A fresh browser context: /api/bundles/ and /api/overrides/ are both cached
 *  (`s-maxage=30`), and a page opened in the admin's own context would share
 *  its HTTP cache — see e2e/admin.spec.ts freshStorefrontPage()'s own note. */
async function freshShop(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(187) });
  const page = await ctx.newPage();
  return { page, close: () => ctx.close() };
}

/** Admin → «Товары» → the «Наборы» tab. */
async function openSets(page: Page): Promise<void> {
  /* «Товары», then its «Наборы» tab: the redesign folded the old flat tabs
     into five sections, and the sets shelf is one tab inside «Товары» now
     (docs/design/admin-handoff-README.md). [aria-current] + :visible picks the
     nav item out of everything else carrying the same key. */
  await page.locator('[data-admtab="goods"][aria-current]:visible').first().click();
  await page.locator('[data-admgoodstab="bundles"]').click();
  await expect(page.locator('[data-admgoodstab="bundles"][aria-current="true"]')).toBeVisible();
  // «+ Набор» renders only once GET /api/admin/bundles/ has answered and
  // the panel knows it is signed in — the honest "this tab is ready" signal
  await expect(page.locator("[data-bundlenew]:visible").first()).toBeVisible();
}

/** Adds one product to the set open in the editor, through the search box —
 *  1a: each result carries its volumes as chips; the first is the first volume. */
async function addProduct(page: Page, id: string, name: string): Promise<void> {
  await page.locator("[data-bundleq]").fill(name);
  await page.locator(`[data-bundleadd="${id}"]`).first().click();
  await expect(page.locator("[data-bundledel]").first()).toBeVisible();
}

/** The one whole-row write a set saves itself through. */
function bundlePost(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/api/admin/bundles/") && r.request().method() === "POST");
}

/** «12,90 €» → 12.9 */
function eu(text: string): number {
  return Number(text.replace("€", "").replace(/\s/g, "").replace(",", ".").trim());
}

test.describe("admin — наборы", () => {
  test.describe.configure({ mode: "serial" });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(186) });
    test("the address of a new set is an English word, shown behind «?», and a draft with no products is never saved", async ({ page }) => {
      await loginAsAdmin(page);
      await openSets(page);
      const posts: string[] = [];
      page.on("request", (r) => { if (r.url().includes("/api/admin/bundles/") && r.method() === "POST") posts.push(r.url()); });

      /* Dim, 08.09.2026: this address is a URL. The shopper reads it, Google
         indexes it and the shop sells across Europe, so «Набор для бороды»
         becomes `beard-set` and not `nabor-dlya-borody` — the same English
         the sets the shop shipped with already use (`beard-start`,
         `shave-smooth`, db/migrations/120_bundles.sql). 1a (q23): it is not a
         box any more — it is written from the name and shown behind «?». */
      await page.locator("[data-bundlenew]:visible").first().click();
      await expect(page.locator('[data-bundlef="id"]'), "the address is still a box to fill").toHaveCount(0);
      await page.locator('[data-bundlef="title"]').fill("Набор для бороды");
      await page.locator('[data-admhelp="set-addr"]').click();
      const addr = page.locator("#admhelp-set-addr");
      await expect(addr).toContainText("/set/beard-set/");
      // …and it keeps following the name while the set is still a draft
      await page.locator('[data-bundlef="title"]').fill("Набор для бритья");
      await expect(addr).toContainText("/set/shave-set/");

      // a name alone is not a set: nothing went to the server, the draft waits in this browser
      await page.locator('[data-bundlef="title"]').press("Enter");
      await expect(page.locator(".adm-seted__draft")).toBeVisible();
      await page.locator("[data-bundlecancel]").click();
      await expect(page.locator("[data-bundleform]")).toHaveCount(0);
      expect(posts, "a draft with no products was sent to the shop").toEqual([]);
      const list = await (await page.request.get("/api/admin/bundles/")).json();
      expect(list.bundles.map((b: { id: string }) => b.id)).not.toContain("shave-set");
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(180) });
    test("builds a set from two products — it saves itself hidden, shown with its switch, and the shop sells it at that price", async ({ page, browser }) => {
      /* The panel, then a second browser through the whole checkout: 13 s
         alone, but in a full run `next dev` compiles routes on first hit and
         the checkout shell alone took 6 s — the default 30 s ran out in the
         `finally` that closes the shop (24.09.2026), and this suite is serial,
         so the six tests after it never ran. */
      test.setTimeout(60_000);
      await loginAsAdmin(page);
      await openSets(page);

      await page.locator("[data-bundlenew]:visible").first().click();
      await page.locator('[data-bundlef="title"]').fill(SET_NAME);
      await page.locator('[data-bundlef="desc"]').fill("Два товара, которые обычно берут вместе.");

      await addProduct(page, PRODUCT.id, PRODUCT.brand);
      await addProduct(page, PRODUCT_2.id, PRODUCT_2.brand);
      // PRODUCT has three volumes — its row grows a size picker with all three,
      // and the set is priced at whichever one is chosen (the first by default)
      await expect(page.locator("[data-bundlesize]").first().locator("option")).toHaveCount(PRODUCT.sizes.length);

      /* Dim, 07.09.2026: «when creating sets and putting together items, we
         need to see somewhere what the price total of the set is, so we can
         apply a percentage as discount.» The running total sits under the item
         list, and the two money boxes are that one price seen two ways: a per
         cent typed into one fills the euro price into the other, in place. */
      const sumLine = page.locator("[data-bundlesum]");
      await expect(sumLine).toContainText("Сумма товаров");
      const sum = eu(((await sumLine.textContent()) || "").replace("Сумма товаров —", ""));
      expect(sum).toBeGreaterThan(SET_PRICE);

      await page.locator("[data-bundlepct]").fill("20");
      await expect(page.locator('[data-bundlef="price"]')).toHaveValue(String(Math.round(sum * 80) / 100));

      /* The hint is the number the owner is really deciding against, and it has
         to answer while the price is being typed — without a re-render taking
         the caret out of the box. */
      await page.locator('[data-bundlef="price"]').fill(String(SET_PRICE));
      await expect(page.locator("[data-bundlehint]")).toContainText("Сумма по отдельности");
      await expect(page.locator("[data-bundlehint]")).toContainText("скидка");
      // …and the per-cent box followed the euro one back
      await expect(page.locator("[data-bundlepct]")).toHaveValue(
        String(Math.round(((sum - SET_PRICE) / sum) * 1000) / 10).replace(".", ","),
      );

      /* 1a (q27): no «Сохранить». The price leaves the box on Enter, and with
         a name, two products and a price below the parts the draft is a real
         set now — hidden, on the address its name gave it — and the price is
         what is stored (q28). The per-cent box was LEFT for the euro one a
         moment ago, and money saves on leave (q1): that already made the set,
         at 13,60 €, and its answer can land after this line — so the POST
         that counts is the one carrying the price typed last. */
      const created = page.waitForResponse((r) => r.url().includes("/api/admin/bundles/") && r.request().method() === "POST" &&
        (r.request().postDataJSON() as { price?: number } | null)?.price === SET_PRICE);
      await page.locator('[data-bundlef="price"]').press("Enter");
      const res = await created;
      expect(res.ok()).toBe(true);
      expect(res.request().postDataJSON()).toMatchObject({ id: SET_ID, active: false, price: SET_PRICE });
      await expect(page.locator(`[data-bundleedit="${SET_ID}"]`)).toBeVisible();
      await expect(page.locator("[data-admsavest]:visible").first()).toContainText("Сохранено");

      // …and «Показывать в магазине» puts it on the shelf
      const shown = page.waitForResponse((r) => r.url().includes("/api/admin/bundles/") && r.request().method() === "PATCH");
      await page.locator(`[data-bundleshow="${SET_ID}"]`).click();
      expect((await shown).ok()).toBe(true);
      await expect(page.locator(`[data-bundletoggle="${SET_ID}"]`)).toHaveAttribute("aria-checked", "true");

      // …and now the shop, in its own context
      const shop = await freshShop(browser);
      try {
        await shop.page.goto(shopUrl("", "/sets/"));
        await waitForScreen(shop.page, "bundles");
        const card = shop.page.locator(`[data-go-bundle="${SET_ID}"]`);
        await expect(card).toBeVisible();
        await expect(card).toContainText(SET_NAME);
        await card.click();
        await waitForScreen(shop.page, "bundle");
        await expect(shop.page.locator(".bitems")).toContainText(PRODUCT.brand);
        await expect(shop.page.locator(".bitems")).toContainText(PRODUCT_2.brand);

        await shop.page.locator(`button.btn--wide[data-addbundle="${SET_ID}"]`).click();
        await expect(shop.page.locator("[data-cartbadge]")).toHaveText("1");

        await shop.page.goto(shopUrl("", "/checkout/"));
        await waitForScreen(shop.page, "checkout");
        await expect(shop.page.locator(".cosum")).toContainText(SET_NAME);
        await expect(shop.page.locator(".cosum")).toContainText(eur(SET_PRICE, "RU"));

        /* The total the shopper is asked for = the set's own price + delivery,
           both recomputed on the server (src/lib/orders.ts prices the line from
           the same table the panel wrote). Delivery is read off the page rather
           than hard-coded — the rules are editable in the admin too. */
        await shop.page.locator("[data-email]").fill(freshEmail("adm-bundle"));
        await continueButton(shop.page, 2).click();
        await shop.page.locator('input[data-dm="courier"]').check();
        await shop.page.locator('[data-shipf="name"]').fill("E2E Buyer");
        await shop.page.locator('[data-shipf="addr"]').fill("Testitänav 1");
        await shop.page.locator('[data-shipf="zip"]').fill("10111");
        await shop.page.locator('[data-shipf="city"]').fill("Tallinn");
        await shop.page.locator('[data-shipf="phone"]').fill("+372 5550000");
        await continueButton(shop.page, 3).click();

        const total = eu(((await shop.page.locator(".cosum__row--tot .num").textContent()) || "").trim());
        const shipRow = shop.page.locator(".cosum__row").filter({ hasText: "Доставка" }).first();
        const delivery = eu(((await shipRow.locator("span").last().textContent()) || "0").trim());
        expect(total).toBeCloseTo(SET_PRICE + delivery, 2);
      } finally {
        await shop.close();
      }
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(181) });
    test("changing the price in the panel changes it in the shop — the box saves itself when it is left", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSets(page);

      await page.locator(`[data-bundleedit="${SET_ID}"]`).click();
      await page.locator('[data-bundlef="price"]').fill(String(NEW_PRICE));
      const saved = bundlePost(page);
      await page.locator('[data-bundlef="price"]').press("Enter");
      expect((await saved).ok()).toBe(true);

      const shop = await freshShop(browser);
      try {
        await shop.page.goto(shopUrl("", `/set/${SET_ID}/`));
        await waitForScreen(shop.page, "bundle");
        await expect(shop.page.locator(".pdp__price")).toContainText(eur(NEW_PRICE, "RU"));
      } finally {
        await shop.close();
      }
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(182) });
    test("refuses a set that is not cheaper than its parts, and a new one never takes an address that is taken", async ({ page }) => {
      await loginAsAdmin(page);
      await openSets(page);
      const posts: string[] = [];
      page.on("request", (r) => { if (r.url().includes("/api/admin/bundles/") && r.method() === "POST") posts.push(r.url()); });

      await page.locator(`[data-bundleedit="${SET_ID}"]`).click();
      await page.locator('[data-bundlef="price"]').fill("999");
      await page.locator('[data-bundlef="price"]').press("Enter");
      // refused before the trip, in rust, and the box says it is the one
      await expect(page.locator("[data-bundlehint]")).toContainText("дороже");
      await expect(page.locator('[data-bundlef="price"]')).toHaveAttribute("aria-invalid", "true");
      await page.waitForTimeout(500);
      expect(posts, "a price above the parts was sent").toEqual([]);
      await page.locator("[data-bundlecancel]").click();

      /* …and a NEW set named like one that exists. POST /api/admin/bundles/ is
         an upsert, so a new set on an address that already belongs to one
         would replace it — its name, its products and its price. 1a writes the
         address itself, and never one the list already has. */
      await page.locator("[data-bundlenew]:visible").first().click();
      await page.locator('[data-bundlef="title"]').fill(SET_NAME);
      await page.locator('[data-admhelp="set-addr"]').click();
      await expect(page.locator("#admhelp-set-addr")).toContainText(`/set/${SET_ID}-2/`);
      await page.locator("[data-bundlecancel]").click();
      // the set that was there is untouched
      await expect(page.locator(`[data-bundleedit="${SET_ID}"]`)).toBeVisible();
      expect(posts).toEqual([]);
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(183) });
    test("hiding a set takes it off the shelf but leaves its address answering", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSets(page);

      const hidden = page.waitForResponse((r) => r.url().includes("/api/admin/bundles/") && r.request().method() === "PATCH");
      await page.locator(`[data-bundletoggle="${SET_ID}"]`).click();
      expect((await hidden).ok()).toBe(true);
      // the switch says so, and the toast offers «Вернуть»
      await expect(page.locator(`[data-bundletoggle="${SET_ID}"]`)).toHaveAttribute("aria-checked", "false");
      await expect(page.locator(".adm-toast__undo")).toBeVisible();

      const shop = await freshShop(browser);
      try {
        await shop.page.goto(shopUrl("", "/sets/"));
        await waitForScreen(shop.page, "bundles");
        await expect(shop.page.locator(`[data-go-bundle="${SET_ID}"]`)).toHaveCount(0);

        await shop.page.goto(shopUrl("", `/set/${SET_ID}/`));
        await waitForScreen(shop.page, "bundle");
        await expect(shop.page.locator("h1")).toContainText("Набор не найден");
        await expect(shop.page.locator(`[data-addbundle="${SET_ID}"]`)).toHaveCount(0);
      } finally {
        await shop.close();
      }
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(184) });
    test("deleting asks first, is held with «Вернуть», then removes the set for good", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSets(page);

      await page.locator(`[data-bundleedit="${SET_ID}"]`).click();
      await page.locator(`[data-bundledelete="${SET_ID}"]`).click();
      // the one confirm sheet (README rule 4): a question, one sentence, «Не надо»
      const sheet = page.locator(".adm-confirm");
      await expect(sheet).toContainText("Удалить набор");
      await page.locator("[data-admcancel]").click();
      await expect(sheet).toHaveCount(0);

      await page.locator(`[data-bundledelete="${SET_ID}"]`).click();
      await page.locator("[data-admapply]").click();
      // off the list at once; the DELETE itself waits while «Вернуть» stands (q8)
      await expect(page.locator(`[data-bundleedit="${SET_ID}"]`)).toHaveCount(0);
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await expect.poll(async () => {
        const list = await (await page.request.get("/api/admin/bundles/")).json();
        return list.bundles.map((b: { id: string }) => b.id);
      }, { timeout: 20_000, message: "the held delete never went" }).not.toContain(SET_ID);

      const shop = await freshShop(browser);
      try {
        await shop.page.goto(shopUrl("", `/set/${SET_ID}/`));
        await waitForScreen(shop.page, "bundle");
        await expect(shop.page.locator("h1")).toContainText("Набор не найден");
      } finally {
        await shop.close();
      }
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(188) });
    test("the assistant may delete a set, once — the card names it and «Отмена» keeps it", async ({ page, browser }) => {
      /* Dim, 08.09.2026: yes to delete. The model is stubbed at the network
         edge, the way e2e/admin-products.spec.ts stubs it for create_product
         — what is being walked here is the panel's half: one confirm card,
         the set named on it, and the same DELETE the editor's own «Удалить
         набор» sends. */
      await page.route("**/api/assistant/**", async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
          return;
        }
        await route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            reply: "Удалю этот набор — подтвердите, вернуть его будет нельзя.",
            product_ids: [], tab: "goods",
            // an id and nothing else: the NAME on the card can then only have
            // come from the panel's own list of sets (sanitizeDeleteBundle)
            action: { type: "delete_bundle", id: ASSIST_ID },
          }),
        });
      });

      await loginAsAdmin(page);
      const made = await page.request.post("/api/admin/bundles/", {
        data: {
          id: ASSIST_ID, cat: "beard", title: { RU: ASSIST_NAME, ET: "", EN: "" },
          desc: { RU: "", ET: "", EN: "" },
          items: [{ productId: PRODUCT.id, variant: 0, qty: 1 }, { productId: PRODUCT_2.id, variant: 0, qty: 1 }],
          price: SET_PRICE, image: null, active: true, sort: 95,
        },
      });
      expect(made.status(), "the set the assistant is meant to delete was not created").toBe(200);

      /* Deliberately NOT through «Товары → Наборы»: the assistant lives in a
         side pane and the owner may never have opened that tab in this
         sitting, so this is also the test that the panel fetches the list it
         needs to name the set. */
      await page.locator(".adm-aiopen:visible").first().click();
      await page.locator("[data-admq]").fill(`удали набор ${ASSIST_NAME}`);
      await page.locator("[data-admsend]").click();

      const answer = page.locator("[data-aians]");
      const card = answer.locator(".adm-propose");
      await expect(card).toContainText(`Удалить набор «${ASSIST_NAME}»`);
      await expect(card).toContainText("вернуть его будет нельзя");
      // the destructive button, the same red one «Да, удалить» wears in the editor
      const apply = card.locator("[data-admapply]");
      await expect(apply).toHaveText("Да, удалить");
      await expect(apply).toHaveClass(/adm-btn--warn/);

      // «Отмена» keeps the set: the card is the whole of the gate
      await card.locator("[data-admcancel]").click();
      await expect(answer.locator(".adm-propose")).toHaveCount(0);
      const still = await (await page.request.get("/api/admin/bundles/")).json();
      expect(still.bundles.map((b: { id: string }) => b.id), "«Отмена» deleted the set anyway").toContain(ASSIST_ID);

      // asked again and confirmed, it goes — and it goes for good
      await page.locator("[data-admq]").fill(`удали набор ${ASSIST_NAME}`);
      await page.locator("[data-admsend]").click();
      await expect(answer.locator(".adm-propose")).toBeVisible();
      await answer.locator("[data-admapply]").click();
      await expect.poll(async () => {
        const list = await (await page.request.get("/api/admin/bundles/")).json();
        return list.bundles.map((b: { id: string }) => b.id);
      }, { timeout: 15_000, message: "the set the assistant deleted is still on the shelf" }).not.toContain(ASSIST_ID);

      const shop = await freshShop(browser);
      try {
        await shop.page.goto(shopUrl("", `/set/${ASSIST_ID}/`));
        await waitForScreen(shop.page, "bundle");
        await expect(shop.page.locator("h1")).toContainText("Набор не найден");
      } finally {
        await shop.close();
      }
    });
  });

  test.describe(() => {
    test.use({ extraHTTPHeaders: ipHeaders(185) });
    test("the sets the shop shipped with survive all of that", async ({ page, browser }) => {
      // the seed from db/migrations/120_bundles.sql — same ids, same URLs, and
      // still on the shelf after this file has created and deleted its own
      await loginAsAdmin(page);
      await openSets(page);

      const shop = await freshShop(browser);
      try {
        await shop.page.goto(shopUrl("", "/sets/"));
        await waitForScreen(shop.page, "bundles");
        await expect(shop.page.locator('[data-go-bundle="beard-start"]')).toBeVisible();
      } finally {
        await shop.close();
      }
    });
  });
});
