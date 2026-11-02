/**
 * «Новая статья» from materials (Dim, 02.11.2026 — canvas-banner/project/
 * BlogNew, BlogDraft, Flow): the SSRF guard a link goes through, what a
 * material may hold, what of it the writer reads, how the draft that comes
 * back is held to the shop (products from the catalogue, pictures from the
 * materials, the yellow marks kept for the editor and taken out on publish),
 * and the connector's two new tools beside save_draft.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import { checkUrl, fetchPublicPage, guardedLookup, htmlToText, isPrivateAddress, SafeFetchError, type SafeRequest } from "@/lib/safe-fetch";
import {
  createMaterial, isOurBlogImage, materialPart, MaterialError, readMaterialInput, selectMaterialText, topicStems,
  type Material,
} from "@/lib/blog-materials";
import {
  buildDraftPrompt, countUnsure, pictureList, placePictures, protectUnsure, readDraftJson, restoreUnsure, shapeDraftBody,
  sourcesOf, stripUnsure,
} from "@/lib/blog-draft";
import { getPostById, getPostBySlug, publishPost, renderPostBody, sanitizeHtml, upsertPost } from "@/lib/blog";
import { INSTRUCTIONS, productsNow, resetProductCache, runTool, shopBody, TOOLS } from "@/lib/mcp/tools";
import { sanitizeAction, sanitizeDraftFromMaterials } from "@/app/api/assistant/actions";
import { exec } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/* ---------- the SSRF guard --------------------------------------------------- */

