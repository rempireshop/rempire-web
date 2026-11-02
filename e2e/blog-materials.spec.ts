import { expect, test } from "@playwright/test";
import { adminSection, ipHeaders, loginAsAdmin } from "./fixtures";

/** «Новая статья» → «Материалы» (Dim, 02.11.2026 — canvas-banner/project/
 *  BlogNew): a PDF is read IN THE BROWSER by the self-hosted pdf.js — its
 *  text page by page, and its photo pages shown small to tick, each labelled
 *  with the heading of the text page before it. The PDF here is a tiny
 *  synthetic one written below (two A4 pages: a text page «ANGEL.WASH», then
 *  a full-page picture) — never a brand's real catalogue.
 *
 *  The e2e server has no photo bucket and no OpenAI key: the PDF's text is
 *  saved as a material without its pictures, and «Написать черновик» answers
 *  that the assistant is not connected — which is what the panel must say. */
test.use({ extraHTTPHeaders: ipHeaders(84) });

/** A two-page PDF: page 1 the heading and a line of text, page 2 one 2×2 image scaled over the whole page. */
function syntheticPdf(): Buffer {
  const text = "BT /F1 28 Tf 72 760 Td (ANGEL.WASH) Tj ET\nBT /F1 14 Tf 72 720 Td (Shampoo for fine coloured hair. Apply to wet hair, rinse.) Tj ET\n";
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

test("a PDF is read in the browser: its photo page labelled by the text page before it and ticked by the topic", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  await adminSection(page, "blog");
  await page.locator("[data-admblognew]:visible").first().click();
  await expect(page.locator(".adm-bnew__steps li[aria-current='step']")).toContainText("Материалы");

  await page.locator("[data-bnewabout]").fill("Angel для тонких окрашенных волос");
  // a name of its own per run: a retry, or the phone project, must not count the desktop's copy
  const pdfName = `angel-guide-${Date.now().toString(36)}.pdf`;
  await page.locator('[data-bnewfile="pdf"]').setInputFiles({ name: pdfName, mimeType: "application/pdf", buffer: syntheticPdf() });

  // pdf.js arrives only now, from the shop's own copy — and only the panel ever asks for it
  const grid = page.locator(".adm-bnew__page");
  await expect(grid).toHaveCount(1, { timeout: 30_000 });
  await expect(grid.first()).toContainText("ANGEL.WASH — фото");
  await expect(grid.first().locator("input[type=checkbox]")).toBeChecked();
  await expect(grid.first().locator("img")).toHaveAttribute("src", /^data:image\/jpeg/);
  await expect(page.locator(".adm-bnew__note").first()).toContainText("2 страницы");

  await page.locator("[data-bnewpdfok]").click();
  // no photo bucket here: the text is the material, the picture stays on the phone
  await expect(page.locator(".adm-bnew__note").first()).toContainText("без картинок", { timeout: 20_000 });

  // a sample text too — «писать так же»
  await page.locator('[data-bnewsheet="text"]').click();
  await page.locator("[data-bnewtext]").fill("Короткий образец: тон дружеский, два абзаца, без лишних слов.");
  await page.locator("[data-bnewsample]").check();
  await page.locator("[data-bnewtextok]").click();
  await expect(page.locator(".adm-bnew__item")).toHaveCount(2);
  await expect(page.locator(".adm-bnew__note").nth(1)).toContainText("образец", { timeout: 10_000 });

  // the library holds both, the way Claude's list_materials will read them
  const lib = await (await page.request.get("/api/admin/blog/materials/")).json();
  const mine = lib.materials.filter((m: { name: string }) => m.name === pdfName);
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ kind: "pdf", pageCount: 2 });
  expect(mine[0].short).toContain("ANGEL.WASH");

  // and «Написать черновик» says what is missing on a server with no key
  await page.locator("[data-bnewwrite]").click();
  await expect(page.locator(".adm-bnew .adm-err")).toContainText("нужен ключ OpenAI", { timeout: 20_000 });

  // a link that is not the public internet is refused by the server's guard
  await page.locator('[data-bnewsheet="link"]').click();
  await page.locator("[data-bnewlink]").fill("https://metadata.google.internal/computeMetadata/v1/");
  await page.locator("[data-bnewlinkok]").click();
  await expect(page.locator(".adm-bnew__item.is-err")).toContainText("только открытые страницы", { timeout: 10_000 });

  for (const m of lib.materials) await page.request.delete(`/api/admin/blog/materials/?id=${m.id}`);   // the library as it was
});

