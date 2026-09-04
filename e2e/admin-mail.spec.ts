import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Письма» — the owner's own subject, intro and closing line.
 *
 * The one thing this file exists to prove is that the editor and the real
 * sender are the same code path: the preview the owner is looking at, and the
 * letter a paying customer actually receives, come out of one function reading
 * one setting (`settings.mail_texts` → src/emails/texts.ts). A test that only
 * checked the preview would pass on the exact bug worth fearing.
 *
 * Estonian on purpose: the panel is Russian, the customer is not, and a
 * per-language override that quietly fell back to Russian is the failure mode
 * an owner would discover from a customer.
 *
 * Reading the sent letter back: the suite runs with no RESEND_API_KEY, so
 * nothing is really sent and there is no mailbox — `GET /api/e2e/mail/` is the
 * test-only readout of what `sendMail()` was asked to send (docs/testing.md,
 * "The test-only doors"). Desktop only, and everything is put back in a
 * `finally`: this setting is shop-wide and other spec files render letters.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin mail spec — desktop project only, see docs/testing.md");
});

const SUBJECT = "E2E teema {order} — Rempire";
const INTRO = "E2E sissejuhatus tellimusele {order}.";

/** The letters card lives on «Письма»; the editor appears once its own feed lands. */
async function openMailTab(page: Page): Promise<void> {
  /* «Письма» is a tab inside «Маркетинг» since the redesign — one click to
     the section, one to the tab (docs/design/admin-handoff-README.md). */
  await page.locator('[data-admtab="promos"][aria-current]:visible').first().click();
  await page.locator('[data-admtab="mail"][aria-current]:visible').first().click();
  await expect(page.locator("[data-mailtpl]").first()).toBeVisible();
  await page.locator('[data-mailtpl="order-confirmed"]').click();
  await page.locator('[data-maillang="ET"]').click();
  await expect(page.locator('[data-mailtxt="subject"]')).toBeVisible();
}

/** «Сохранить» → the confirm card → «Применить», and the write it triggers. */
async function saveAndApply(page: Page): Promise<void> {
  await page.locator("[data-mailsave]").click();
  await expect(page.locator("[data-admapply]")).toBeVisible();
  const put = page.waitForResponse(
    (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT",
  );
  await page.locator("[data-admapply]").click();
  expect((await put).ok()).toBe(true);
}

/** The rendered ET «Заказ принят», straight from the route the iframe reads. */
async function previewJson(page: Page): Promise<{ subject: string; html: string }> {
  const res = await page.request.get(
    "/api/admin/mail/preview/?template=order-confirmed&lang=ET&format=json",
  );
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe("admin — letter texts", () => {
  test.use({ extraHTTPHeaders: ipHeaders(170) });

  test("the subject and intro the owner types are what the customer's letter carries", async ({ page }) => {
    await loginAsAdmin(page);
    try {
      await openMailTab(page);

      // The fields start on the letter's own copy, not empty.
      await expect(page.locator('[data-mailtxt="subject"]')).toHaveValue(
        "Tellimus {order} on vastu võetud — Rempire",
      );

      await page.locator('[data-mailtxt="subject"]').fill(SUBJECT);
      await page.locator('[data-mailtxt="intro"]').fill(INTRO);
      await saveAndApply(page);

      // 1) The preview — both the iframe the owner is looking at and the
      //    route behind it — shows the new text with {order} filled in.
      const iframe = page.frameLocator('iframe[src^="/api/admin/mail/preview/"]');
      await expect(iframe.locator("body")).toContainText(
        "E2E sissejuhatus tellimusele R-100042.",
      );
      const preview = await previewJson(page);
      expect(preview.subject).toBe("E2E teema R-100042 — Rempire");
      expect(preview.html).toContain("E2E sissejuhatus tellimusele R-100042.");
      // the rest of the letter is still coded, not the owner's
      expect(preview.html).toContain("Tellimuse sisu");
      expect(preview.html).toContain("Rempire Store OÜ, Tallinn");

      // 2) A real paid order in Estonian — the letter the sender was handed.
      const email = freshEmail("mailtexts");
      await page.goto(shopUrl("/et", `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl("/et", "/checkout/"));
      await waitForScreen(page, "checkout");
      const number = await payOrder(page, email, "paid");

      const sink = await page.request.get(
        `/api/e2e/mail/?template=order-confirmed&to=${encodeURIComponent(email)}`,
      );
      expect(sink.ok()).toBe(true);
      const sent = (await sink.json()).mails as Array<{ subject: string }>;
      expect(sent.length, "the paid order produced no confirmation letter").toBeGreaterThan(0);
      expect(sent[sent.length - 1].subject).toBe(`E2E teema ${number} — Rempire`);

      // 3) «Вернуть стандартный текст» puts the letter's own copy back.
      await page.goto(shopUrl("", "/admin/"));
      await openMailTab(page);
      await page.locator('[data-mailreset="subject"]').click();
      await page.locator('[data-mailreset="intro"]').click();
      await expect(page.locator('[data-mailtxt="subject"]')).toHaveValue(
        "Tellimus {order} on vastu võetud — Rempire",
      );
      await saveAndApply(page);

      const back = await previewJson(page);
      expect(back.subject).toBe("Tellimus R-100042 on vastu võetud — Rempire");
      expect(back.html).not.toContain("E2E sissejuhatus");
      expect(back.html).toContain("Aitäh tellimuse nr R-100042 eest");
    } finally {
      // Belt and braces: a failed assertion above must not leave every
      // Estonian confirmation in this shop saying "E2E".
      await page.request.put("/api/admin/settings/", { data: { mail_texts: {} } });
    }
  });

  test("what the owner types is text, never markup", async ({ page }) => {
    await loginAsAdmin(page);
    try {
      await openMailTab(page);
      await page.locator('[data-mailtxt="intro"]').fill('<b>paks</b> & "jutumärgid"');
      await saveAndApply(page);

      const preview = await previewJson(page);
      expect(preview.html).not.toContain("<b>paks</b>");
      expect(preview.html).toContain("&lt;b&gt;paks&lt;/b&gt;");
      const iframe = page.frameLocator('iframe[src^="/api/admin/mail/preview/"]');
      await expect(iframe.locator("body")).toContainText('<b>paks</b> & "jutumärgid"');
      expect(await iframe.locator("body b").count(), "the letter rendered the owner's tag").toBe(0);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { mail_texts: {} } });
    }
  });
});
