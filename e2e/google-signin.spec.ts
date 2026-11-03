import { expect, test, type Page } from "@playwright/test";
import { freshEmail, functionalProject, ipHeaders, LANGS, PRODUCT, shopUrl, waitForScreen, type LangCode } from "./fixtures";

/**
 * «Продолжить с Google» as the shopper sees it (src/lib/google-signin.ts,
 * public/shop2/app.js googleBtnHTML — Dim's design of 02.11.2026).
 *
 * This server runs with no GOOGLE_CLIENT_ID (playwright.config.ts clears it),
 * so the first describe is the shop as it is today: no button anywhere, both
 * routes 404. The rest turn the STOREFRONT half on the one way a deployment
 * does — /api/overrides/ saying `google_signin: true` — by answering that one
 * key on the real feed; everything else on the page is the real server.
 * Google itself is never reached: the start route is held or refused before
 * the browser could leave. The server half (the token, the state cookie, the
 * account) is tests/google-signin.test.ts.
 */

const LABEL: Record<LangCode, string> = { RU: "Продолжить с Google", ET: "Jätka Google'iga", EN: "Continue with Google" };
const CO_LABEL: Record<LangCode, string> = {
  RU: "Продолжить с Google — заполнит имя и e-mail",
  ET: "Jätka Google'iga — täidab nime ja e-posti",
  EN: "Continue with Google — fills name and e-mail",
};
const DIVIDER: Record<LangCode, string> = { RU: "или кодом на почту", ET: "või koodiga e-postile", EN: "or with an e-mail code" };

const FEED = /\/api\/overrides\/?(\?.*)?$/;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" || !functionalProject(testInfo), "functional spec — desktop project, see docs/testing.md");
});
/* A test can end with googleOn()'s handler still fetching — the checkout asks
   the feed twice (loadShipRules, loadServerOverrides) and the last assertion
   needs only the first. Closing the page then disposes that response under
   the handler, and «Response has been disposed» failed a test whose every
   check had passed (CI full run, 03.11.2026). */
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** The feed as a deployment with a Google client answers it — the real answer, plus the one flag. */
async function googleOn(page: Page): Promise<void> {
  await page.route(FEED, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { settings?: Record<string, unknown> };
    if (body && body.settings) body.settings.google_signin = true;
    await route.fulfill({ response: res, json: body });
  });
}

/** Opens a screen and waits until the feed has answered, so «no button» cannot mean «not drawn yet». */
async function open(page: Page, url: string, screen: string): Promise<void> {
  const fed = page.waitForResponse((r) => FEED.test(new URL(r.url()).pathname) && r.request().method() === "GET");
  await page.goto(url);
  await waitForScreen(page, screen);
  await fed;
}

async function fillBasket(page: Page): Promise<void> {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
}

const startHref = (ret: string) => `/api/account/google/start?return=${encodeURIComponent(ret)}`;

