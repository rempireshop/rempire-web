import { expect, test, type Locator, type Page } from "@playwright/test";
import { continueButton, freshEmail, functionalProject, ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * The account's settings, all the way to the checkout — the two things Renat
 * found missing at his own checkout on 10.09.2026 (signed in, subscribed, a
 * default delivery set): «Хочу получать скидки и поздравление ко дню рождения» unticked and no
 * delivery preselected — and the way the form saves since 12.09.2026: no
 * «Сохранить» anywhere (the bar that replaced the button was covered by the
 * phone's keyboard exactly while a field was being typed into), every field
 * saves itself when it is left and says so on the line under it — app.js
 * «the profile form: every field saves itself».
 *
 * Same login mechanics as account.spec.ts: E2E_EXPOSE_LOGIN_CODE=1 rides the
 * six-digit code along in the /api/account/code response (docs/testing.md),
 * and the spec types it where a person would.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(shopUrl("", "/account/"));
  await waitForScreen(page, "account");
  await page.locator("[data-email]").fill(email);
  const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
  await page.locator("[data-login]").click();
  const body = (await (await codeResponse).json()) as { code?: string };
  expect(body.code, "the e2e login-code hook did not answer").toMatch(/^\d{6}$/);
  await page.locator("[data-acctcode]").fill(body.code!);
  await page.locator("[data-logincode]").click();
  await expect(page.locator("[data-logout]")).toBeVisible();
}

type Profile = {
  phone: string;
  birthday: string | null;
  marketing: boolean;
  shipPref: null | { country: string; method: string; carrier: string; machine: string };
};

/** What the server holds for the signed-in address — page.request shares the context's cookie jar. */
async function profile(page: Page): Promise<Profile> {
  const res = await page.request.get("/api/account/me/");
  expect(res.ok(), "GET /api/account/me/ refused the signed-in shopper").toBe(true);
  return ((await res.json()) as { customer: Profile }).customer;
}

/** The line under a control — «Сохраняем…», «Сохранено ✓», a refusal — app.js acctStHTML. */
function line(page: Page, field: string): Locator {
  return page.locator(`[data-acctst="${field}"]`);
}

/** Every PATCH the form sends from here on, as its parsed body. */
function patches(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/account/me/")) sent.push(JSON.parse(r.postData() || "{}"));
  });
  return sent;
}

/** A text field is saved when it is left: fill it, then leave it. `fill` alone
 *  fires no `change` (WebKit's date box is a plain text box in this suite,
 *  and a text field only changes on blur or Enter) — exactly what a person
 *  does after typing. */
async function leave(box: Locator, value: string): Promise<void> {
  await box.fill(value);
  await box.blur();
}

