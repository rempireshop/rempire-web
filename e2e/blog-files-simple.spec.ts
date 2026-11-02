import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { ipHeaders, loginAsAdmin, shopUrl } from "./fixtures";

/** Articles from PDFs and photos, made simple (Dim, 02.11.2026 — «Claude and
 *  Помощник and admin, all of these need to be good and simple»):
 *
 *   · a PDF on the Помощник's clip is read in the browser by the «Новая
 *     статья» code and saved into the blog's materials by itself; the chat
 *     says what it saved, and «Напиши статью по этому» goes to the model
 *     with the material's id — draft_from_materials, the confirm card, and
 *     «Новая статья» writing from exactly that material;
 *   · photos with no words get «Для чего эти фото?» and two taps;
 *   · the link Renat's Claude sends him, /admin?article=new&about=…, opens
 *     «+ Статья» → Материалы with the topic in, after the sign-in too.
 *
 *  The model is stood in for (this server has no OpenAI key); the PDF is a
 *  tiny synthetic one written below; this server has no photo bucket, so the
 *  PDF's text is the material and the photo uploads are stood in for. */
test.use({ extraHTTPHeaders: ipHeaders(86) });

/** Two A4 pages: «HYDRATE-ME.WASH» and a line of text, then a full-page picture. */
function syntheticPdf(): Buffer {
  const text = "BT /F1 28 Tf 72 760 Td (HYDRATE-ME.WASH) Tj ET\nBT /F1 14 Tf 72 720 Td (Moisturising shampoo for dry hair. Apply to wet hair, rinse.) Tj ET\n";
  const draw = "q 595 0 0 842 0 0 cm /Im1 Do Q\n";
  const pixels = Buffer.from([200, 180, 150, 30, 30, 30, 30, 30, 30, 200, 180, 150]);
  const objs: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from(`<< /Length ${text.length} >>\nstream\n${text}endstream`),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 7 0 R >> >> /Contents 8 0 R >>"),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`),
      pixels,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}endstream`),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let at = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(at);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" +
    offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

async function openAssistant(page: Page) {
  await page.locator(".adm-aiopen:visible").first().click();
  const panel = page.locator(".adm-asst");
  await expect(panel).toBeVisible();
  await panel.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => undefined));
  return panel;
}

type Asked = { messages?: Array<{ role: string; content: string }>; materials?: string[]; attachments?: Array<{ key: string; name: string }> };

test("a PDF on the clip is saved as a blog material, and «Напиши статью по этому» proposes the draft from exactly it", async ({ page }) => {
  test.setTimeout(120_000);
  const asked: Asked[] = [];
  await page.route("**/api/assistant/**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
    }
    const body = route.request().postDataJSON() as Asked;
    asked.push(body);
    const last = (body.messages || []).filter((m) => m.role === "user").pop()?.content || "";
    const ids = body.materials || [];
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(/напиши статью/i.test(last) && ids.length
        ? { reply: "Напишу статью по этому PDF — подтвердите; ничего не публикуется само.", product_ids: [], tab: "blog",
            action: { type: "draft_from_materials", about: "", materials: ids, show_sources: false } }
        : { reply: "Понял.", product_ids: [], tab: "" }),
    });
  });
  const drafts: Array<{ materials?: string[] }> = [];
  await page.route("**/api/admin/blog/draft/", async (route) => {
    drafts.push(route.request().postDataJSON());
    await route.continue();   // the real route: on this server it answers that no model is connected
  });

  await loginAsAdmin(page);
  const panel = await openAssistant(page);
  await expect(panel.locator("[data-admattach]")).toHaveAttribute("aria-label", "Прикрепить фото или PDF");
  await expect(panel.locator("[data-admattach]")).toBeEnabled();   // a PDF needs no photo bucket

  const pdfName = `hydrate-${Date.now().toString(36)}.pdf`;
  await panel.locator("[data-admfile]").setInputFiles({ name: pdfName, mimeType: "application/pdf", buffer: syntheticPdf() });

  // read here, by the «Новая статья» code, and saved on its own — the chat says what it saved
  const answer = page.locator("[data-aians]");
  await expect(answer).toContainText("Сохранил в материалы блога", { timeout: 45_000 });
  await expect(answer).toContainText(pdfName);
  await expect(answer).toContainText("2 страницы");
  await expect(answer).toContainText("ничего не публикуется само");
  await expect(page.locator("[data-admattlist]")).toHaveCount(0);   // off the strip, into the materials
  expect(asked, "the model was asked before anything was said").toHaveLength(0);

  const lib = await (await page.request.get("/api/admin/blog/materials/")).json();
  const mine = lib.materials.filter((m: { name: string }) => m.name === pdfName);
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ kind: "pdf", pageCount: 2 });
  expect(mine[0].short).toContain("HYDRATE-ME.WASH");

  try {
    // one tap: the model hears which material «этому» is, and proposes the draft
    await answer.getByRole("button", { name: "Напиши статью по этому" }).click();
    await expect(answer.locator(".adm-propose")).toContainText("Новая статья из материалов (1)", { timeout: 15_000 });
    expect(asked).toHaveLength(1);
    expect(asked[0].materials).toEqual([mine[0].id]);
    expect(asked[0].attachments).toEqual([]);
    expect(asked[0].messages!.some((m) => m.role === "assistant" && m.content.includes("Сохранил в материалы блога"))).toBe(true);

    // «Применить»: «Новая статья» opens with that material and the writer starts — never a publish
    await answer.locator("[data-admapply]").click();
    await expect(page.locator(".adm-bnew__steps li[aria-current='step']").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => drafts.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(drafts[0].materials).toEqual([mine[0].id]);
    await expect(page.locator(".adm-bnew .adm-err")).toContainText("нужен ключ OpenAI", { timeout: 20_000 });
  } finally {
    await page.request.delete(`/api/admin/blog/materials/?id=${mine[0].id}`);
  }
});

test("photos with nothing said get «Для чего эти фото?» — «Для товара» is today's road, with the photo told to the model", async ({ page }) => {
  test.setTimeout(90_000);
  const KEY = "products/inbox/1757000000000-e2e.webp";
  await page.route("**/api/admin/upload/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, configured: true, cutout: false, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
    }
    if (req.method() === "DELETE") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, key: KEY, url: "/shop/img/night-rider-0.webp", thumbUrl: "/shop/img/night-rider-0.webp", width: 1, height: 1, bytes: 10 }) });
  });
  const asked: Asked[] = [];
  await page.route("**/api/assistant/**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
    }
    asked.push(route.request().postDataJSON() as Asked);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Для какого товара это фото?", product_ids: [], tab: "goods" }) });
  });
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  await loginAsAdmin(page);
  const panel = await openAssistant(page);
  await panel.locator("[data-admfile]").setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator("[data-admattlist] .adm-att__img")).toHaveAttribute("style", /night-rider-0/);
  // → with an empty box: the chat asks what the photo is for, the model is not asked yet
  await panel.locator("[data-admsend]").click();
  const answer = page.locator("[data-aians]");
  await expect(answer).toContainText("Для чего эти фото?");
  expect(asked).toHaveLength(0);
  await answer.getByRole("button", { name: "Для товара" }).click();
  await expect(answer).toContainText("Для какого товара это фото?");
  expect(asked).toHaveLength(1);
  expect(asked[0].attachments).toEqual([{ key: KEY, name: "e2e.png" }]);
});

test("the link Claude sends opens «+ Статья» → Материалы with the topic in — signed in, and after the sign-in", async ({ page }) => {
  test.setTimeout(90_000);
  const link = shopUrl("", "/admin/") + "?article=new&about=" + encodeURIComponent("Сухие волосы зимой: Hydrate");

  // not signed in on this phone yet: the password first, then the page by itself
  await page.goto(link);
  const pw = page.locator("[data-admpw]");
  await expect(pw).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => { await pw.fill(E2E_ADMIN_PASSWORD); return pw.inputValue(); }, { timeout: 10_000 }).toBe(E2E_ADMIN_PASSWORD);
  await page.locator("[data-admlogin]").click();
  await expect(page.locator(".adm-bnew__steps li[aria-current='step']").first()).toContainText("Материалы", { timeout: 20_000 });
  await expect(page.locator("[data-bnewabout]")).toHaveValue("Сухие волосы зимой: Hydrate");
  await expect(page.locator(".adm-bnew .adm-note")).toContainText("вернитесь в чат с Claude");
  await expect(page.locator('[data-bnewfile="pdf"]')).toHaveCount(1);
  await expect(page.locator('[data-bnewfile="photo"]')).toHaveCount(1);
  // taken out of the address: a reload is the panel as he left it, not the link again
  await expect.poll(() => new URL(page.url()).search).not.toContain("article=new");

  // signed in already (the session from above): straight there, the topic left as it was
  await page.goto(shopUrl("", "/admin/") + "?article=new");
  await expect(page.locator(".adm-bnew__steps li[aria-current='step']").first()).toContainText("Материалы", { timeout: 20_000 });
  await expect(page.locator(".adm-bnew .adm-note")).toContainText("PDF / файл");
});
