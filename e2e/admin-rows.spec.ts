import { expect, type Locator, type Page, test } from "@playwright/test";
import { adminSection, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Which one am I pointing at?» — the admin's list rows.
 *
 * Dim, 07.09.2026: «на странице заказов при наведении на заказ (как на других
 * страницах) должно быть видно, на какой заказ мы наводим.» An orders row is a
 * wrapper with a button inside it, and that button carries `background:none`
 * in a style attribute — which beats any class, so the panel's `:hover` tint
 * had nothing to paint. This file holds every list Renat scans to the same
 * three promises: the pointer lights the whole row, an ink bar says which one
 * without relying on the tint, and Tab lights the same row the mouse would.
 *
 * Desktop only for the hover half (a phone has no pointer); the focus half is
 * the keyboard's, which is the laptop too.
 */

const PAPER = "rgb(255, 255, 255)";
const TINT = "rgb(246, 244, 238)";

async function bg(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el).backgroundColor);
}
/** The 3-px ink bar in the row's left bleed — 1 when lit, 0 when not. */
async function barOpacity(row: Locator): Promise<number> {
  return row.evaluate((el) => Number(getComputedStyle(el, "::before").opacity));
}

/** Hovering `row` lights it and leaves `other` alone.
 *  Polled throughout: the panel's rows fade in (`adm-up`) and the tint itself
 *  is a .12 s transition, so a single read can land mid-animation. */
async function expectHoverLights(page: Page, row: Locator, other: Locator, what: string): Promise<void> {
  await page.mouse.move(0, 0);
  await expect.poll(() => bg(row), { message: `${what}: a row is tinted before anything is hovered` }).toBe(PAPER);
  await row.hover();
  await expect.poll(() => bg(row), { message: `${what}: hover does not tint the row` }).toBe(TINT);
  await expect.poll(() => barOpacity(row), { message: `${what}: no ink bar on the hovered row` }).toBe(1);
  expect(await bg(other), `${what}: the neighbour lit up too`).toBe(PAPER);
  expect(await barOpacity(other), `${what}: the neighbour got a bar too`).toBe(0);
}

test.describe("admin — the row under the pointer", () => {
  test.use({ extraHTTPHeaders: ipHeaders(153) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "hover is the laptop's; a phone has no pointer");
  });

  test("«Заказы»: the row under the pointer, and the row the keyboard is in", async ({ page }) => {
    test.setTimeout(180_000);

    // two paid orders, so "this one and not that one" is a real question
    for (const tag of ["rows-a", "rows-b"]) {
      await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl("", "/checkout/"));
      await waitForScreen(page, "checkout");
      await payOrder(page, freshEmail(tag), "paid");
    }

    await loginAsAdmin(page);
    await page.locator('[data-admtab="orders"][aria-current]:visible').first().click();
    const rows = page.locator("#orderlist .adm-row--open");
    await expect(rows.nth(1), "two paid orders should be waiting").toBeVisible();

    await expectHoverLights(page, rows.nth(0), rows.nth(1), "orders");
    await expectHoverLights(page, rows.nth(1), rows.nth(0), "orders, the second one");

    // the keyboard gets the same band: focus anything inside a row and the
    // WHOLE row lights, not just the button
    await page.mouse.move(0, 0);
    await expect.poll(() => bg(rows.nth(1))).toBe(PAPER);
    await rows.nth(1).locator("[data-admorder]").focus();
    await expect.poll(() => bg(rows.nth(1)), { message: "focus does not light the row" }).toBe(TINT);
    expect(await barOpacity(rows.nth(1)), "focus draws no ink bar").toBe(1);
    expect(await bg(rows.nth(0)), "the other row lit up on focus").toBe(PAPER);
  });

  test("the other lists Renat scans: товары, клиенты, промокоды, блог", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // «Товары» — the row IS the button here, so the same rules have to reach it
    await page.locator('[data-admtab="goods"][aria-current]:visible').first().click();
    const goods = page.locator("#goodslist .adm-row--click");
    await expect(goods.nth(1)).toBeVisible();
    await expectHoverLights(page, goods.nth(0), goods.nth(1), "products");

    // «Маркетинг → Промокоды» — a wrapper row with a switch beside the name;
    // focusing the SWITCH lights the row too, which is how you know which
    // code you are about to switch off
    await page.locator('[data-admtab="promos"][aria-current]:visible').first().click();
    const code = `ROW${Date.now().toString().slice(-7)}`;
    for (const suffix of ["A", "B"]) {
      await page.locator("[data-admpromonew]").click();
      await page.locator('[data-promof="code"]').fill(code + suffix);
      await page.locator('[data-promokind="percent"]').click();
      await page.locator('[data-promof="value"]').fill("5");
      await page.locator("[data-admpromosave]").click();
      await expect(page.locator(`[data-admpromotoggle="${code}${suffix}"]`)).toBeVisible();
    }
    const promoRow = (s: string) => page.locator(".adm-row--open", { has: page.locator(`[data-admpromotoggle="${code}${s}"]`) });
    await expectHoverLights(page, promoRow("A"), promoRow("B"), "promo codes");
    await page.mouse.move(0, 0);
    await page.locator(`[data-admpromotoggle="${code}B"]`).focus();
    await expect.poll(() => bg(promoRow("B")), { message: "the switch's row does not light on focus" }).toBe(TINT);

    // «Блог» — the row is the button again
    await page.locator('[data-admtab="blog"][aria-current]:visible').first().click();
    const posts = page.locator("[data-admblogedit]");
    if ((await posts.count()) > 1) await expectHoverLights(page, posts.nth(0), posts.nth(1), "blog posts");

    // «Клиенты» — a wrapper row; the suite's shop has at least the buyers the
    // orders above made
    await page.locator('[data-admtab="people"][aria-current]:visible').first().click();
    const people = page.locator(".adm-row--open", { has: page.locator("[data-admcustopen]") });
    if ((await people.count()) > 1) await expectHoverLights(page, people.nth(0), people.nth(1), "customers");
  });
});

