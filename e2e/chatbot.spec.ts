import { expect, test } from "@playwright/test";
import { ipHeaders, shopUrl, waitForScreen } from "./fixtures";

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
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "chatbot spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(100) });

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