/* Step 2, «Черновик», with the writer stood in for: this server has no OpenAI
   key, so the draft the writer would have saved is saved here through the
   panel's own API, and /api/admin/blog/draft/ answers with it. Everything
   after that — the cover, the languages, «Убрать», ×, the yellow count,
   «Как в магазине», «Опубликовать» — is the real panel on the real API. */
test("step 2: the draft's pictures, products, yellow count, shop preview — and publishing takes the marks out", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  const stamp = Date.now().toString(36);
  const PIC = "/shop/img/night-rider-0.webp";
  const created = await page.request.post("/api/admin/blog/", {
    data: {
      title: { RU: `Черновик из материалов ${stamp}`, ET: `Mustand ${stamp}`, EN: `Draft ${stamp}` },
      excerpt: { RU: "Лид черновика." },
      body: {
        RU: `<h2>Паста</h2><h3>Night.Rider</h3><figure data-fig="full"><img src="${PIC}" alt="Night.Rider — фото"><figcaption>Банка</figcaption></figure>` +
          `<p>Факт из буклета. <mark data-unsure>Совет без источника.</mark></p><p><a data-product="night-rider" data-price="live" href="/ru/products/night-rider">Night.Rider</a></p>`,
        ET: `<h2>Pasta</h2><figure data-fig="full"><img src="${PIC}" alt=""></figure><p>Tekst.</p>`,
        EN: `<h2>Paste</h2><figure data-fig="full"><img src="${PIC}" alt=""></figure><p>Text.</p>`,
      },
      products: ["night-rider", "free-hold"],
      sources: ["Буклет Kevin.Murphy, PDF"], showSources: true, topic: "styling",
    },
  });
  expect(created.status()).toBe(200);
  const post = (await created.json()).post as { id: string; slug: string };
  try {
    await page.route("**/api/admin/blog/draft/", async (route) => {
      const asked = route.request().postDataJSON() as { translate?: string };
      const fresh = await (await page.request.get(`/api/admin/blog/?id=${post.id}`)).json();
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(asked.translate
          ? { ok: true, post: fresh.post, unsure: 0 }
          : { ok: true, post: fresh.post, placed: [{ url: PIC, label: "Night.Rider — фото", page: 4, w: 400, h: 400 }], unsure: 1, trimmed: { used: 45_000, total: 131_000, trimmed: true } }),
      });
    });

    await adminSection(page, "blog");
    await page.locator("[data-admblognew]:visible").first().click();
    await page.locator("[data-bnewabout]").fill("Паста, воск или глина");
    await page.locator('[data-bnewsheet="text"]').click();
    await page.locator("[data-bnewtext]").fill("Материал: Night.Rider — паста сильной фиксации, матовая.");
    await page.locator("[data-bnewtextok]").click();
    await expect(page.locator("[data-bnewwrite]")).toBeEnabled({ timeout: 10_000 });
    await page.locator("[data-bnewwrite]").click();

    await expect(page.locator(".adm-bnew__steps li[aria-current='step']")).toContainText("Черновик");
    await expect(page.locator(".adm-bnew__title")).toHaveText(`Черновик из материалов ${stamp}`);
    // both translations land by themselves
    await expect(page.locator('[data-bnewlang="ET"]')).toContainText("✓");
    await expect(page.locator('[data-bnewlang="EN"]')).toContainText("✓");
    // the yellow count, and what was left out of a long material
    await expect(page.locator(".adm-bnew .adm-note--warn")).toContainText("1 фраза не нашлась в материалах");
    await expect(page.locator(".adm-bnew")).toContainText("прочитано 45 тыс. знаков из 131 тыс.");
    // the picture placed, under its heading
    await expect(page.locator(".adm-bnew__pic")).toContainText("под заголовком «Night.Rider»");
    // «Как в магазине»: the shop's own article markup over the panel
    await page.locator("[data-bnewpreview]").first().click();
    await expect(page.locator(".adm-bnew__shop .bmag-post__h1")).toHaveText(`Черновик из материалов ${stamp}`);
    await expect(page.locator(".adm-bnew__shop .bmag-src")).toContainText("Буклет Kevin.Murphy, PDF");
    await expect(page.locator(".adm-bnew__shop mark")).toHaveCount(0);   // a reader never sees the yellow
    await page.locator(".adm-bnew__shop [data-bnewpreview]").click();

    // × on a product: gone from the list and its card from the text
    await page.locator('[data-bnewproddel="free-hold"]').click();
    await expect(page.locator('[data-bnewproddel="free-hold"]')).toHaveCount(0);
    // «Убрать» on the picture: gone from all three texts
    await page.locator("[data-bnewpicdel]").first().click();
    await expect(page.locator(".adm-bnew__pic")).toHaveCount(0);
    const mid = (await (await page.request.get(`/api/admin/blog/?id=${post.id}`)).json()).post;
    expect(mid.products).toEqual(["night-rider"]);
    for (const L of ["RU", "ET", "EN"]) expect(mid.body[L]).not.toContain(PIC);

    await page.locator("[data-bnewpublish]").click();
    await expect(page.locator("[data-blogbody]")).toBeVisible();   // it opens in the editor, published
    const live = (await (await page.request.get(`/api/admin/blog/?id=${post.id}`)).json()).post;
    expect(live.status).toBe("published");
    expect(live.body.RU).not.toContain("<mark");
    expect(live.body.RU).toContain("Совет без источника.");
  } finally {
    await page.request.delete(`/api/admin/blog/?id=${post.id}`);
    const lib = await (await page.request.get("/api/admin/blog/materials/")).json();
    for (const m of lib.materials) await page.request.delete(`/api/admin/blog/materials/?id=${m.id}`);
  }
});

