import { expect, type Page, test } from "@playwright/test";
import {
  adminLang, adminSection, continueButton, freshEmail, ipHeaders, loginAsAdmin, openSummary,
  payButton, PRODUCT, shopUrl, waitForScreen,
} from "./fixtures";

/**
 * «Маркетинг → Промокоды», the three things Renat asked for on 12.09.2026:
 *
 *   · the two boxes of the form — «Скидка, €» and «Минимальный заказ» — were
 *     different heights on his iPhone. They were two 140-px columns written
 *     into a style attribute, which beats the media query that collapses every
 *     other pair in the panel, so one label wrapped and the other did not
 *     (admin.css `.adm-pair`);
 *   · the switch took a second or two to answer — a PATCH and then a full
 *     reload of the list before anything moved. It is optimistic now
 *     (togglePromoActive), and it rolls back on a refusal;
 *   · there was no way to delete a code at all. There is one now, for a code
 *     nobody has used — the rule itself lives on the server (src/lib/promos.ts
 *     deletePromo), because the panel's copy of `used` can be a minute old.
 */

/** A code nobody else in the suite will make. */
function freshCode(tag: string): string {
  return `${tag}${Date.now().toString().slice(-7)}`.toUpperCase();
}

/** Creates one code through the admin route the form posts to. */
async function makePromo(page: Page, code: string): Promise<void> {
  const res = await page.request.post("/api/admin/promos/", {
    data: { code, kind: "percent", value: 10, minSubtotal: 0, active: true },
  });
  expect(res.status(), `the code ${code} was not created`).toBe(200);
}

test.describe("admin — the promo form's two boxes are one pair", () => {
  test.use({ extraHTTPHeaders: ipHeaders(233) });

  test("«Скидка» and «Минимальный заказ» line up at 375 and at 360, in every language", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the pair is side by side on a desk; the phone is where it broke");
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    await adminSection(page, "promos");
    await page.locator("[data-admpromonew]").click();

    for (const lang of ["RU", "ET", "EN"] as const) {
      if (lang !== "RU") await adminLang(page, lang);
      for (const width of [375, 360]) {
        await page.setViewportSize({ width, height: 740 });
        // «Процент» and «Сумма в евро» label the left box differently — both
        // are the box the owner types a number into
        for (const kind of ["percent", "fixed"] as const) {
          await page.locator(`[data-promokind="${kind}"]`).click();
          const boxes = await page.evaluate(() => {
            const one = (sel: string) => {
              const b = document.querySelector(sel)!.getBoundingClientRect();
              return { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) };
            };
            return { value: one('[data-promof="value"]'), min: one('[data-promof="minSubtotal"]') };
          });
          const who = `${lang} @${width} ${kind}`;
          expect(boxes.value.h, `${who}: the two boxes are different heights`).toBe(boxes.min.h);
          expect(boxes.value.w, `${who}: the two boxes are different widths`).toBe(boxes.min.w);
          expect(boxes.value.l, `${who}: the two boxes do not start at the same x`).toBe(boxes.min.l);
          expect(boxes.value.h, `${who}: a box is not a thumb's height`).toBeGreaterThanOrEqual(44);
          // stacked, one under the other — never two columns on a phone
          expect(boxes.min.t, `${who}: the boxes are side by side on a phone`).toBeGreaterThan(boxes.value.t);
        }
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await adminLang(page, "RU");
  });
});

test.describe("admin — the promo switch answers the thumb", () => {
  test.use({ extraHTTPHeaders: ipHeaders(234) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "desktop and phone are the two designed layouts");
  });

  test("it flips before the server has answered, and rolls back when the server refuses", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    await adminSection(page, "promos");
    const code = freshCode("SWIFT");
    await makePromo(page, code);
    await page.reload();
    await adminSection(page, "promos");

    const sw = page.locator(`[data-admpromotoggle="${code}"]`);
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    // ---- a slow PATCH: the switch must not wait for it ---------------------
    await page.route("**/api/admin/promos/", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await new Promise((done) => setTimeout(done, 2_000));
      await route.continue();
    });
    const started = Date.now();
    await sw.click();
    await expect(sw, "the switch waited for the server").toHaveAttribute("aria-checked", "false", { timeout: 700 });
    expect(Date.now() - started, "the switch took as long as the request").toBeLessThan(1_500);
    // …and the request really did land afterwards
    await expect(page.getByRole("status")).toContainText("Промокод выключен", { timeout: 10_000 });
    await page.unroute("**/api/admin/promos/");

    // ---- a refusal: the switch goes back, and says so ----------------------
    await page.route("**/api/admin/promos/", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable" }) });
    });
    await sw.click();
    await expect(page.getByRole("status")).toContainText("Не получилось изменить промокод", { timeout: 10_000 });
    await expect(sw, "a refused switch stayed where the tap put it").toHaveAttribute("aria-checked", "false");
    await page.unroute("**/api/admin/promos/");

    // the server's own word agrees with the row
    const list = await (await page.request.get("/api/admin/promos/")).json();
    const row = (list.promos as Array<{ code: string; active: boolean }>).find((p) => p.code === code);
    expect(row?.active, "the code on the server disagrees with the switch on screen").toBe(false);
  });
});

