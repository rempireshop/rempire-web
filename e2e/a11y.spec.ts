import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test, type TestInfo } from "@playwright/test";
import {
  continueButton, freshEmail, ipHeaders, LANGS, loginAsAdmin, payOrder, PRODUCT, PRODUCT_2, shopUrl, waitForScreen,
} from "./fixtures";

/**
 * Accessibility sweep — axe-core (WCAG 2.x A/AA + axe's best-practice rules,
 * which is where the landmark, heading-order and duplicate-id checks live)
 * over every storefront screen in the three languages, and over every admin
 * section signed in. Desktop AND mobile: the phone has its own header, its
 * own bottom bar and its own sheets (docs/design/admin-handoff-README.md).
 *
 * Serious and critical violations fail the test; moderate and minor ones are
 * printed (and attached as JSON) so they stay visible without blocking. Each
 * test walks several screens and asserts ONCE at the end, so a single run
 * reports every screen's problems instead of stopping at the first.
 *
 * e2e/accessibility.spec.ts is the older five-screen smoke; this file is the
 * full sweep. Both run — the smoke is cheap.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "a11y sweep — desktop and mobile projects only, see docs/testing.md");
});
// intro() (app.js) — the once-per-session logo splash — skips itself under
// prefers-reduced-motion; without this whether axe catches it mid-animation
// is timing luck, not a finding (see accessibility.spec.ts).
test.use({ contextOptions: { reducedMotion: "reduce" } });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
const FAIL_ON: Array<string | null | undefined> = ["serious", "critical"];

type Finding = { screen: string; id: string; impact: string; help: string; count: number; nodes: string[] };

/** Accumulates axe results over a test's screens; `done()` asserts once. */
class Audit {
  blocking: Finding[] = [];
  seen = 0;
  constructor(private readonly testInfo: TestInfo) {}

