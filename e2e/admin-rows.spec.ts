import { expect, type Locator, type Page, test } from "@playwright/test";
import { adminSection, cardBack, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

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

/* The panel's paper and its soft panel — direction 1a's tokens (admin.css
   --a-paper #fdfcf9, --a-panel #f4f2ec, which --a-tint now names). */
const PAPER = "rgb(253, 252, 249)";
const TINT = "rgb(244, 242, 236)";

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
    // polled like the hover's: the bar fades in with the tint (0.9986 read
    // mid-transition on 24.09.2026)
    await expect.poll(() => barOpacity(rows.nth(1)), { message: "focus draws no ink bar" }).toBe(1);
    expect(await bg(rows.nth(0)), "the other row lit up on focus").toBe(PAPER);
  });

  test("the other lists Renat scans: товары, клиенты, промокоды, блог", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // «Товары» — the row IS the button here, so the same rules have to reach it
    await page.locator('[data-admtab="goods"][aria-current]:visible').first().click();
    // 1a (screen 10): a catalogue row is a wrapper — the name is its button, the «Виден» switch sits beside it
    const goods = page.locator("#goodslist .adm-row--open");
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
      await page.locator('[data-promof="value"]').blur();
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
 * This measures exactly that on the five lists that have the shape (the
 * letters have their own since 1a — mailShape below), with the
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

/* 1a (README § 5): «Склад» and «Наборы» are not the three-line row of the
   other lists any more but the design's own — a product's sizes as short rows
   with − / + (11-stock-phone-v2), a set with its price and its switch under
   the name (12-sets). The promise is the same one: every row of a list has the
   same shape, nothing runs past the screen, nothing wraps, and every control
   is a thumb's size. */
async function listShape(page: Page, rowSel: string, alignSel: string, nameSel: string, smallSel: string, label: string): Promise<void> {
  const r = await page.evaluate(({ rowSel, alignSel, nameSel, smallSel }) => {
    const vw = document.documentElement.clientWidth;
    const rows = Array.from(document.querySelectorAll(rowSel));
    return {
      vw,
      n: rows.length,
      right: rows.map((row) => { const el = row.querySelector(alignSel); return el ? Math.round(el.getBoundingClientRect().right) : -1; }),
      over: rows.filter((row) => row.getBoundingClientRect().right > vw + 0.5).length,
      wraps: Array.from(document.querySelectorAll(nameSel)).filter((el) => el.getBoundingClientRect().height > 24).length,
      small: rows.flatMap((row) => Array.from(row.querySelectorAll<HTMLElement>(smallSel))
        .map((el) => ({ t: (el.textContent || el.getAttribute("aria-label") || "").trim(), b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width && b.height && (b.width < 43.5 || b.height < 43.5))
        .map(({ t, b }) => `«${t}» ${Math.round(b.width)}×${Math.round(b.height)}`)),
    };
  }, { rowSel, alignSel, nameSel, smallSel });
  expect(r.n, `${label} @${r.vw}: fewer than two rows to compare`).toBeGreaterThan(1);
  expect(r.right.filter((x) => x < 0), `${label} @${r.vw}: a row without its control`).toEqual([]);
  expect(new Set(r.right).size, `${label} @${r.vw}: the controls do not line up`).toBe(1);
  expect(r.over, `${label} @${r.vw}: a row runs past the screen`).toBe(0);
  expect(r.wraps, `${label} @${r.vw}: a name wraps onto a second line`).toBe(0);
  expect(r.small, `${label} @${r.vw}: controls under 44 px`).toEqual([]);
}

/** «Каталог» on the phone (1a, screen 10): its own two-line row — brand and name on top,
 *  the stock tag and the volumes under them from one x, the price at the right edge. */
async function catalogueShape(page: Page): Promise<void> {
  const vw = page.viewportSize()!.width;
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll("#goodslist .adm-grow[data-goodsrow]")).map((row) => {
    const b = (sel: string) => { const e = row.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    return { id: row.getAttribute("data-goodsrow") || "", row: (() => { const r = row.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })(), open: b(".adm-grow__open"), line: b(".adm-grow__line"), pr: b(".adm-grow__pr") };
  }));
  expect(rows.length, `Каталог @${vw}: fewer than two rows to compare`).toBeGreaterThan(1);
  const x = rows[0].line ? rows[0].line.left : NaN;
  for (const r of rows) {
    const who = `Каталог @${vw} · ${r.id}`;
    expect(r.open && r.line && r.pr, `${who}: a part of the row is missing`).toBeTruthy();
    expect(r.line!.top, `${who}: the tag line sits beside the name instead of under it`).toBeGreaterThanOrEqual(r.open!.bottom - 1);
    expect(Math.round(r.line!.left - x), `${who}: the tag line starts at another x than the first row's`).toBe(0);
    expect(r.pr!.right, `${who}: the price runs past the row`).toBeLessThanOrEqual(r.row.right + 0.5);
    expect(r.row.right, `${who}: the row runs past the screen`).toBeLessThanOrEqual(vw + 0.5);
  }
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

/**
 * «Заказы» has the 1a shape (design_handoff_admin_ux, screen 04), still one
 * shape on every row: the customer and the sum on the first line; the
 * number · day · what · where and the status tag on the second, the tag at
 * the row's right edge on every row; the step, when there is one — never
 * more than one — under both, the row's full width; nothing under 44 px,
 * nothing past the screen.
 */
async function orderShape(page: Page): Promise<void> {
  const vw = page.viewportSize()!.width;
  const rows = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
    };
    return Array.from(document.querySelectorAll("#orderlist .adm-orow")).map((row) => ({
      text: (row.querySelector(".adm-orow__who")?.textContent || "").trim(),
      row: box(row)!,
      who: box(row.querySelector(".adm-orow__who")),
      what: box(row.querySelector(".adm-orow__what")),
      tag: box(row.querySelector(":scope > .adm-orow__tag")),
      amt: box(row.querySelector(":scope > .adm-row__amt")),
      acts: box(row.querySelector(":scope > .adm-acts")),
      steps: row.querySelectorAll(":scope > .adm-acts button, :scope > .adm-acts a").length,
      small: Array.from(row.querySelectorAll<HTMLElement>(":scope > .adm-acts button, :scope > .adm-acts a"))
        .map((el) => ({ el, b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width && b.height && (b.width < 43.5 || b.height < 43.5))
        .map(({ el, b }) => `«${(el.textContent || "").trim()}» ${Math.round(b.width)}×${Math.round(b.height)}`),
    }));
  });
  expect(rows.length, `Заказы @${vw}: fewer than two rows to compare`).toBeGreaterThan(1);
  for (const r of rows) {
    const who = `Заказы @${vw} · «${r.text.slice(0, 32)}»`;
    expect(r.who!.height, `${who}: the name wraps onto a second line`).toBeLessThanOrEqual(24);
    expect(Math.abs(r.amt!.top - r.who!.top), `${who}: the sum is not on the first line`).toBeLessThanOrEqual(4);
    expect(Math.round(r.row.right - r.amt!.right), `${who}: the sum is not at the right edge`).toBe(0);
    expect(r.what!.top, `${who}: number · day · what is not the second line`).toBeGreaterThanOrEqual(r.who!.bottom - 1);
    expect(r.tag!.top, `${who}: the status tag is not on the second line`).toBeGreaterThanOrEqual(r.who!.bottom - 1);
    expect(Math.round(r.row.right - r.tag!.right), `${who}: the status tag is not at the right edge`).toBe(0);
    if (r.acts) {
      expect(r.acts.top, `${who}: the steps sit beside the lines instead of under them`)
        .toBeGreaterThanOrEqual(Math.max(r.tag!.bottom, r.what!.bottom) - 1);
      expect(Math.round(r.acts.left - r.row.left), `${who}: the steps do not start at the row's left edge`).toBe(0);
    }
    expect(r.steps, `${who}: more than one action on the row`).toBeLessThanOrEqual(1);
    expect(r.row.right, `${who}: the row runs past the screen`).toBeLessThanOrEqual(vw + 0.5);
    expect(r.small, `${who}: controls under 44 px`).toEqual([]);
  }
}

/**
 * «Письма» since 1a (README § 5): not the three-line row any more but the
 * design's own — the letter's name and what it does on the left, its switch
 * (or «›», or the pair's «вместе с первым») at the right edge. The same
 * promise as the other lists, measured on that shape: every row starts its
 * words at one x and ends its control at one x, nothing runs past the screen,
 * nothing is cut sideways, and every switch is a thumb's size.
 */
async function mailShape(page: Page): Promise<void> {
  const vw = page.viewportSize()!.width;
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll(".adm-mrow")).map((row) => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
    };
    const nm = row.querySelector(".adm-row__nm") as HTMLElement | null;
    const sw = row.querySelector(":scope > .adm-sw");
    return {
      text: (nm?.textContent || "").trim(),
      row: box(row)!,
      body: box(row.querySelector(":scope > .adm-row__body")),
      end: box(row.lastElementChild),
      sw: box(sw),
      cut: !!nm && nm.scrollWidth > nm.clientWidth + 1,
    };
  }));
  expect(rows.length, `Письма @${vw}: fewer than two rows to compare`).toBeGreaterThan(1);
  const x = rows[0].body ? rows[0].body.left : NaN;
  const endX = rows[0].end ? rows[0].end.right : NaN;
  for (const r of rows) {
    const who = `Письма @${vw} · «${r.text.slice(0, 32)}»`;
    expect(r.body, `${who}: the row has no text body`).not.toBeNull();
    expect(Math.round(r.body!.left - x), `${who}: the words start at another x than the first row's`).toBe(0);
    expect(Math.round(r.end!.right - endX), `${who}: the switch does not end where the first row's does`).toBe(0);
    expect(r.end!.left, `${who}: the switch sits under the words instead of beside them`).toBeGreaterThanOrEqual(r.body!.right - 1);
    expect(r.cut, `${who}: the name is cut off sideways`).toBe(false);
    expect(r.row.right, `${who}: the row runs past the screen`).toBeLessThanOrEqual(vw + 0.5);
    if (r.sw) expect(Math.min(r.sw.width, r.sw.height), `${who}: the switch is under 44 px`).toBeGreaterThanOrEqual(43.5);
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
        await orderShape(page);

        await adminSection(page, "goods");
        await page.locator('[data-admgoodstab="bundles"]').click();
        await expect(page.locator(`[data-bundleedit="${setId}"]`)).toBeVisible();
        await listShape(page, ".adm-setrow", ".adm-sw", ".adm-setrow .adm-row__nm", ".adm-link--move, .adm-sw", "Наборы");

        await page.locator('.adm-tab[data-admtab="goods"]').click();
        await expect(page.locator("#goodslist .adm-grow[data-goodsrow]").nth(1)).toBeVisible();
        await catalogueShape(page);

        await page.locator('.adm-tab[data-admtab="stock"]').click();
        await expect(page.locator("#stocklist .adm-stk__r").nth(1)).toBeVisible();
        await listShape(page, "#stocklist .adm-stk__r", ".adm-stk__q", "#stocklist .adm-stk__n", ".adm-stk__q button, .adm-stk__sz", "Склад");

        await adminSection(page, "blog");
        await expect(page.locator(`[data-admblogedit="${postId}"]`)).toBeVisible();
        await oneShape(page, "[data-admblogedit].adm-row--lines", "Блог");

        await adminSection(page, "promos", "mail");
        await expect(page.locator("[data-mailtpl]").first()).toBeVisible();
        // 1a: a letter is one row of its own shape — words left, switch right
        await mailShape(page);
      }
    } finally {
      await page.request.delete(`/api/admin/bundles/?id=${encodeURIComponent(setId)}`);
      await page.request.delete(`/api/admin/blog/?id=${encodeURIComponent(postId)}`);
    }
  });
});