test.describe("admin — «Удалить» a promo code", () => {
  test.use({ extraHTTPHeaders: ipHeaders(235) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "desktop and phone are the two designed layouts");
  });

  test("an unused code goes; a code somebody paid with keeps its switch instead", async ({ page }) => {
    test.setTimeout(300_000);
    await loginAsAdmin(page);

    const spare = freshCode("GONE");
    const spent = freshCode("KEEP");
    await makePromo(page, spare);
    await makePromo(page, spent);

    // ---- somebody pays with one of them ------------------------------------
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(freshEmail("promo-del"));
    await continueButton(page, 2).click();
    await openSummary(page);
    await page.locator("[data-promo]").fill(spent);
    await page.locator("[data-applypromo]").click();
    await expect(page.locator("[data-promooff]"), "the code did not apply at the checkout").toBeVisible();
    await page.locator('input[data-dm="courier"]').check();
    await page.locator('[data-shipf="name"]').fill("E2E Buyer");
    await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
    await page.locator('[data-shipf="zip"]').fill("10111");
    await page.locator('[data-shipf="city"]').fill("Tallinn");
    await page.locator('[data-shipf="phone"]').fill("+372 5550000");
    await continueButton(page, 3).click();
    await page.locator('input[data-paym="1"]').check();
    await payButton(page).click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    await page.getByRole("link", { name: "Оплатить" }).click();
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);

    // ---- back in the panel, with a list that knows about the payment -------
    await page.goto(shopUrl("", "/admin/"));
    await waitForScreen(page, "admin");
    await adminSection(page, "promos");
    const spentRow = page.locator(".adm-row--open").filter({ has: page.locator(`[data-admpromotoggle="${spent}"]`) });
    await expect(spentRow).toBeVisible();
    await expect(spentRow, "the paid order did not count as a use").toContainText("использован 1");
    await expect(page.locator(`[data-admpromodel="${spent}"]`),
      "a code somebody paid with was offered for deletion").toHaveCount(0);
    await expect(spentRow.locator(`[data-admpromotoggle="${spent}"]`),
      "a used code lost its switch as well").toBeVisible();
    // …and the route holds the same rule, whatever the screen believes
    const refused = await page.request.delete(`/api/admin/promos/?code=${encodeURIComponent(spent)}`);
    expect(refused.status(), "the route deleted a code that is on an order").toBe(409);
    expect((await refused.json()).error).toBe("in_use");

    // ---- the untouched one: one tap, one question, and it is gone ----------
    const del = page.locator(`[data-admpromodel="${spare}"]`);
    await expect(del, "an unused code was not offered for deletion").toBeVisible();
    await del.click();
    await expect(page.locator(".adm-confirm"), "«Удалить» did not ask first").toBeVisible();
    await expect(page.locator(".adm-confirm__d")).toContainText(spare);
    await page.locator("[data-admapply]").click();
    await expect(page.getByRole("status")).toContainText("Промокод удалён");
    await expect(page.locator(`[data-admpromotoggle="${spare}"]`), "the row stayed after the delete").toHaveCount(0);

    const left = await (await page.request.get("/api/admin/promos/")).json();
    const codes = (left.promos as Array<{ code: string }>).map((p) => p.code);
    expect(codes, "the deleted code is still in the table").not.toContain(spare);
    expect(codes, "the used code was deleted too").toContain(spent);

    // clean up after ourselves: a used code cannot go, so it goes quiet
    await page.request.patch("/api/admin/promos/", { data: { code: spent, active: false } });
  });

  test("the row opens the form edge to edge, and the switch on it still switches", async ({ page }, testInfo) => {
    /* The blank this is about is the phone's: there the switch and «Удалить»
       are the two ends of a full-width line (`.adm-row__line--split`), and a
       desktop lays the same row out as one tight line with nothing between
       them to tap. */
    test.skip(testInfo.project.name !== "mobile", "the row's blank is the phone's own third line");
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    await adminSection(page, "promos");
    const code = freshCode("WIDE");
    await makePromo(page, code);
    await page.reload();
    await adminSection(page, "promos");

    const sw = page.locator(`[data-admpromotoggle="${code}"]`);
    const row = page.locator(".adm-row--open").filter({ has: sw });
    await expect(row).toBeVisible();

    // the blank between the switch and «Удалить» opens the form…
    const line = row.locator(".adm-row__line--split");
    const box = (await line.boundingBox())!;
    await line.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator("[data-admpromosave]"), "the row's blank opened nothing").toBeVisible();
    await expect(page.locator('[data-promof="code"]')).toHaveValue(code);
    await page.locator("[data-admpromocancel]").click();
    await expect(page.locator("[data-admpromosave]")).toHaveCount(0);

    // …and the switch is still the switch, not a way into the form
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("[data-admpromosave]"), "the switch opened the form too").toHaveCount(0);
  });
});