test.describe("account — the settings reach the checkout", () => {
  test.use({ extraHTTPHeaders: ipHeaders(56) });

  test("newsletter consent and the default delivery are what the checkout starts on", async ({ page }) => {
    const email = freshEmail("acct-settings");
    await signIn(page, email);
    const tick = line(page, "marketing");
    const ship = line(page, "ship");
    // a fresh account: nothing has been touched, every line is quiet
    await expect(tick).toHaveText("");
    await expect(ship).toHaveText("");

    // the newsletter tick saves the moment it is ticked, and says so under itself
    await page.locator("[data-acctmk]").check();
    await expect(tick).toHaveText("Сохранено ✓");
    expect((await profile(page)).marketing).toBe(true);

    // a row with nothing more to choose saves at once…
    await page.locator(".optlist .opt").filter({ hasText: "Самовывоз" }).first().locator("input[data-acctm]").check();
    await expect(ship).toHaveText("Доставка по умолчанию сохранена ✓");
    expect((await profile(page)).shipPref).toEqual({ country: "EE", method: "pickup", carrier: "", machine: "" });

    // …a parcel row waits for its machine, and says what it is waiting for
    const row = page.locator(".optlist .opt").filter({ hasText: "Пакомат Omniva" }).first();
    const feed = page.waitForResponse((r) => r.url().includes("/api/shipping/points/") && r.url().includes("carrier=omniva"));
    await row.locator("input[data-acctm]").check();
    await expect(ship).toHaveText("Выберите пакомат — тогда сохраним");
    await feed;
    const machines = page.locator("[data-acctmachine]");
    await expect(machines).toBeEnabled();
    await expect.poll(async () => (await machines.locator("option").count())).toBeGreaterThan(1);
    // the pickup row is still what the server holds until the machine is picked
    expect((await profile(page)).shipPref?.method).toBe("pickup");
    // index 0 is the placeholder: a machine is chosen, never assumed — and its pick is the save
    await machines.selectOption({ index: 1 });
    const machine = (await machines.inputValue()).trim();
    expect(machine.length, "no parcel machine offered in the account").toBeGreaterThan(0);
    await expect(ship).toHaveText("Доставка по умолчанию сохранена ✓");

    // the server really holds both
    const stored = await profile(page);
    expect(stored.marketing).toBe(true);
    expect(stored.shipPref).toEqual({ country: "EE", method: "parcel", carrier: "omniva", machine });

    // …and the checkout starts on them
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await expect(page.locator("[data-news]"), "the account's consent never reached the checkout's box").toBeChecked();
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();
    await expect(page.locator('input[data-dm="parcel"]')).toBeChecked();
    await expect(page.locator('[data-carrier="omniva"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-pointopen]")).toContainText(machine);

    // the shopper's own hand still wins over the stored default, in this session
    await page.locator('input[data-dm="courier"]').check();
    await expect(page.locator('input[data-dm="courier"]')).toBeChecked();
  });
});

test.describe("account — every field saves itself", () => {
  test.use({ extraHTTPHeaders: ipHeaders(59) });

  test("a birthday saves when the field is left: «Сохраняем…», then «Сохранено ✓», then quiet", async ({ page }) => {
    const email = freshEmail("acct-birthday");
    await signIn(page, email);
    const birthday = page.locator('[data-acctf="birthday"]');
    const status = line(page, "birthday");
    await expect(status).toHaveText("");
    expect(await page.locator("[data-save], .acctbar").count(), "a Save button or bar is back on the form").toBe(0);

    /* Hold the first PATCH for a moment, so «Сохраняем…» stays on screen long
       enough to be read — against a local server it would be gone in 50 ms. */
    let held = false;
    await page.route("**/api/account/me/", async (route) => {
      if (route.request().method() !== "PATCH" || held) return route.continue();
      held = true;
      await new Promise((r) => setTimeout(r, 800));
      return route.continue();
    });
    const sent = patches(page);
    await leave(birthday, "1990-04-17");
    await expect(status).toHaveText("Сохраняем…");
    await expect(status).toHaveText("Сохранено ✓");
    await expect(status).toHaveClass(/acctst--ok/);
    expect((await profile(page)).birthday).toBe("1990-04-17");
    // one request, this field only — the whole form is never re-sent
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ birthday: "1990-04-17" });
    expect(sent[0]).not.toHaveProperty("name");
    // …and the line goes quiet on its own
    await expect(status).toHaveText("", { timeout: 6_000 });

    // the same value back is not a change — no request leaves; another one is
    await leave(birthday, "1990-04-17");
    await leave(birthday, "1991-05-18");
    await expect(status).toHaveText("Сохранено ✓");
    expect(sent.map((p) => p.birthday)).toEqual(["1990-04-17", "1991-05-18"]);

    // a reload shows what is stored, with nothing pending
    await page.reload();
    await waitForScreen(page, "account");
    await expect(page.locator('[data-acctf="birthday"]')).toHaveValue("1991-05-18");
    await expect(line(page, "birthday")).toHaveText("");
  });
});

test.describe("account — the newsletter tick", () => {
  // its own address: /api/account/code/ allows a few codes per IP, and every
  // test here signs in once per project
  test.use({ extraHTTPHeaders: ipHeaders(60) });

  test("the newsletter tick saves on change, both ways", async ({ page }) => {
    const email = freshEmail("acct-tick");
    await signIn(page, email);
    const box = page.locator("[data-acctmk]");
    const status = line(page, "marketing");
    const sent = patches(page);

    await box.check();
    await expect(status).toHaveText("Сохранено ✓");
    expect((await profile(page)).marketing).toBe(true);

    await box.uncheck();
    await expect(status).toHaveText("Сохранено ✓");
    await expect.poll(async () => (await profile(page)).marketing).toBe(false);
    // one request per change, the tick alone in each
    expect(sent.map((p) => p.marketing)).toEqual([true, false]);
    for (const p of sent) expect(p).not.toHaveProperty("shipPref");
  });
});

test.describe("account — a refused phone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(58) });

  test("too few digits, or a server that says no: the line says why and the number on the row stays", async ({ page }) => {
    const email = freshEmail("acct-phone");
    await signIn(page, email);
    const phone = page.locator('[data-acctf="phone"]');
    const status = line(page, "phone");

    await leave(phone, "+372 5550001");
    await expect(status).toHaveText("Сохранено ✓");
    expect((await profile(page)).phone).toBe("+372 5550001");

    // too few digits: refused before it leaves, in the checkout's own words
    const sent = patches(page);
    await leave(phone, "+372 12");
    await expect(status).toHaveText("Проверьте номер — похоже, в нём не хватает цифр.");
    await expect(status).toHaveClass(/acctst--err/);
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([]);
    expect((await profile(page)).phone).toBe("+372 5550001");

    // the server saying no: the line carries its words, the row keeps its number
    await page.route("**/api/account/me/", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable" }) })
        : route.continue(),
    );
    await leave(phone, "+372 5550002");
    await expect(status).toHaveText("Магазин временно недоступен — попробуйте позже");
    await expect(status).toHaveClass(/acctst--err/);
    expect((await profile(page)).phone).toBe("+372 5550001");

    // typing again takes the refusal off the line; leaving the field tries
    // again — and this time the server is back
    await page.unroute("**/api/account/me/");
    await phone.fill("+372 5550003");
    await expect(status).toHaveText("");
    await expect(phone).not.toHaveAttribute("aria-invalid", "true");
    await phone.blur();
    await expect(status).toHaveText("Сохранено ✓");
    expect((await profile(page)).phone).toBe("+372 5550003");
  });
});