/**
 * Dim, 11.09.2026, on his phone: the rows of a list looked different from one
 * another — a chip or a price sat beside the text when the text was short and
 * dropped under it when the text was long, so no two rows of a list lined up.
 * Since r14 a list row on a phone is one shape on every row (admin.css,
 * `.adm-row--lines`): the name on one line, the grey line under it, the chips
 * under both and starting at the same x on every row, the actions under the
 * chips at the row's left edge, the sum on the first line at the right edge.
 *
 * This measures exactly that on the six lists that have the shape, with the
 * longest name the panel should ever meet on one row of each (60 characters),
 * and at 360 px as well as 375 — the phone Renat actually holds. Phone only:
 * a desktop lays the same rows out in one line, and that is its own layout.
 */
const LONG_SET = "Большой набор для ухода за бородой и волосами на каждый день";   // 60 characters
const LONG_POST = "Как ухаживать за бородой зимой: масло, бальзам и правильная расчёска";

interface Box { top: number; bottom: number; left: number; right: number; height: number }
interface RowShape {
  text: string; row: Box; body: Box | null; nm: Box | null; line: Box | null; end: Box | null;
  acts: Box | null; amt: Box | null; small: string[];
}

async function rowShapes(page: Page, sel: string): Promise<RowShape[]> {
  return page.evaluate((s) => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
    };
    return Array.from(document.querySelectorAll(s)).map((row) => ({
      text: (row.querySelector(".adm-row__nm")?.textContent || "").trim(),
      row: box(row)!,
      body: box(row.querySelector(".adm-row__body")),
      nm: box(row.querySelector(".adm-row__nm")),
      line: box(row.querySelector(":scope > .adm-row__line")),
      // a letter's «Изменить», the warehouse row's «Править»: the right end of a split line
      end: box(row.querySelector(":scope > .adm-row__line--split > :last-child")),
      acts: box(row.querySelector(":scope > .adm-acts")),
      amt: box(row.querySelector(":scope > .adm-row__amt")),
      // every button on the chip and action lines is a thumb's size
      small: Array.from(row.querySelectorAll<HTMLElement>(
        ":scope > .adm-row__line .adm-btn, :scope > .adm-row__line .adm-link, :scope > .adm-row__line .adm-sw, :scope > .adm-acts button",
      )).map((el) => ({ el, b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width && b.height && (b.width < 43.5 || b.height < 43.5))
        .map(({ el, b }) => `«${(el.textContent || el.getAttribute("aria-label") || "").trim()}» ${Math.round(b.width)}×${Math.round(b.height)}`),
    }));
  }, sel);
}