test("«Удалить» in the library asks first, then the material is gone from it", async ({ page }) => {
  await loginAsAdmin(page);
  const name = `Удаляемый образец ${Date.now().toString(36)}`;
  const made = await page.request.post("/api/admin/blog/materials/", { data: { kind: "text", name, text: "Текст, который сейчас удалят." } });
  expect(made.status()).toBe(200);
  const id = (await made.json()).material.id as string;
  try {
    await adminSection(page, "blog");
    await page.locator("[data-admblognew]:visible").first().click();
    await page.locator("[data-bnewlib]").click();
    const del = page.locator(`[data-bnewlibdel="${id}"]`);
    await expect(del).toBeVisible();
    await del.click();
    // the panel's own question, in Dim's words
    await expect(page.getByText("Удалить материал?")).toBeVisible();
    await expect(page.getByText("Статьи, уже написанные по нему, не изменятся.")).toBeVisible();
    await page.locator("[data-admapply]").click();
    await expect(del).toHaveCount(0);
    const lib = await (await page.request.get("/api/admin/blog/materials/")).json();
    expect(lib.materials.some((m: { id: string }) => m.id === id)).toBe(false);
  } finally {
    await page.request.delete(`/api/admin/blog/materials/?id=${id}`);
  }
});

test("«Писать самому» still opens the blank editor", async ({ page }) => {
  await loginAsAdmin(page);
  await adminSection(page, "blog");
  await page.locator("[data-admblognew]:visible").first().click();
  await page.locator("[data-bnewblank]").click();
  await expect(page.locator("[data-blogbody]")).toBeVisible();
});

test("pdf.js is never asked for on a shop page", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => { if (r.url().includes("pdfjs")) asked.push(r.url()); });
  await page.goto("/blogs/news");
  await page.waitForLoadState("networkidle");
  expect(asked).toEqual([]);
});