describe("a link is read from the public internet and nowhere else", () => {
  it("refuses every address that is not the public internet", () => {
    for (const ip of [
      "0.0.0.0", "10.0.0.1", "10.255.255.255", "100.64.0.1", "127.0.0.1", "127.8.8.8", "169.254.169.254", "172.16.0.1",
      "172.31.255.254", "192.168.1.1", "192.0.2.10", "198.18.0.1", "224.0.0.1", "255.255.255.255",
      "::", "::1", "fe80::1", "fd00::1", "fc12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe",
      "64:ff9b::a00:1", "2002:c0a8:101::1", "2001:db8::1", "not-an-ip",
    ]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700::1111", "2a00:1450:4001:81b::200e", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses a scheme that is not https, a password, a port, an IP literal and a local name", () => {
    const code = (u: string) => { try { checkUrl(u); return "ok"; } catch (e) { return (e as SafeFetchError).code; } };
    expect(code("https://tallinnavesi.ee/vesi")).toBe("ok");
    expect(code("http://tallinnavesi.ee/")).toBe("not_https");
    expect(code("ftp://example.com/")).toBe("not_https");
    expect(code("javascript:alert(1)")).toBe("not_https");
    expect(code("file:///etc/passwd")).toBe("not_https");
    expect(code("https://user:pw@example.com/")).toBe("credentials");
    expect(code("https://example.com:8443/")).toBe("bad_port");
    expect(code("https://127.0.0.1/")).toBe("ip_host");
    expect(code("https://[::1]/")).toBe("ip_host");
    expect(code("https://2130706433/")).toBe("ip_host");   // 127.0.0.1 as one number — the URL parser turns it into the address
    expect(code("https://localhost/")).toBe("private_host");
    expect(code("https://printer.local/")).toBe("private_host");
    expect(code("https://metadata.google.internal/")).toBe("private_host");
    expect(code("https://intranet/")).toBe("private_host");
    expect(code("not a url")).toBe("bad_url");
  });

  const page = (status: number, headers: Record<string, string>, body = "") => ({
    status, headers, body: (async function* () { yield Buffer.from(body); })(),
  });
  const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];

  it("reads a public page's words, its title, no script", async () => {
    const request: SafeRequest = async () => page(200, { "content-type": "text/html; charset=utf-8" },
      "<html><head><title>Жёсткость воды &mdash; Tallinna Vesi</title><script>steal()</script></head>" +
      "<body><nav>Меню</nav><h1>Вода</h1><p>Жёсткость в Таллине&nbsp;— около 5 °dH.</p><style>p{}</style></body></html>");
    const got = await fetchPublicPage("https://tallinnavesi.ee/vesi", { resolve: PUBLIC, request });
    expect(got.title).toBe("Жёсткость воды — Tallinna Vesi");
    expect(got.text).toBe("Вода\nЖёсткость в Таллине — около 5 °dH.");
    expect(got.text).not.toContain("steal");
    expect(got.text).not.toContain("Меню");
  });

  it("refuses a public name that resolves to a private address — before it asks, and again at the connect", async () => {
    const request = vi.fn<SafeRequest>();
    await expect(fetchPublicPage("https://evil.example/", { resolve: async () => [{ address: "169.254.169.254", family: 4 }], request }))
      .rejects.toMatchObject({ code: "private_address" });
    // one public and one private answer is a private answer
    await expect(fetchPublicPage("https://evil.example/", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }], request,
    })).rejects.toMatchObject({ code: "private_address" });
    expect(request).not.toHaveBeenCalled();
    // …and the lookup the request connects with says the same, whatever DNS answered a moment earlier
    const lookup = guardedLookup(async () => [{ address: "127.0.0.1", family: 4 }]);
    const err = await new Promise((resolve) => (lookup as unknown as (h: string, o: object, cb: (e: unknown) => void) => void)("x.example", {}, resolve));
    expect(err).toMatchObject({ code: "private_address" });
  });

  it("follows a redirect only to where it may go — never to a private host, never off https, three at most", async () => {
    const resolve = async (host: string) => (host === "inside.example" ? [{ address: "192.168.0.10", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
    const to = (location: string): SafeRequest => async (url) =>
      url.hostname === "start.example" ? page(302, { location }) : page(200, { "content-type": "text/html" }, "<p>ok</p>");
    await expect(fetchPublicPage("https://start.example/", { resolve, request: to("https://inside.example/admin") }))
      .rejects.toMatchObject({ code: "private_address" });
    await expect(fetchPublicPage("https://start.example/", { resolve, request: to("http://other.example/") }))
      .rejects.toMatchObject({ code: "not_https" });
    await expect(fetchPublicPage("https://start.example/", { resolve, request: to("https://127.0.0.1/") }))
      .rejects.toMatchObject({ code: "ip_host" });
    expect((await fetchPublicPage("https://start.example/", { resolve, request: to("https://other.example/page") })).text).toBe("ok");
    const loop: SafeRequest = async (url) => page(301, { location: url.toString() });
    await expect(fetchPublicPage("https://start.example/", { resolve, request: loop })).rejects.toMatchObject({ code: "too_many_redirects" });
  });

  it("stops at 2 MB, and reads only HTML or text", async () => {
    const big: SafeRequest = async () => ({
      status: 200, headers: { "content-type": "text/html" },
      body: (async function* () { for (let i = 0; i < 5; i++) yield Buffer.alloc(600_000, 0x61); })(),
    });
    await expect(fetchPublicPage("https://a.example/", { resolve: PUBLIC, request: big })).rejects.toMatchObject({ code: "too_large" });
    const pdf: SafeRequest = async () => page(200, { "content-type": "application/pdf" }, "%PDF");
    await expect(fetchPublicPage("https://a.example/", { resolve: PUBLIC, request: pdf })).rejects.toMatchObject({ code: "not_text" });
    const gone: SafeRequest = async () => page(404, {});
    await expect(fetchPublicPage("https://a.example/", { resolve: PUBLIC, request: gone })).rejects.toMatchObject({ code: "http_404" });
  });

  it("turns HTML into paragraphs, entities decoded", () => {
    expect(htmlToText("<p>Раз&amp;два</p><ul><li>один</li><li>два</li></ul><!-- x --><br>три").text).toBe("Раз&два\nодин\nдва\nтри");
  });
});

/* ---------- what a material may hold ------------------------------------------ */

const OURS = (u: unknown) => typeof u === "string" && u.startsWith("https://img.example/blog/");
const img = (n: number, page: number | null = null, label = "") => ({ id: "p" + n, url: `https://img.example/blog/p${n}.webp`, w: 828, h: 1170, page, label });

describe("readMaterialInput — what a material may hold", () => {
  it("takes the four kinds and nothing else, and wants a name", () => {
    expect(() => readMaterialInput({ kind: "video", name: "x" }, OURS)).toThrow(MaterialError);
    expect(() => readMaterialInput({ kind: "text", name: "", text: "abc" }, OURS)).toThrow(/name_required/);
    expect(() => readMaterialInput(null, OURS)).toThrow(/bad_request/);
    expect(() => readMaterialInput({ kind: "text", name: "Пусто", text: " " }, OURS)).toThrow(/empty/);
  });

  it("a PDF: its pages cleaned and sorted, its text their join, only our own pictures", () => {
    const m = readMaterialInput({
      kind: "pdf", name: "  KM_Angel_guide.pdf ", pageCount: 170,
      pages: [{ n: 4, heading: "ANGEL.WASH", text: "Шампунь\r\nдля тонких" }, { n: 2, heading: "HYDRATE", text: "Линия" }, { n: "x" }, "junk"],
      images: [img(5, 5, "ANGEL.WASH — фото"), { ...img(6), url: "https://evil.example/x.webp" }, { ...img(7), w: 0 }, { ...img(5), id: "p5" }],
    }, OURS);
    expect(m.name).toBe("KM_Angel_guide.pdf");
    expect(m.pages.map((p) => p.n)).toEqual([2, 4]);
    expect(m.text).toBe("Линия\n\nШампунь\nдля тонких");
    expect(m.images).toHaveLength(2);
    expect(m.images[0]).toMatchObject({ id: "p5", page: 5, label: "ANGEL.WASH — фото", w: 828, h: 1170 });
    expect(m.images[1].id).not.toBe("p5");   // a repeated id is made unique
    expect(m.pageCount).toBe(170);
  });

  it("photos need pictures; a link needs https; a sample is a text's alone", () => {
    expect(() => readMaterialInput({ kind: "image", name: "Фото", images: [{ ...img(1), url: "/shop/img/x.webp" }] }, OURS)).toThrow(/no_images/);
    expect(readMaterialInput({ kind: "image", name: "Фото", images: [img(1)] }, OURS).images).toHaveLength(1);
    expect(() => readMaterialInput({ kind: "link", name: "x", url: "http://a.example", text: "t" }, OURS)).toThrow(/bad_url/);
    expect(readMaterialInput({ kind: "text", name: "Образец", text: "Текст", sample: true }, OURS).sample).toBe(true);
    expect(readMaterialInput({ kind: "link", name: "x", url: "https://a.example", text: "t", sample: true }, OURS).sample).toBe(false);
  });

  it("a picture is ours only when it is a blog/ object in this shop's bucket", () => {
    const keep = { ...process.env };
    Object.assign(process.env, { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_PUBLIC_BASE: "https://img.rempireshop.com" });
    try {
      expect(isOurBlogImage("https://img.rempireshop.com/blog/1700000000000-p4.webp")).toBe(true);
      expect(isOurBlogImage("https://img.rempireshop.com/products/x/1.webp")).toBe(false);
      expect(isOurBlogImage("https://evil.example/blog/1.webp")).toBe(false);
      expect(isOurBlogImage("/shop/img/x-0.webp")).toBe(false);
    } finally {
      process.env = keep;
    }
  });
});

/* ---------- what the writer reads ------------------------------------------------ */

const material = (over: Partial<Material>): Material => ({
  id: "00000000-0000-4000-8000-000000000001", kind: "pdf", name: "Каталог.pdf", text: "", pages: [], images: [], url: null,
  sample: false, pageCount: null, createdAt: "2026-11-02T00:00:00.000Z", ...over,
});

describe("selectMaterialText — never the whole catalogue", () => {
  const pages = Array.from({ length: 170 }, (_, i) => ({
    n: i + 1,
    heading: i === 40 ? "ANGEL.WASH" : i === 90 ? "HYDRATE-ME.WASH" : "СТРАНИЦА " + (i + 1),
    // pages 42 and 120 are photo pages: a picture and no text, as in the real catalogue
    text: i === 41 || i === 119 ? "" : (i === 40 ? "Angel — шампунь для тонких окрашенных волос. " : i === 90 ? "Увлажнение для сухих волос. " : "Прочее. ") + "x".repeat(760),
  }));
  const pdf = material({ pages, text: pages.map((p) => p.text).join("\n\n"), images: [img(42, 42, "ANGEL.WASH — фото"), img(120, 120, "X — фото")] });

  it("stays inside the budget and says it trimmed", () => {
    const s = selectMaterialText([pdf], "Объём для тонких окрашенных волос: Angel", 45_000);
    expect(s.total).toBeGreaterThan(120_000);
    expect(s.used).toBeLessThanOrEqual(45_000);
    expect(s.trimmed).toBe(true);
  });

  it("takes the pages paired with the ticked pictures and the pages the topic names first, in page order", () => {
    const s = selectMaterialText([pdf], "Angel для тонких волос", 1700);
    const text = s.blocks[0].text;
    expect(text).toContain("[стр. 41 · ANGEL.WASH]");    // named by the topic, and the text page before the photo on p. 42
    expect(text).toContain("[стр. 119");                 // the text page before the ticked photo on p. 120
    expect(text.indexOf("стр. 41")).toBeLessThan(text.indexOf("стр. 119"));
    expect(text).not.toContain("HYDRATE-ME.WASH");
  });

  it("cuts a sample to its tone, and reads a link or a text as it is", () => {
    const s = selectMaterialText([
      material({ kind: "text", name: "Образец", sample: true, text: "о".repeat(10_000) }),
      material({ kind: "link", name: "tallinnavesi.ee", text: "Жёсткость воды 5 °dH." }),
    ], "вода", 45_000);
    expect(s.blocks[0]).toMatchObject({ sample: true });
    expect(s.blocks[0].text).toHaveLength(4000);
    expect(s.blocks[1].text).toBe("Жёсткость воды 5 °dH.");
  });

  it("stems the topic: no short words, no repeats", () => {
    expect(topicStems("Объём для тонких окрашенных волос: Angel и Plumping")).toEqual(["объём", "тонки", "окраш", "волос", "angel", "plump"]);
  });

  it("hands Claude a long text in parts, page markers and all", () => {
    const part1 = materialPart(pdf, 1);
    expect(part1.parts).toBeGreaterThan(5);
    expect(part1.text.startsWith("[стр. 1 · СТРАНИЦА 1]")).toBe(true);
    expect(materialPart(pdf, 999).part).toBe(part1.parts);
  });

  it("writes the prompt with the rules Dim's brief and the real catalogue call for", () => {
    const pics = pictureList([pdf]);
    const p = buildDraftPrompt({ about: "Angel", selected: selectMaterialText([pdf], "Angel", 3000), pictures: pics, products: [{ id: "angel-wash", brand: "Kevin.Murphy", name: "Angel.Wash", cat: "hair" }] });
    expect(p.system).toContain("СВОИМИ СЛОВАМИ");
    expect(p.system).toContain("<mark data-unsure>");
    expect(p.system).toContain("Кевина Мёрфи");
    expect(p.system).toMatch(/Применение.*Преимущества.*Основные ингредиенты/);
    expect(p.user).toContain("P1 — ANGEL.WASH — фото (Каталог.pdf, стр. 42)");
    expect(p.user).toContain("angel-wash — Kevin.Murphy Angel.Wash (hair)");
  });
});

/* ---------- the draft, held to the shop ------------------------------------------- */

describe("the draft that comes back", () => {
  const pics = [{ ref: "P1", image: img(42, 42, "ANGEL.WASH — фото") }, { ref: "P2", image: img(43, 43, "B") }];

  it("places only the materials' pictures, once each, five at most, with the label as alt and the caption kept", () => {
    const body = '<h3>Angel</h3><figure data-pic="P1"><figcaption>Angel.Wash и Angel.Rinse</figcaption></figure>' +
      '<figure data-pic="P9"></figure><figure data-pic="p1"></figure><figure data-pic="P2"></figure>';
    const { html, placed } = placePictures(body, pics);
    expect(placed.map((p) => p.url)).toEqual([img(42).url, img(43).url]);
    expect(html).toContain(`<figure data-fig="full"><img src="${img(42).url}" alt="ANGEL.WASH — фото"><figcaption>Angel.Wash и Angel.Rinse</figcaption></figure>`);
    expect(html).not.toContain("P9");
    expect(html.match(/<figure/g)).toHaveLength(2);
    const many = Array.from({ length: 8 }, (_, i) => ({ ref: "P" + (i + 1), image: img(i + 1) }));
    expect(placePictures(many.map((p) => `<figure data-pic="${p.ref}"></figure>`).join(""), many).placed).toHaveLength(5);
  });

  it("keeps the yellow marks through the allowlist, balanced, and counts them", () => {
    const raw = "<p>Факт. <mark data-unsure>Совет без источника.</mark></p><p><mark>чужой</mark> <mark data-unsure>Ещё один";
    const back = restoreUnsure(sanitizeHtml(protectUnsure(raw)));
    expect(back).toBe("<p>Факт. <mark data-unsure>Совет без источника.</mark></p><p>чужой <mark data-unsure>Ещё один</mark></p>");
    expect(countUnsure(back)).toBe(2);
    // a reader never sees one — the shop's allowlist unwraps it
    expect(renderPostBody(back)).not.toContain("<mark");
    expect(stripUnsure(back)).toBe("<p>Факт. Совет без источника.</p><p>чужой Ещё один</p>");
  });

  it("drops a product the shop does not sell — a card goes, a link loses its address — and keeps the ones it does", async () => {
    resetProductCache();
    const { list } = await productsNow();
    const byId = new Map(list.slice(0, 3).map((p) => [p.id, p]));
    const known = list[0];
    const raw = `<p>Возьмите <a href="product:${known.id}">его</a> или <a href="product:no-such-thing">другой</a>.</p>` +
      `<p><a data-product="${known.id}"></a></p><p><a data-product="no-such-thing"></a></p>` +
      `<figure data-pic="P1"></figure><p><img src="https://evil.example/x.jpg" alt=""></p><p><mark data-unsure>Слух.</mark></p>`;
    const out = shapeDraftBody(raw, { pictures: pics, shape: (h) => shopBody(h, "RU", byId, new Set(pics.map((p) => p.image.url))) });
    expect(out.ids).toEqual([known.id]);
    expect(out.html).toContain(`href="/ru/products/${known.id}"`);
    expect(out.html).toContain(`<a data-product="${known.id}" data-price="live"`);
    expect(out.html).not.toContain("no-such-thing");
    expect(out.html).toContain("другой");                 // the words stay, the address goes
    expect(out.html).toContain(img(42).url);              // the material's picture
    expect(out.html).not.toContain("evil.example");       // anybody else's goes
    expect(out.unsure).toBe(1);
    expect(out.placed).toHaveLength(1);
  });

  it("reads the model's JSON bounded: the five topics only, tags in the article's script, ids lower-cased", () => {
    const t = readDraftJson({ title: " Объём ", topic: "Hair", tags: ["волосы", "hair", "объём"], products: ["Angel-Wash", 5], body: "<p>x</p>" }, "RU");
    expect(t).toMatchObject({ title: "Объём", topic: "hair", tags: ["волосы", "объём"], products: ["angel-wash"] });
    expect(readDraftJson({ topic: "perfume" }, "RU").topic).toBeNull();
    expect(readDraftJson({ tags: ["волосы", "juuksed"] }, "ET").tags).toEqual(["juuksed"]);
    expect(readDraftJson(null, "EN").title).toBe("");
  });

  it("names the materials as sources — a sample is how to write, not what from", () => {
    expect(sourcesOf([material({ name: "Буклет, PDF" }), material({ kind: "text", name: "Образец", sample: true })])).toEqual(["Буклет, PDF"]);
  });
});

/* ---------- stored, published, and the connector ------------------------------------- */

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);