/** Every row of `sel` has the shape, and the same shape as the first row. */
async function oneShape(page: Page, sel: string, label: string): Promise<void> {
  const rows = await rowShapes(page, sel);
  const vw = page.viewportSize()!.width;
  expect(rows.length, `${label} @${vw}: fewer than two rows to compare`).toBeGreaterThan(1);
  const x = rows[0].line ? rows[0].line.left : NaN;
  for (const r of rows) {
    const who = `${label} @${vw} · «${r.text.slice(0, 32)}»`;
    expect(r.line, `${who}: the row has no chip line`).not.toBeNull();
    expect(r.body, `${who}: the row has no text body`).not.toBeNull();
    expect(r.nm!.height, `${who}: the name wraps onto a second line`).toBeLessThanOrEqual(24);
    expect(r.line!.top, `${who}: the chips sit beside the text instead of under it`).toBeGreaterThanOrEqual(r.body!.bottom - 1);
    expect(Math.round(r.line!.left - x), `${who}: the chips start at another x than the first row's`).toBe(0);
    if (r.end) expect(Math.round(r.line!.right - r.end.right), `${who}: the line's button is not at the right edge`).toBe(0);
    if (r.acts) {
      expect(r.acts.top, `${who}: the actions sit beside the chips instead of under them`).toBeGreaterThanOrEqual(r.line!.bottom - 1);
      expect(Math.round(r.acts.left - r.row.left), `${who}: the actions do not start at the row's left edge`).toBe(0);
    }
    if (r.amt) {
      expect(Math.abs(r.amt.top - r.nm!.top), `${who}: the sum is not on the first line`).toBeLessThanOrEqual(4);
      expect(Math.round(r.row.right - r.amt.right), `${who}: the sum is not at the right edge`).toBe(0);
    }
    expect(r.row.right, `${who}: the row runs past the screen`).toBeLessThanOrEqual(vw + 0.5);
    expect(r.small, `${who}: controls under 44 px`).toEqual([]);
  }
}

test.describe("admin — one shape per list on the phone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(165) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the stacked rows are the phone's; a desktop lays the same rows out in one line");
  });

  test("orders, sets, catalogue, warehouse, blog, letters: the same three lines on every row, at 375 and at 360", async ({ page }) => {
    test.setTimeout(300_000);

    // two paid orders, so «Заказы» has rows to compare with each other
    for (const [tag, id] of [["shape-a", PRODUCT.id], ["shape-b", PRODUCT_2.id]] as const) {
      await page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl("", "/checkout/"));
      await waitForScreen(page, "checkout");
      await payOrder(page, freshEmail(tag), "paid");
    }
    await loginAsAdmin(page);

    // …and a set and a post with the longest names the panel should ever meet
    const setId = `shape-set-${Date.now().toString().slice(-6)}`;
    const made = await page.request.post("/api/admin/bundles/", { data: {
      id: setId, cat: "beard", title: { RU: LONG_SET, ET: "", EN: "" }, desc: { RU: "", ET: "", EN: "" },
      items: [{ productId: PRODUCT.id, variant: 0, qty: 1 }, { productId: PRODUCT_2.id, variant: 0, qty: 1 }],
      price: 14.9, image: null, active: true, sort: 97,
    } });
    expect(made.status(), "the long-named set was not created").toBe(200);
    const posted = await page.request.post("/api/admin/blog/", { data: {
      title: { RU: LONG_POST, ET: "", EN: "" }, body: { RU: "<p>Зимой борода сохнет быстрее.</p>" },
      excerpt: { RU: "Зимой борода сохнет быстрее — три привычки, которые это исправят." },
    } });
    expect(posted.status(), "the long-named draft was not created").toBe(200);
    const postId = ((await posted.json()) as { post: { id: string } }).post.id;

    try {
      for (const width of [375, 360]) {
        await page.setViewportSize({ width, height: 740 });

        await adminSection(page, "orders");
        await page.locator('[data-admfilter="all"]').click();
        await expect(page.locator("#orderlist .adm-row--lines").nth(1)).toBeVisible();
        await oneShape(page, "#orderlist .adm-row--lines", "Заказы");

        await adminSection(page, "goods");
        await page.locator('[data-admgoodstab="bundles"]').click();
        await expect(page.locator(`[data-bundleedit="${setId}"]`)).toBeVisible();
        await oneShape(page, ".adm-row--lines:has([data-bundleedit])", "Наборы");

        await page.locator('.adm-tab[data-admtab="goods"]').click();
        await expect(page.locator("#goodslist .adm-row--lines").nth(1)).toBeVisible();
        await oneShape(page, "#goodslist .adm-row--lines", "Каталог");

        await page.locator('.adm-tab[data-admtab="stock"]').click();
        await expect(page.locator("#stocklist .adm-row--lines").nth(1)).toBeVisible();
        await oneShape(page, "#stocklist .adm-row--lines", "Склад");

        await adminSection(page, "blog");
        await expect(page.locator(`[data-admblogedit="${postId}"]`)).toBeVisible();
        await oneShape(page, "[data-admblogedit].adm-row--lines", "Блог");

        await adminSection(page, "promos", "mail");
        await expect(page.locator("[data-mailtpl]").first()).toBeVisible();
        await oneShape(page, ".adm-row--lines:has(> [data-mailtpl])", "Письма");
      }
    } finally {
      await page.request.delete(`/api/admin/bundles/?id=${encodeURIComponent(setId)}`);
      await page.request.delete(`/api/admin/blog/?id=${encodeURIComponent(postId)}`);
    }
  });
});