test.describe("«Продолжить с Google» — off without GOOGLE_CLIENT_ID", () => {
  test.use({ extraHTTPHeaders: ipHeaders(245) });

  test("draws no button on «Кабинет» or at the checkout, and both routes answer 404", async ({ page }) => {
    const feed = (await (await page.request.get("/api/overrides/")).json()) as { settings: Record<string, unknown> };
    expect(feed.settings.google_signin).toBe(false);
    expect((await page.request.get("/api/account/google/start?return=/ru/account", { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.post("/api/account/google/callback", { form: { state: "x", id_token: "y" }, maxRedirects: 0 })).status()).toBe(404);

    await open(page, shopUrl("", "/account/"), "account");
    await expect(page.locator("[data-login]")).toBeVisible();
    await expect(page.locator("[data-gsignin]")).toHaveCount(0);
    await expect(page.locator(".orline")).toHaveCount(0);
    await expect(page.locator(".gnote")).toHaveCount(0);

    await fillBasket(page);
    await open(page, shopUrl("", "/checkout/"), "checkout");
    await expect(page.locator("[data-email]")).toBeVisible();
    await expect(page.locator("[data-co-google]")).toBeAttached();
    await expect(page.locator("[data-gsignin]")).toHaveCount(0);
  });
});

test.describe("«Продолжить с Google» — on", () => {
  test.use({ extraHTTPHeaders: ipHeaders(246) });

  test("«Кабинет»: the button first, the divider, the e-mail form, the note — in every language", async ({ page }) => {
    await googleOn(page);
    for (const lang of LANGS) {
      await open(page, shopUrl(lang.seg, "/account/"), "account");
      const btn = page.locator("a[data-gsignin]");
      await expect(btn).toHaveCount(1);
      await expect(btn).toBeVisible();
      await expect(btn).toHaveText(LABEL[lang.code]);
      await expect(btn).toHaveAttribute("href", startHref(shopUrl(lang.seg, "/account/")));
      await expect(page.locator(".orline")).toHaveText(DIVIDER[lang.code]);
      // the order Login.dc.html draws: button, divider, e-mail, «Получить код», note
      const order = await page.evaluate(() => {
        const at = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? Array.prototype.indexOf.call(document.querySelectorAll("a[data-gsignin], .orline, [data-email], [data-login], .gnote"), el) : -1;
        };
        return [at("a[data-gsignin]"), at(".orline"), at("[data-email]"), at("[data-login]"), at(".gnote")];
      });
      expect(order).toEqual([0, 1, 2, 3, 4]);
      // Google's light button, by its own rules
      /* Read in the page, on the button that is there at that moment: the
         shop redraws «Кабинет» when late data lands (the banner feed, the
         session answer), and a node read across that redraw is detached —
         every computed value comes back "" (release run, 02.11.2026). */
      const readLook = () => page.evaluate(() => {
        const el = document.querySelector("a[data-gsignin]");
        if (!el || !el.isConnected) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth, radius: cs.borderTopLeftRadius, color: cs.color, weight: cs.fontWeight, h: el.getBoundingClientRect().height, font: cs.fontFamily };
      });
      await expect.poll(readLook).toMatchObject({ bg: "rgb(255, 255, 255)", border: "rgb(116, 119, 117)", bw: "1px", radius: "4px", color: "rgb(31, 31, 31)", weight: "500" });
      const look = (await readLook())!;
      expect(look.h).toBeGreaterThanOrEqual(52);
      expect(look.font).toMatch(/^Roboto, Arial, sans-serif$/);
      await expect(btn.locator("svg path")).toHaveCount(4);
    }
  });

  test("the tap greys the button, says «Открываем Google…» and asks the start route for this page", async ({ page }) => {
    await googleOn(page);
    const asked: string[] = [];
    await page.route(/\/api\/account\/google\/start/, async (route) => {
      asked.push(route.request().url());
      // 204: the browser stays on this page, as it does while Google's page loads
      await route.fulfill({ status: 204, body: "" });
    });
    await open(page, shopUrl("", "/account/"), "account");
    await expect(page.locator("a[data-gsignin]")).toBeVisible();
    /* Two taps in one go, read back before the browser has left: Playwright's
       own locators wait for a navigation in flight to finish, which is exactly
       the moment this state exists for. */
    const after = await page.evaluate(() => {
      const a = document.querySelector("a[data-gsignin]") as HTMLElement;
      a.click();
      a.click();
      return { disabled: a.getAttribute("aria-disabled"), text: (a.textContent || "").trim(), spin: !!a.querySelector(".gbtn__spin") };
    });
    expect(after).toEqual({ disabled: "true", text: "Открываем Google…", spin: true });
    // grey (after its .18 s transition)
    await expect.poll(() => page.locator("a[data-gsignin]").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(243, 243, 243)");
    await expect.poll(() => asked.length).toBe(1);
    expect(new URL(asked[0]).searchParams.get("return")).toBe("/ru/account");
    // the second tap started nothing
    await page.waitForTimeout(300);
    expect(asked).toHaveLength(1);
  });

  test("a cancelled sign-in comes back to the alert, and the flag leaves the address", async ({ page }) => {
    await googleOn(page);
    await open(page, shopUrl("", "/account/") + "?google=cancel", "account");
    await expect(page.locator(".galert")).toHaveText("Вход через Google отменён. Попробуйте ещё раз или получите код на почту ниже.");
    await expect(page.locator("a[data-gsignin]")).toBeVisible();
    expect(new URL(page.url()).search).toBe("");

    await fillBasket(page);
    await open(page, shopUrl("/en", "/checkout/") + "?google=cancel", "checkout");
    await expect(page.locator("[data-co-google] .galert")).toHaveText("Google sign-in was cancelled. Try again, or type your e-mail below.");
    expect(new URL(page.url()).search).toBe("");
  });

  test("the checkout's contact step offers it to a shopper who is not signed in, in every language", async ({ page }) => {
    await googleOn(page);
    await fillBasket(page);
    /* The profile ask answers 401 on every visit of a shopper who is not
       signed in. That answer used to redraw the slot regardless, swapping the
       button for an identical node a moment after the first paint — a measure
       taken across the swap came back null (CI full run, 03.11.2026). It is
       held here until the button on screen is marked, then let through: the
       mark must still be on the button after it. */
    const ME = /\/api\/account\/me\/?(\?.*)?$/;
    let letMeThrough = () => {};
    let meGate = Promise.resolve();
    await page.route(ME, async (route) => { await meGate; await route.continue(); });
    for (const lang of LANGS) {
      meGate = new Promise<void>((r) => { letMeThrough = r; });
      const me = page.waitForResponse((r) => ME.test(r.url()));
      await open(page, shopUrl(lang.seg, "/checkout/"), "checkout");
      const btn = page.locator("[data-co-google] a[data-gsignin]");
      await expect(btn).toBeVisible();
      await btn.evaluate((el) => { (el as HTMLElement & { __e2eTag?: string }).__e2eTag = "first"; });
      letMeThrough();
      expect((await me).status()).toBe(401);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await page.evaluate(() => (document.querySelector("[data-co-google] a[data-gsignin]") as (HTMLElement & { __e2eTag?: string }) | null)?.__e2eTag),
        "the signed-out answer redrew the button").toBe("first");
      await expect(btn).toHaveText(CO_LABEL[lang.code]);
      await expect(btn).toHaveAttribute("href", startHref(shopUrl(lang.seg, "/checkout/")));
      // above the order's own e-mail box
      const above = await page.evaluate(() => {
        const b = document.querySelector("[data-co-google] a[data-gsignin]");
        const e = document.querySelector("[data-email]");
        return !!b && !!e && !!(b.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(above).toBe(true);
      expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
  });
});

test.describe("«Продолжить с Google» — signed in", () => {
  test.use({ extraHTTPHeaders: ipHeaders(249) });

  test("no button for a signed-in shopper; «Вы вошли как …» after the way back; the button again after «Выйти»", async ({ page }) => {
    test.setTimeout(90_000);
    await googleOn(page);
    const email = freshEmail("google-on");

    // signed in the old way — the code (the Google way ends in the same session, tests/google-signin.test.ts)
    await open(page, shopUrl("", "/account/"), "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const { code } = (await (await codeResponse).json()) as { code?: string };
    expect(code).toMatch(/^\d{6}$/);
    await page.locator("[data-acctcode]").fill(code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();
    await expect(page.locator("[data-gsignin]")).toHaveCount(0);

    await fillBasket(page);
    await open(page, shopUrl("", "/checkout/"), "checkout");
    await expect(page.locator("[data-email]")).toHaveValue(email);
    await expect(page.locator("[data-gsignin]")).toHaveCount(0);

    // what the callback's 303 lands on: the same checkout step, the basket and the address in place
    await open(page, shopUrl("", "/checkout/") + "?google=ok", "checkout");
    const ok = page.locator("[data-co-google] .gok");
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("Вы вошли как");
    await expect(ok.locator("strong")).toHaveText(email);
    await expect(page.locator("[data-email]")).toHaveValue(email);
    await expect(page.locator("[data-gsignin]")).toHaveCount(0);
    // the screen itself is the basket's proof: /checkout with an empty one is the home page
    expect(new URL(page.url()).search).toBe("");

    await open(page, shopUrl("", "/account/") + "?google=ok", "account");
    await expect(page.locator(".gok strong")).toHaveText(email);

    // «Выйти»: the line goes, the button comes back
    await page.locator("[data-logout]").click();
    await expect(page.locator("[data-login]")).toBeVisible();
    await expect(page.locator(".gok")).toHaveCount(0);
    await expect(page.locator("a[data-gsignin]")).toBeVisible();
  });
});