describe("in the database", () => {
  beforeEach(async () => {
    await exec("truncate posts restart identity cascade");
    await exec("truncate blog_materials");
    resetProductCache();
  });

  it("«Опубликовать» takes the marks out of every language and keeps their words", async () => {
    const p = await upsertPost({
      title: { RU: "Черновик" },
      body: { RU: "<p>Факт. <mark data-unsure>Совет.</mark></p>", ET: "<p><mark data-unsure>Nõuanne.</mark></p>", EN: "<p>Plain.</p>" },
    });
    expect((await getPostById(p.id))!.body.RU).toContain("<mark data-unsure>");
    const live = (await publishPost(p.id))!;
    expect(live.body).toEqual({ RU: "<p>Факт. Совет.</p>", ET: "<p>Nõuanne.</p>", EN: "<p>Plain.</p>" });
  });

  it("list_materials and get_material read the library; save_draft takes a material picture as the cover, with its size", async () => {
    const m = await createMaterial(readMaterialInput({
      kind: "pdf", name: "KM_Angel_guide.pdf", pageCount: 12,
      pages: [{ n: 1, heading: "ANGEL", text: "Angel.Wash — " + "текст ".repeat(3000) }],
      images: [img(2, 2, "ANGEL.WASH — фото")],
    }, OURS));
    const listed = JSON.parse((await runTool("list_materials", {})).text);
    expect(listed.found).toBe(1);
    expect(listed.materials[0]).toMatchObject({ id: m.id, kind: "pdf", name: "KM_Angel_guide.pdf", pages: 12 });
    expect(listed.materials[0].pictures[0]).toMatchObject({ address: img(2).url, page: 2, label: "ANGEL.WASH — фото", width: 828, height: 1170 });

    const one = JSON.parse((await runTool("get_material", { id: m.id })).text);
    expect(one.parts).toBeGreaterThan(1);
    expect(one.text.startsWith("[стр. 1 · ANGEL]")).toBe(true);
    expect(one.next).toBe("get_material with part 2");
    expect((await runTool("get_material", { id: "nope" })).isError).toBe(true);

    const saved = await runTool("save_draft", {
      ru: { title: "Angel для тонких волос", body: `<h2>Angel</h2><figure data-fig="full"><img src="${img(2).url}" alt="Angel"><figcaption>Флакон</figcaption></figure><p>Текст.</p>` },
      cover: img(2).url,
      sources: ["KM_Angel_guide.pdf"],
      show_sources: true,
      topic: "hair",
    });
    expect(saved.isError).toBeFalsy();
    const out = JSON.parse(saved.text);
    const post = (await getPostBySlug(out.slug))!;
    expect(post).toMatchObject({ coverUrl: img(2).url, coverW: 828, coverH: 1170, topic: "hair", showSources: true, sources: ["KM_Angel_guide.pdf"] });
    expect(post.body.RU).toContain(img(2).url);
    expect(post.body.RU).toContain("<figcaption>Флакон</figcaption>");
    // a picture from anywhere else is still refused as the cover
    expect((await runTool("save_draft", { ru: { title: "T", body: "<p>x</p>" }, cover: "https://evil.example/x.jpg" })).isError).toBe(true);
  });
});