/**
 * The whole row opens, except the controls on it.
 *
 * Renat, 12.09.2026, on «Заказы»: only the words of a row opened the order.
 * The row also carries a «Доставлен» (or «Создать этикетку»), and
 * everything from that button to the right edge answered nothing at all — on a
 * phone that is half of what a thumb lands on. Since round 15 the opener sits
 * on the row itself (`data-admrowopen`, app.js admRowOpenAttr) and the click
 * delegate hands a real button, link or field its own tap first.
 *
 * Phone only, because the dead patch is the phone's: on a desktop the same DOM
 * is one line and the actions end where the row does.
 */
test.describe("admin — a list row opens from anywhere but its buttons", () => {
  test.use({ extraHTTPHeaders: ipHeaders(232) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the dead patch is under the actions line, which only a phone draws");
  });

  test("«Заказы»: the chip and the sum open the order; the one step fills its line", async ({ page }) => {
    test.setTimeout(180_000);

    // one paid order, so the row has both its actions and something to open
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("rowtap"), "paid");

    await loginAsAdmin(page);
    await adminSection(page, "orders");
    await page.locator('[data-admfilter="all"]').click();
    const row = page.locator("#orderlist .adm-row--lines").filter({ hasText: number }).first();
    await expect(row).toBeVisible();
    // 1a: on a phone the card's «← Заказы» is the top bar's, drawn only while a card is open
    const card = page.locator("[data-admtopback]");

    /** Opens the card from `where`, then shuts it again with its own «←». */
    async function opensFrom(where: Locator, what: string, position?: { x: number; y: number }) {
      await where.click(position ? { position } : undefined);
      await expect(card, `${what} did not open the order`).toBeVisible();
      await card.click();                       // «← Заказы»
      await expect(card).toHaveCount(0);
      await expect(row).toBeVisible();
    }

    await opensFrom(row.locator(".adm-row__line"), "the chip line");
    await opensFrom(row.locator(".adm-row__amt"), "the sum");

    /* the blank after the last action — the patch the owner reported. 1a has
       ONE action per row, and a lone action takes the whole line (admin.css
       .adm-row--lines > .adm-acts > .adm-btn:only-child), so there is no
       blank left beside it to land in by mistake. */
    const acts = row.locator(".adm-acts");
    await expect(acts).toBeVisible();
    await expect(acts.locator("button, a"), "a row carries more than one action").toHaveCount(1);
    const step = row.locator("[data-admlabel]");
    const box = (await acts.boundingBox())!;
    const btn = (await step.boundingBox())!;
    expect(Math.round(box.width - btn.width), "the lone step leaves a dead patch beside it").toBeLessThanOrEqual(1);

    /* …and the action itself is still the action: the tap asks for the label.
       (It then shows the card on purpose — the label, the box and the PDF are
       there; the click handler sets S.adminOrder. The request is stopped at
       the network, so no label is made.) */
    const labelUrl = (u: URL) => u.pathname.startsWith("/api/admin/shipments");
    await page.route(labelUrl, (r) => r.abort());
    const asked = page.waitForRequest((r) => r.url().includes("/api/admin/shipments") && r.method() === "POST");
    await step.click();
    await asked;
    await page.unroute(labelUrl);
  });

  test("«Письма»: the blank beside the switch opens the letter", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    await adminSection(page, "promos", "mail");

    const sw = page.locator('[data-admflow="backstock"]');
    const row = page.locator(".adm-row--open").filter({ has: sw }).first();
    await expect(row).toBeVisible();
    const was = await sw.getAttribute("aria-checked");
    /* 1a: the letter's words and its switch on one row. The row's own
       padding above the switch belonged to nobody — it opens the letter */
    const box = (await row.boundingBox())!;
    const swBox = (await sw.boundingBox())!;
    await row.click({ position: { x: swBox.x - box.x - 8, y: 4 } });
    // (on a phone the letter's way back is the top bar's «← Все письма» — fixtures.cardBack)
    await expect(cardBack(page, "[data-mailback]", "Все письма"), "the gap on the letter's row opened nothing").toBeVisible();
    await cardBack(page, "[data-mailback]", "Все письма").click();
    // …and the letter itself was not switched on the way in
    await expect(sw).toBeVisible();
    await expect(sw, "the gap flipped the letter's switch").toHaveAttribute("aria-checked", was ?? "false");
  });
});
