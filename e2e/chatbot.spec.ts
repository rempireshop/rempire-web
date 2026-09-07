import { expect, test } from "@playwright/test";
import { ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * Chatbot widget (public/shop2/chat.js). Desktop only, single run — see
 * docs/testing.md. The suite runs with OPENAI_API_KEY empty (playwright.config
 * .ts) specifically so this spec exercises the real "no key" path.
 *
 * chat.js's own client-side probeAI() (GET /api/assistant/) sets
 * aiEnabled=false before reply() is ever called, so with no key the widget
 * NEVER calls the POST route that would 503 — it falls back to its
 * rule-based catalogue matcher silently, and that fallback bubble IS the
 * "graceful disabled state": no error, no broken UI, just an answer that
 * did not come from the model. See src/app/api/assistant/route.ts and
 * docs/testing.md for the server-side half of this (and why the literal
 * 401-for-admin-mode security check lives in a vitest unit test instead of
 * here — the two facts are the same root cause).
 */
test.use({ extraHTTPHeaders: ipHeaders(100) });

test.describe("the assistant on a desktop", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "chatbot spec — desktop project only, see docs/testing.md");
  });

test("FAB opens the panel, close works, and a message gets a graceful reply with no key", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");

  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute("aria-expanded", "false");

  await fab.click();
  await expect(fab).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await expect(panel).toBeVisible();

  const log = panel.locator("[data-log]");
  const before = await log.locator(".sbot__msg").count();

  await panel.locator("[data-in]").fill("борода");
  await panel.getByRole("button", { name: "Отправить" }).click();

  // "me" bubble + a "bot" reply — never a 503, never a visible error, always
  // *something* back (rulesReply() always returns a bubble, matched or not).
  await expect(async () => {
    expect(await log.locator(".sbot__msg").count()).toBeGreaterThanOrEqual(before + 2);
  }).toPass({ timeout: 5_000 });
  await expect(log.locator(".sbot__msg--bot").last()).toBeVisible();
  await expect(page.locator(".sbot__msg--bot", { hasText: /error|ошибка|503|unavailable/i })).toHaveCount(0);

  // Close via the explicit close button (not just re-clicking the FAB) —
  // scoped to the panel since the cart drawer and toasts also use "Закрыть".
  await panel.getByRole("button", { name: "Закрыть" }).click();
  await expect(fab).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

/* Dim, 07.09.2026: «checkoutis pole assistenti vaja». Nobody at the till is
   still choosing a shampoo, and the widget sat on top of the payment buttons.
   Two halves to the promise: the FAB is gone the moment the checkout screen
   is drawn, and it comes back on the way out — the widget is a single
   long-lived root that hides and shows itself (chat.js refreshVisibility), so
   "gone" must not mean "gone for the rest of the visit". */
test("no assistant on the checkout screen, and it returns on the way out", async ({ page }) => {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();

  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await expect(fab).toBeVisible();

  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await expect(fab).toBeHidden();

  // …and back on the catalogue it is there again
  await page.goto(shopUrl("", "/c/all/"));
  await waitForScreen(page, "catalog");
  await expect(fab).toBeVisible();
});

/* A desktop window dragged down to phone width is the same shopper on the
   same page — the assistant has to leave with the width, not wait for a
   reload. matchMedia drives both the mount in app.js and the hide here. */
test("a window narrowed to phone width takes the assistant with it", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await expect(fab).toBeVisible();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(fab).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(fab).toBeVisible();
});
});

/* «mobiilis ei kasuta üldse poes assistenti» — not hidden with CSS, not
   mounted and hidden: on a phone the file is never fetched at all. chat.js
   builds an index of the whole catalogue the moment it loads, so this is
   bytes and work a phone should not spend on something it will never see.
   app.js (mountChat) is what decides; index.html no longer carries the tag. */
test.describe("the assistant on a phone", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile" && testInfo.project.name !== "mobile-safari",
      "phone projects only — this is the half of the rule a desktop cannot see",
    );
  });

  test("chat.js is never requested and no FAB is drawn, on any shop screen", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/shop2/chat.js")) asked.push(r.url()); });

    const fab = page.getByRole("button", { name: "Чат с помощником" });

    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await expect(fab).toHaveCount(0);

    await page.goto(shopUrl("", "/c/all/"));
    await waitForScreen(page, "catalog");
    await expect(fab).toHaveCount(0);

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect(fab).toHaveCount(0);
    // an in-page navigation, not a reload: the mount is decided per render
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await expect(fab).toHaveCount(0);

    expect(asked, `a phone downloaded the assistant: ${asked.join(", ")}`).toEqual([]);
  });
});