describe("the connector's tools say how the flow goes", () => {
  it("lists the two new tools with their schemas, and save_draft takes sources, show_sources and topic", () => {
    const by = new Map(TOOLS.map((t) => [t.name, t]));
    expect(by.get("list_materials")!.inputSchema).toMatchObject({ type: "object", properties: {}, additionalProperties: false });
    expect(by.get("get_material")!.inputSchema).toMatchObject({ required: ["id"], properties: { id: { type: "string" }, part: { type: "integer" } } });
    expect(by.get("list_materials")!.annotations).toMatchObject({ readOnlyHint: true });
    const save = by.get("save_draft")!.inputSchema as { properties: Record<string, { type?: string; enum?: string[] }> };
    expect(save.properties.sources.type).toBe("array");
    expect(save.properties.show_sources.type).toBe("boolean");
    expect(save.properties.topic.enum).toEqual(["hair", "beard", "styling", "skin", "studio"]);
    expect(by.get("save_draft")!.description).toContain("list_materials");
    expect(by.get("list_materials")!.description).toContain("Материалы");
    expect(INSTRUCTIONS).toContain("Админка → Блог → «+ Статья» → Материалы");
    expect(INSTRUCTIONS).toContain("get_material");
  });
});

describe("the Помощник can start a draft from materials too", () => {
  const ID = "00000000-0000-4000-8000-0000000000aa";
  it("takes only material ids the prompt listed", () => {
    expect(sanitizeDraftFromMaterials({ about: "Angel", materials: [ID, "made-up"] }, new Set([ID]))).toEqual({ about: "Angel", materials: [ID], show_sources: false });
    expect(sanitizeDraftFromMaterials({ about: "Angel", materials: ["made-up"] }, new Set([ID]))).toBeNull();
    expect(sanitizeAction({ type: "draft_from_materials", materials: [ID], show_sources: true }, new Set(), true, { materialIds: new Set([ID]) }))
      .toEqual({ type: "draft_from_materials", about: "", materials: [ID], show_sources: true });
    // the shop chat cannot
    expect(sanitizeAction({ type: "draft_from_materials", materials: [ID] }, new Set(), false, { materialIds: new Set([ID]) })).toBeNull();
  });

  /* The PDF is read in the browser (public/shop2/app.js). What can be checked
     without one: how a page's lines become its heading, how a photo page
     takes the heading of the text page before it, and which are ticked. */
  it("labels each photo page with the heading of the text page before it, and ticks the ones the topic names", () => {
    const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
    const slice = (name: string) => {
      const start = app.indexOf(`function ${name}(`);
      let depth = 0;
      for (let i = app.indexOf("{", start); i < app.length; i++) {
        if (app[i] === "{") depth++;
        else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
      }
      throw new Error(name);
    };
    const stopVar = app.slice(app.indexOf("var BNEW_STOP = "), app.indexOf(";", app.indexOf("var BNEW_STOP = ")) + 1);
    const fns = new Function(`var BNEW_PRETICK_MAX = 8; ${stopVar} ${slice("bnewStems")} ${slice("bnewPageInfo")} ${slice("bnewPair")} ${slice("bnewPreTick")}
      return { bnewStems, bnewPageInfo, bnewPair, bnewPreTick };`)() as {
      bnewStems: (s: string) => string[];
      bnewPageInfo: (tc: unknown, ops: unknown, OPS: unknown, n: number) => { n: number; heading: string; text: string; photo: boolean; label: string; tick: boolean };
      bnewPair: (item: unknown) => void;
      bnewPreTick: (item: unknown, stems: string[]) => void;
    };
    // the panel's stems are the server's (topicStems)
    for (const about of ["Объём для тонких окрашенных волос: Angel и Plumping", "How to wash fine hair", "Habemeõli talvel"]) {
      expect(fns.bnewStems(about), about).toEqual(topicStems(about));
    }
    const OPS = { paintImageXObject: 85, paintInlineImageXObject: 86, paintImageXObjectRepeat: 88 };
    const line = (str: string, y: number, x = 50) => ({ str, transform: [1, 0, 0, 1, x, y] });
    const textPage = (n: number, head: string, body: string) => fns.bnewPageInfo(
      { items: [line(body, 600), line(head, 780), line("Шампунь для объёма", 750)] }, { fnArray: [1, 2] }, OPS, n);
    const photoPage = (n: number) => fns.bnewPageInfo({ items: [] }, { fnArray: [1, 85, 2] }, OPS, n);
    const pages = [
      fns.bnewPageInfo({ items: [line("HYDRATE", 700)] }, { fnArray: [85] }, OPS, 1),   // a coloured line opener: an image AND its word
      textPage(2, "ANGEL.WASH", "ПРИМЕНЕНИЕ: нанести на влажные волосы, тонкие и окрашенные."), photoPage(3),
      textPage(4, "HYDRATE-ME.WASH", "ПРЕИМУЩЕСТВА: увлажнение сухих волос."), photoPage(5),
    ];
    expect(pages[1]).toMatchObject({ heading: "ANGEL.WASH", photo: false });
    expect(pages[1].text.split("\n")[0]).toBe("ANGEL.WASH");             // top line first
    expect(pages[0].photo).toBe(true);                                 // a big word on a picture is still a photo page
    const item = { pdf: { pages } };
    fns.bnewPair(item);
    fns.bnewPreTick(item, fns.bnewStems("Тонкие окрашенные волосы: Angel"));
    expect(pages[2].label).toBe("ANGEL.WASH — фото");
    expect(pages[4].label).toBe("HYDRATE-ME.WASH — фото");
    expect(pages[0].label).toBe("Страница 1");
    expect(pages[2].tick).toBe(true);
    expect(pages[4].tick).toBe(true);                                  // «волос» is on that page too — the owner unticks it
    fns.bnewPreTick(item, fns.bnewStems("Angel"));
    expect([pages[2].tick, pages[4].tick]).toEqual([true, false]);
    fns.bnewPreTick(item, []);
    expect(pages.some((p) => p.tick)).toBe(false);                     // no topic, nothing ticked for him
  });

  it("the panel reads PDFs itself, lazily, from the self-hosted pinned build — and never on a shop page", () => {
    const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
    expect(app).toContain('var PDFJS_BASE = "/vendor/pdfjs-6.2.108/";');
    expect(app.match(/import\(PDFJS_BASE/g)).toHaveLength(1);
    expect(app).toContain('m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.mjs"');
    const index = readFileSync(fileURLToPath(new URL("../public/shop2/index.html", import.meta.url)), "utf8");
    expect(index).not.toContain("pdfjs");
    const lic = readFileSync(fileURLToPath(new URL("../public/vendor/pdfjs-6.2.108/LICENSE", import.meta.url)), "utf8");
    expect(lic).toContain("Apache License");
  });
});