  async check(page: Page, screen: string): Promise<void> {
    this.seen++;
    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      // WCAG 2.5.3 «Label in Name» — off by default in axe (experimental), on
      // in Lighthouse; it is what caught the card buttons whose aria-label
      // hid their visible text, so it stays on here too
      .options({ rules: { "label-content-name-mismatch": { enabled: true } } })
      .analyze();
    await this.testInfo.attach(`axe-${screen.replace(/[^\w.-]+/g, "_")}.json`, {
      body: JSON.stringify(
        results.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help,
          nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 200) })),
        })),
        null, 2,
      ),
      contentType: "application/json",
    });
    for (const v of results.violations) {
      const f: Finding = {
        screen, id: v.id, impact: v.impact ?? "n/a", help: v.help, count: v.nodes.length,
        nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} — ${n.html.replace(/\s+/g, " ").slice(0, 140)}`),
      };
      if (FAIL_ON.includes(v.impact)) this.blocking.push(f);
      else console.log(`[a11y:${screen}] ${f.impact}: ${f.id} — ${f.help} (${f.count} node${f.count === 1 ? "" : "s"}) e.g. ${f.nodes[0]}`);
    }
  }

  done(): void {
    const report = this.blocking
      .map((f) => `${f.screen}: ${f.id} (${f.impact}) ${f.help} — ${f.count} node${f.count === 1 ? "" : "s"}\n    ${f.nodes.join("\n    ")}`)
      .join("\n");
    expect(this.seen, "the sweep checked no screen at all").toBeGreaterThan(0);
    expect(report, "serious/critical axe violations").toBe("");
  }
}

/** The cart control this viewport shows — the header icon on a desktop, the
 *  bottom bar's «Корзина» on a phone (both carry data-cart). */
function cartButton(page: Page) {
  return page.locator("[data-cart]:visible").first();
}

/** Opens the first product card's size listbox on the current screen, if the
 *  screen has a multi-size card at all. */
async function openSizeListbox(page: Page): Promise<boolean> {
  const opener = page.locator("[data-cardsizeopen]").first();
  if (!(await opener.count())) return false;
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  await expect(page.locator("[data-cardpop]")).toBeVisible();
  return true;
}

for (const [i, lang] of LANGS.entries()) {
  test.describe(`a11y storefront — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(140 + i) });

    test("home, category (+ size listbox), search", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const audit = new Audit(testInfo);

      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");
      await expect(page.locator(".card").first()).toBeVisible();
      await audit.check(page, `home ${lang.code}`);

      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");
      await expect(page.locator(".card").first()).toBeVisible();
      await audit.check(page, `category ${lang.code}`);
      if (await openSizeListbox(page)) {
        await audit.check(page, `category + size listbox ${lang.code}`);
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-cardpop]")).toHaveCount(0);
      }

      await page.goto(shopUrl(lang.seg, "/search/?q=System"));
      await waitForScreen(page, "search");
      await expect(page.locator(".card").first()).toBeVisible();
      await audit.check(page, `search ${lang.code}`);

      audit.done();
    });

    test("product page (+ size listbox), cart drawer", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const audit = new Audit(testInfo);

      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await expect(page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`)).toBeVisible();
      await audit.check(page, `product ${lang.code}`);
      if (await openSizeListbox(page)) {
        await audit.check(page, `product + size listbox ${lang.code}`);
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-cardpop]")).toHaveCount(0);
      }

      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await cartButton(page).click();
      await expect(page.locator(".drawer--right")).toBeVisible();
      await audit.check(page, `cart drawer ${lang.code}`);
      // Escape closes it and focus goes back to the control that opened it
      await page.keyboard.press("Escape");
      await expect(page.locator(".drawer--right")).toHaveCount(0);

      audit.done();
    });

    test("checkout steps 1–3", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const audit = new Audit(testInfo);

      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl(lang.seg, "/checkout/"));
      await waitForScreen(page, "checkout");
      await expect(page.locator("[data-email]")).toBeVisible();
      await audit.check(page, `checkout 1 ${lang.code}`);

      await page.locator("[data-email]").fill(freshEmail(`a11y-${lang.code}`));
      await continueButton(page, 2).click();
      await expect(page.locator('input[data-dm="courier"]')).toBeVisible();
      await page.locator('input[data-dm="courier"]').check();
      await expect(page.locator('[data-shipf="addr"]')).toBeVisible();
      await audit.check(page, `checkout 2 ${lang.code}`);

      await page.locator('[data-shipf="name"]').fill("E2E Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await continueButton(page, 3).click();
      await expect(page.locator('input[data-paym="1"]')).toBeVisible();
      await page.locator('input[data-paym="1"]').check();
      // the summary column's pay button on a desktop, the sticky bar's on a phone
      await expect(page.locator("[data-pay]:visible").first()).toBeVisible();
      await audit.check(page, `checkout 3 ${lang.code}`);

      audit.done();
    });

    test("account login, blog list + post, sets, gift card", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const audit = new Audit(testInfo);

      await page.goto(shopUrl(lang.seg, "/account/"));
      await waitForScreen(page, "account");
      await expect(page.locator("[data-email]")).toBeVisible();
      await audit.check(page, `account login ${lang.code}`);

      await page.goto(shopUrl(lang.seg, "/blog/"));
      await waitForScreen(page, "blog");
      // migration 071_blog_samples.sql — three published posts; wait for the
      // real tiles, not the skeleton
      await expect(page.locator(".blog__tile").first()).toBeVisible();
      await audit.check(page, `blog list ${lang.code}`);

      await page.locator(".blog__tile").first().click();
      await waitForScreen(page, "blogpost");
      await expect(page.locator(".blog__read[aria-busy='true']")).toHaveCount(0);
      await expect(page.locator(".blog__body").first()).toBeVisible();
      await audit.check(page, `blog post ${lang.code}`);

      await page.goto(shopUrl(lang.seg, "/sets/"));
      await waitForScreen(page, "bundles");
      await audit.check(page, `sets ${lang.code}`);

      await page.goto(shopUrl(lang.seg, "/gift/"));
      await waitForScreen(page, "gift");
      await audit.check(page, `gift ${lang.code}`);

      audit.done();
    });
  });
}

/** The six sections behind «Ещё» on a phone (ADM_MORE in app.js). */
const MORE = ["people", "promos", "blog", "stats", "apps", "setup"];

test.describe("a11y admin", () => {
  test.use({ extraHTTPHeaders: ipHeaders(145) });

  test("every section, an order card, the editor's five tabs, a settings page", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const mobile = testInfo.project.name === "mobile";
    const audit = new Audit(testInfo);

    /** A section by its nav item — behind «Ещё» on a phone for six of them. */
    async function section(key: string, title: RegExp): Promise<void> {
      const open = await page.locator(`[data-admtab="${key}"][aria-current="true"]:visible`).count();
      if (!open) {
        if (mobile && MORE.includes(key)) await page.locator("[data-admmore]").click();
        await page.locator(`[data-admtab="${key}"][aria-current]:visible`).first().click();
      }
      await expect(page.locator("h1.adm-h1").first()).toHaveText(title);
      // let the section's own fetch land and paint (each route compiles on
      // its first hit under `next dev`) — networkidle never settles here
      await page.waitForTimeout(600);
    }

    // a real paid order, so «Заказы» has a card to open
    await page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("a11y-admin"), "paid");

    await page.goto(shopUrl("", "/admin/"));
    await expect(page.locator("[data-admpw]")).toBeVisible();
    await audit.check(page, "admin login");
    await loginAsAdmin(page);

    await section("over", /Обзор/);
    await audit.check(page, "admin Обзор");

    await section("orders", /Заказы/);
    await expect(page.locator("#orderlist")).toBeVisible();
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();
    await audit.check(page, "admin Заказы");
    // the confirm card over the list
    await page.locator("[data-admshipnow]").first().click();
    await expect(page.locator(".adm-confirm")).toBeVisible();
    await audit.check(page, "admin confirm card");
    await page.locator("[data-admcancel]").click();
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    // an order card
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator('[data-admorder=""]')).toBeVisible();
    await audit.check(page, "admin order card");
    await page.locator('[data-admorder=""]').click();

    await section("goods", /Товары/);
    await expect(page.locator("#goodslist")).toBeVisible();
    await audit.check(page, "admin Товары");
    await page.locator("[data-goodsq]").fill(PRODUCT_2.id);
    await page.locator(`[data-admgoods="${PRODUCT_2.id}"]`).click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    for (const tab of ["main", "sizes", "media", "desc", "seo"]) {
      await page.locator(`[data-edtab="${tab}"]`).click();
      await expect(page.locator(`[data-edpane="${tab}"]`)).toBeVisible();
      await audit.check(page, `admin editor · ${tab}`);
    }
    await page.locator("[data-admclose]").first().click();

    await section("pos", /Продажа в салоне/);
    await expect(page.locator("[data-posq]")).toBeVisible();
    await audit.check(page, "admin Салон");

    if (mobile) {
      await page.locator("[data-admmore]").click();
      await expect(page.locator(".adm-sheet")).toBeVisible();
      await audit.check(page, "admin «Ещё» sheet");
      await page.locator("[data-admmoreclose]").click({ position: { x: 20, y: 20 } });
      await expect(page.locator(".adm-sheet")).toHaveCount(0);
    }

    await section("people", /Клиенты/);
    await audit.check(page, "admin Клиенты");
    await section("promos", /Маркетинг/);
    await audit.check(page, "admin Маркетинг");
    await section("blog", /Блог/);
    await audit.check(page, "admin Блог");
    await section("stats", /Аналитика/);
    await audit.check(page, "admin Аналитика");
    await section("apps", /Подключения/);
    await audit.check(page, "admin Подключения");
    await section("setup", /Настройки/);
    await audit.check(page, "admin Настройки");
    await page.locator('[data-admsetpage="home"]').click();
    await expect(page.locator("[data-admsetback]")).toBeVisible();
    await page.waitForTimeout(600);
    await audit.check(page, "admin Настройки · Главная");

    // the assistant panel
    await page.locator(".adm-fab").click();
    await expect(page.locator(".adm-asst")).toBeVisible();
    await audit.check(page, "admin assistant");
    await page.locator(".adm-asst__fold").click();

    audit.done();
  });
});
