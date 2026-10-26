/**
 * The «Rempire» connector for Renat's Claude (Dim, 20.10.2026) — the sign-in
 * Claude runs (src/lib/mcp/oauth.ts, src/app/oauth/*, src/app/.well-known/*)
 * and the tools it gets (src/lib/mcp/tools.ts behind src/app/api/mcp).
 *
 * The flow is walked end to end the way Claude walks it: a 401 that names the
 * metadata, the metadata, registration, the sign-in page, the password, the
 * code, the token, then real tool calls against the test database — and the
 * doors that must stay shut: a wrong password, a foreign callback, a spent
 * code, a wrong verifier, a changed admin password, a published article.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, resetLoginDelays, resetRateLimits, setLoginSleeper } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { getPostBySlug, publishPost, upsertPost } from "@/lib/blog";
import { allowedRedirect, pkceOk, resetUsedCodes, sign, verify } from "@/lib/mcp/oauth";
import { resetProductCache, searchProducts, shopBody, productsNow } from "@/lib/mcp/tools";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const PASSWORD = "a long enough password";

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, { headers: { host: "rempireshop.com", ...headers } });
const post = (path: string, body: string, type: string, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, { method: "POST", headers: { host: "rempireshop.com", "content-type": type, ...headers }, body });

describe("oauth pieces", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
  });

  it("signs, and refuses a tampered, expired or wrong-kind token", () => {
    const t = sign("access", { aud: ORIGIN }, 60);
    expect(verify("access", t)?.aud).toBe(ORIGIN);
    expect(verify("refresh", t)).toBeNull();
    expect(verify("access", t.slice(0, -2) + "xx")).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ aud: "https://evil.example", k: "access" })).toString("base64url") + "." + sig;
    expect(verify("access", forged)).toBeNull();
    expect(verify("access", body)).toBeNull();
    expect(verify("access", t, Date.now() + 61_000)).toBeNull();
  });

  it("checks PKCE S256 with the RFC 7636 example", () => {
    expect(pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXX", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(pkceOk("short", "x")).toBe(false);
  });

  it("sends codes only to Claude's callback or a loopback address", () => {
    expect(allowedRedirect(CALLBACK)).toBe(true);
    expect(allowedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(allowedRedirect("http://localhost:33418/callback")).toBe(true);
    expect(allowedRedirect("http://127.0.0.1:9/callback")).toBe(true);
    expect(allowedRedirect("https://evil.example/cb")).toBe(false);
    expect(allowedRedirect("https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(allowedRedirect("http://user:pw@localhost/callback")).toBe(false);
  });
});

describe("the connector, end to end", () => {
  const savedHash = process.env.ADMIN_PASSWORD_HASH;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
    await setupDb();
  });
  afterAll(async () => {
    setLoginSleeper(null);
    await teardownDb();
    process.env.ADMIN_PASSWORD_HASH = savedHash;
  });
  beforeEach(async () => {
    resetRateLimits();
    resetLoginDelays();
    resetUsedCodes();
    resetProductCache();
    setLoginSleeper(async () => {});
    await truncateAll();
    await exec("truncate posts restart identity");
    await exec("truncate custom_products");
  });
  afterEach(() => {
    process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
  });

  /** register → sign in → code → tokens, the way Claude does it. */
  async function signIn(password = PASSWORD) {
    const reg = await (await import("@/app/oauth/register/route")).POST(
      post("/oauth/register", JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" }), "application/json"),
    );
    expect(reg.status).toBe(201);
    const clientId = (await reg.json()).client_id as string;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: challenge,
      code_challenge_method: "S256", state: "st-1", resource: ORIGIN + "/api/mcp",
    });
    const auth = await import("@/app/oauth/authorize/route");
    const page = await auth.GET(get("/oauth/authorize?" + q));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Пароль от админки магазина");
    expect(html).toContain("Опубликовать или удалить статью");
    // consent phishing: allow only a connection you started yourself
    expect(html).toContain("Если эту ссылку вам кто-то прислал — закройте страницу");
    q.set("password", password);
    const done = await auth.POST(post("/oauth/authorize", q.toString(), "application/x-www-form-urlencoded"));
    const doneHtml = await done.text();
    const href = /<a class="go" href="([^"]+)"/.exec(doneHtml)?.[1]?.replace(/&amp;/g, "&");
    return { clientId, verifier, status: done.status, doneHtml, back: href ? new URL(href) : null };
  }

  async function tokens() {
    const s = await signIn();
    expect(s.status).toBe(200);
    expect(s.back!.origin + s.back!.pathname).toBe(CALLBACK);
    expect(s.back!.searchParams.get("state")).toBe("st-1");
    const code = s.back!.searchParams.get("code")!;
    const { POST } = await import("@/app/oauth/token/route");
    const res = await POST(post("/oauth/token", new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: s.clientId, code_verifier: s.verifier,
    }).toString(), "application/x-www-form-urlencoded"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    return { ...(await res.json()), clientId: s.clientId, code, verifier: s.verifier };
  }

  async function call(token: string, method: string, params: Record<string, unknown> = {}, id = 1) {
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post("/api/mcp", JSON.stringify({ jsonrpc: "2.0", id, method, params }), "application/json", {
      authorization: "Bearer " + token, accept: "application/json, text/event-stream",
    }));
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  }
  const tool = async (token: string, name: string, args: Record<string, unknown>) => {
    const r = await call(token, "tools/call", { name, arguments: args });
    return { isError: !!r.body.result.isError, text: r.body.result.content[0].text as string };
  };

  it("answers an unsigned call with the 401 that starts Claude's sign-in, and serves the metadata it names", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post("/api/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), "application/json"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="blog"`);
    const pr = await (await (await import("@/app/.well-known/oauth-protected-resource/route")).GET(get("/.well-known/oauth-protected-resource"))).json();
    expect(pr).toMatchObject({ resource: ORIGIN + "/api/mcp", authorization_servers: [ORIGIN] });
    const as = await (await (await import("@/app/.well-known/oauth-authorization-server/route")).GET(get("/.well-known/oauth-authorization-server"))).json();
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: ORIGIN + "/oauth/authorize",
      token_endpoint: ORIGIN + "/oauth/token",
      registration_endpoint: ORIGIN + "/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(as.scopes_supported).toContain("offline_access");
  });

  it("registers Claude's callback and nothing else", async () => {
    const { POST } = await import("@/app/oauth/register/route");
    const bad = await POST(post("/oauth/register", JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }), "application/json"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_redirect_uri");
  });

  it("a wrong password gets no code, and is written to the journal the login delay counts", async () => {
    const s = await signIn("not the password");
    expect(s.status).toBe(401);
    expect(s.doneHtml).toContain("Неверный пароль");
    expect(s.back).toBeNull();
    const rows = await query("select action from admin_audit where action like 'admin.login%'");
    expect(JSON.stringify(rows)).toContain("admin.login.failed");
  });

  it("signs in, trades the code once, and talks MCP", async () => {
    const t = await tokens();
    expect(t.token_type).toBe("Bearer");
    expect(t.refresh_token).toBeTruthy();

    // the same code a second time is spent
    const { POST } = await import("@/app/oauth/token/route");
    const again = await POST(post("/oauth/token", new URLSearchParams({
      grant_type: "authorization_code", code: t.code, redirect_uri: CALLBACK, client_id: t.clientId, code_verifier: t.verifier,
    }).toString(), "application/x-www-form-urlencoded"));
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");

    const init = await call(t.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.capabilities.tools).toBeTruthy();
    expect(init.body.result.instructions).toContain("save_draft");
    expect((await call(t.access_token, "notifications/initialized")).status).toBe(200); // has an id here: answered as unknown method
    const { POST: MCP } = await import("@/app/api/mcp/route");
    const note = await MCP(post("/api/mcp", JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), "application/json", { authorization: "Bearer " + t.access_token }));
    expect(note.status).toBe(202);
    const list = await call(t.access_token, "tools/list");
    expect(list.body.result.tools.map((x: { name: string }) => x.name)).toEqual(
      ["search_products", "get_product", "list_sections", "list_posts", "get_post", "save_product_google_text",
        "save_product_description", "save_product_name", "save_product_price", "save_product_stock", "create_product",
        "get_page_texts", "save_page_text", "save_draft"],
    );
  });

  it("refuses a code whose verifier does not match", async () => {
    const s = await signIn();
    const { POST } = await import("@/app/oauth/token/route");
    const res = await POST(post("/oauth/token", new URLSearchParams({
      grant_type: "authorization_code", code: s.back!.searchParams.get("code")!, redirect_uri: CALLBACK, client_id: s.clientId,
      code_verifier: randomBytes(32).toString("base64url"),
    }).toString(), "application/x-www-form-urlencoded"));
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("refreshes, and a new admin password signs Claude out", async () => {
    const t = await tokens();
    const { POST } = await import("@/app/oauth/token/route");
    const fresh = await POST(post("/oauth/token", new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId }).toString(), "application/x-www-form-urlencoded"));
    expect(fresh.status).toBe(200);
    const next = await fresh.json();
    expect((await call(next.access_token, "ping")).body.result).toEqual({});

    process.env.ADMIN_PASSWORD_HASH = hashPassword("a brand new long password");
    expect((await call(next.access_token, "ping")).status).toBe(401);
    const dead = await POST(post("/oauth/token", new URLSearchParams({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: t.clientId }).toString(), "application/x-www-form-urlencoded"));
    expect((await dead.json()).error).toBe("invalid_grant");
  });

  it("finds the shop's products with their addresses in three languages", async () => {
    const t = await tokens();
    const r = await tool(t.access_token, "search_products", { query: "angel wash" });
    const j = JSON.parse(r.text);
    expect(j.products[0].id).toBe("kevin-murphy-angel-wash");
    expect(j.products[0].url).toEqual({
      RU: ORIGIN + "/ru/products/kevin-murphy-angel-wash",
      ET: ORIGIN + "/et/products/kevin-murphy-angel-wash",
      EN: ORIGIN + "/products/kevin-murphy-angel-wash",
    });
    const one = JSON.parse((await tool(t.access_token, "get_product", { id: "kevin-murphy-angel-wash" })).text);
    expect(one.names.RU).toContain("ANGEL.WASH");
    expect(one.sizes.length).toBeGreaterThan(0);
    expect(Array.isArray(one.photos)).toBe(true);
    expect((await tool(t.access_token, "get_product", { id: "made-up" })).isError).toBe(true);
    const sections = JSON.parse((await tool(t.access_token, "list_sections", {})).text);
    expect(sections.sections.map((s: { id: string }) => s.id)).toContain("beard");
    expect(sections.brands.find((b: { name: string }) => b.name === "Kevin.Murphy")).toBeTruthy();
  });

  it("saves a new draft with the shop's links and cards, never published, and lists it", async () => {
    const t = await tokens();
    const r = await tool(t.access_token, "save_draft", {
      ru: {
        title: "Kevin.Murphy: какой выбрать шампунь",
        excerpt: "Коротко о шампунях.",
        body: '<h2>Для тонких волос</h2><p>Возьмите <a href="https://rempireshop.com/ru/products/kevin-murphy-angel-wash">Angel.Wash</a> — и не берите <a href="/ru/products/made-up">выдумку</a>.</p>' +
          '<p><a data-product="kevin-muprhy-hydrate-me-wash"></a></p><script>alert(1)</script>',
      },
      tags: ["шампунь", "kevin.murphy"],
    });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: "created", status: "draft", languages: ["RU"] });
    const p = await getPostBySlug(out.slug);
    expect(p!.status).toBe("draft");
    expect(p!.body.RU).toContain('<a href="/ru/products/kevin-murphy-angel-wash">Angel.Wash</a>');
    expect(p!.body.RU).toContain("выдумку");
    expect(p!.body.RU).not.toContain("made-up");
    expect(p!.body.RU).toMatch(/<a data-product="kevin-muprhy-hydrate-me-wash" data-price="live" href="\/ru\/products\/kevin-muprhy-hydrate-me-wash">Kevin\.Murphy HYDRATE-ME\.WASH/);
    expect(p!.body.RU).not.toContain("script");
    expect(p!.products).toEqual(["kevin-murphy-angel-wash", "kevin-muprhy-hydrate-me-wash"]);
    const posts = JSON.parse((await tool(t.access_token, "list_posts", {})).text);
    expect(posts[0]).toMatchObject({ slug: out.slug, status: "draft" });

    // changing that draft keeps what was not sent; a published article is refused
    const again = JSON.parse((await tool(t.access_token, "save_draft", {
      slug: out.slug, ru: { title: "Kevin.Murphy: шампуни", body: "<p>Новый текст про Angel.Wash.</p>" },
      en: { title: "Kevin.Murphy shampoos", body: '<p>Try <a href="product:kevin-murphy-angel-wash">Angel.Wash</a>.</p>' },
    })).text);
    expect(again).toMatchObject({ saved: "changed", slug: out.slug, languages: ["RU", "EN"] });
    const p2 = await getPostBySlug(out.slug);
    expect(p2!.title.RU).toBe("Kevin.Murphy: шампуни");
    expect(p2!.body.EN).toContain('<a href="/products/kevin-murphy-angel-wash">Angel.Wash</a>');
    expect(p2!.tags).toEqual(["шампунь", "kevin.murphy"]);
    await publishPost(p2!.id);
    const refused = await tool(t.access_token, "save_draft", { slug: out.slug, ru: { title: "x", body: "<p>y</p>" } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("published");
    expect((await getPostBySlug(out.slug))!.title.RU).toBe("Kevin.Murphy: шампуни");
  });

  it("holds «drafts only» in the write itself — an article published in between is not touched", async () => {
    const made = await upsertPost({ title: { RU: "Черновик" }, body: { RU: "<p>Текст.</p>" } });
    await publishPost(made.id);
    await expect(upsertPost({ id: made.id, title: { RU: "Подмена" }, body: { RU: "<p>x</p>" } }, { onlyDraft: true }))
      .rejects.toMatchObject({ code: "not_draft" });
    expect((await getPostBySlug(made.slug))!.title.RU).toBe("Черновик");
  });

  it("takes the shop's own product photos as the cover and in the text, and nothing else; all three languages at once", async () => {
    const t = await tokens();
    const prod = JSON.parse((await tool(t.access_token, "get_product", { id: "kevin-murphy-angel-wash" })).text);
    expect(prod.photos.length).toBeGreaterThan(0);
    const photo = prod.photos[0] as string;
    expect(photo).toMatch(/^https:\/\/rempireshop\.com\//);
    const out = JSON.parse((await tool(t.access_token, "save_draft", {
      cover: "kevin-murphy-angel-wash",
      ru: { title: "Фото", body: `<p>Текст.</p><figure data-fig="half-right"><img src="${photo}" alt="Angel.Wash"></figure><figure data-fig="full"><img src="https://stock.example/x.jpg" alt=""></figure>` },
      et: { title: "Foto", body: '<p>Proovi <a href="product:kevin-murphy-angel-wash">Angel.Wash</a>.</p><p><a data-product="kevin-murphy-angel-wash"></a></p>' },
      en: { title: "Photo", body: '<p>Try <a href="https://rempireshop.com/products/kevin-murphy-angel-wash">Angel.Wash</a>.</p>' },
    })).text);
    expect(out).toMatchObject({ saved: "created", languages: ["RU", "ET", "EN"], cover: "set" });
    const p = await getPostBySlug(out.slug);
    expect(p!.coverUrl).toBe(photo);
    expect(p!.body.RU).toContain(`<figure data-fig="half-right"><img src="${photo}" alt="Angel.Wash"`);
    expect(p!.body.RU).not.toContain("stock.example");
    expect(p!.body.RU).not.toContain('<figure data-fig="full">');
    expect(p!.body.ET).toContain('<a href="/et/products/kevin-murphy-angel-wash">Angel.Wash</a>');
    expect(p!.body.ET).toMatch(/<a data-product="kevin-murphy-angel-wash" data-price="live" href="\/et\/products\/kevin-murphy-angel-wash">/);
    expect(p!.body.EN).toContain('<a href="/products/kevin-murphy-angel-wash">Angel.Wash</a>');
    const bad = await tool(t.access_token, "save_draft", { cover: "https://stock.example/x.jpg", ru: { title: "x", body: "<p>y</p>" } });
    expect(bad.isError).toBe(true);
  });

  /* Renat's panel button wrote «других сведений нет» into 29 products' Google
     texts (25.10.2026); his Claude writes them now — checked the way the
     panel's answer is, live, and back with «Вернуть» from the journal. */
  it("writes a product's Google texts, keeps the languages it was not given, and journals the old ones for «Вернуть»", async () => {
    const { getSeoOverride, setSeoOverride } = await import("@/lib/product-seo");
    const { listAudit } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const id = "kevin-murphy-angel-wash";
    await setSeoOverride(id, { RU: { title: "Старый заголовок", desc: "Старое описание." } });

    const r = await tool(t.access_token, "save_product_google_text", {
      id,
      et: { title: "Kevin.Murphy Angel.Wash — šampoon", description: "Õrn šampoon peentele ja värvitud juustele: puhastab ja lisab kohevust." },
      en: { title: "Kevin.Murphy Angel.Wash — shampoo", description: "A gentle shampoo for fine, coloured hair: cleanses and adds volume." },
    });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.parse(r.text).saved).toEqual(["et", "en"]);
    const seo = await getSeoOverride(id);
    expect(seo!.RU).toEqual({ title: "Старый заголовок", desc: "Старое описание." });
    expect(seo!.ET!.title).toBe("Kevin.Murphy Angel.Wash — šampoon");
    expect(seo!.EN!.desc).toContain("fine, coloured hair");
    const read = JSON.parse((await tool(t.access_token, "get_product", { id })).text);
    expect(read.google_text.et.title).toBe("Kevin.Murphy Angel.Wash — šampoon");

    // the journal line puts the old pair back from any device
    const rows = journalRows(await listAudit(10));
    const line = rows.find((x) => x.action === "override.set" && (x.payload as { id?: string }).id === id);
    expect(line!.undo).toEqual({ kind: "override", id, patch: { seo: { RU: { title: "Старый заголовок", desc: "Старое описание." } } } });
  });

  it("refuses a Google text that is too long, talks about missing data, or is Russian on the Estonian page — and saves nothing", async () => {
    const { getSeoOverride } = await import("@/lib/product-seo");
    const t = await tokens();
    const id = "kevin-murphy-angel-wash";
    const pair = (title: string, description: string) => ({ title, description });
    const refused = [
      { id, ru: pair("К".repeat(71), "Шампунь для тонких волос.") },
      { id, ru: pair("Kevin.Murphy Angel.Wash — шампунь", "Шампунь для ухода за волосами. Других сведений о продукте нет.") },
      { id, en: pair("Kevin.Murphy Angel.Wash — shampoo", "A shampoo for hair care. The catalogue gives no further product details.") },
      { id, et: pair("Kevin.Murphy Angel.Wash — шампунь", "Õrn šampoon peentele juustele.") },
      { id: "made-up", ru: pair("Заголовок", "Описание товара.") },
      { id },
    ];
    for (const args of refused) {
      const r = await tool(t.access_token, "save_product_google_text", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.text).toContain("Nothing was saved");
    }
    expect(await getSeoOverride(id)).toBeNull();
  });

  /* 26.10.2026 — Dim: «he needs to be able to manage his shop». The page
     text and the name too: checked like the panel's fields, written where
     the panel keeps them, each back with «Вернуть». */
  it("writes a product's page text, keeps the languages it was not given, hands it back with its paragraphs, and journals the old one", async () => {
    const { getDescriptionOverride, setDescriptionOverride } = await import("@/lib/product-descriptions");
    const { listAudit } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const id = "kevin-murphy-angel-wash";
    await setDescriptionOverride(id, { EN: "Old English text." });
    const ru = "Мягкий шампунь для тонких волос.\n\nПодходит для окрашенных волос:\n— очищает бережно\n— добавляет объём";

    const r = await tool(t.access_token, "save_product_description", { id, ru, et: "Õrn šampoon peentele juustele." });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.parse(r.text).saved).toEqual(["ru", "et"]);
    expect(await getDescriptionOverride(id)).toEqual({ RU: ru, ET: "Õrn šampoon peentele juustele.", EN: "Old English text." });

    resetProductCache();
    const read = JSON.parse((await tool(t.access_token, "get_product", { id })).text);
    expect(read.description.RU).toBe(ru);
    expect(read.description_by_owner).toEqual(["RU", "ET", "EN"]);
    expect(read.section.id).toBe("hair");

    const line = journalRows(await listAudit(10)).find((x) => x.action === "override.set" && (x.payload as { id?: string }).id === id);
    expect(line!.undo).toEqual({ kind: "override", id, patch: { description: { EN: "Old English text." } } });
  });

  it("refuses page text with HTML or markdown, Russian on the Estonian page, talk about missing data, or nothing in it — and saves nothing", async () => {
    const { getDescriptionOverride } = await import("@/lib/product-descriptions");
    const t = await tokens();
    const id = "kevin-murphy-angel-wash";
    const refused = [
      { id, ru: "<p>Шампунь для волос.</p>" },
      { id, ru: "**Шампунь** для волос." },
      { id, ru: "## Шампунь\n\nДля волос." },
      { id, et: "Õrn шампунь peentele juustele." },
      { id, en: "A gentle shampoo. No further product details are given." },
      { id, ru: "   " },
      { id: "made-up", ru: "Текст." },
      { id },
    ];
    for (const args of refused) {
      const r = await tool(t.access_token, "save_product_description", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.text).toContain("Nothing was saved");
    }
    expect(await getDescriptionOverride(id)).toBeNull();
  });

  it("renames a catalogue product under the same id, moves its section, journals the old one — and refuses a name a language could not say", async () => {
    const { getOverrideRow, listAudit, upsertOverride } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const id = "kevin-murphy-angel-wash";
    await upsertOverride(id, { subcat: "shampoo-oily" });

    const bad = await tool(t.access_token, "save_product_name", { id, name: "Angel.Wash — эликсир свежести" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Nothing was saved");
    expect(bad.text).toContain("шампунь, кондиционер");   // the words that work
    expect((await getOverrideRow(id))?.name ?? null).toBeNull();

    const r = await tool(t.access_token, "save_product_name", { id, name: "Angel.Wash Gentle — шампунь для волос", section: "styling" });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.parse(r.text)).toMatchObject({
      id, saved: ["name", "section"],
      names: { ET: "Angel.Wash Gentle — šampoon juustele", EN: "Angel.Wash Gentle — shampoo for hair" },
    });
    expect(await getOverrideRow(id)).toMatchObject({ name: "Angel.Wash Gentle — шампунь для волос", cat: "styling", subcat: null });
    resetProductCache();
    expect(JSON.parse((await tool(t.access_token, "get_product", { id })).text).names.RU).toBe("Angel.Wash Gentle — шампунь для волос");

    const line = journalRows(await listAudit(10))
      .find((x) => x.action === "override.set" && (x.payload as { via?: string }).via === "claude");
    expect(line!.undo).toEqual({ kind: "override", id, patch: { name: null, cat: null, subcat: "shampoo-oily" } });
  });

  /* 26.10.2026 (Dim): a product's subsection is its own, not its name's — and
     it decides which subcollection page Google reads it on, so Claude reads
     and writes it as the panel's «Подраздел» does. */
  it("reads and sets a product's subsection — by id or label, none with \"\" — and lists each section's", async () => {
    const { getOverrideRow } = await import("@/lib/orders");
    const { getCustomProduct } = await import("@/lib/custom-products");
    const t = await tokens();
    const id = "davines-softening-shaving-gel";
    const sub = async () => JSON.parse((await tool(t.access_token, "get_product", { id })).text).subsection;
    expect(await sub()).toEqual({ id: "ge", RU: "Гели" });

    const r = await tool(t.access_token, "save_product_name", { id, subsection: "После бритья" });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.parse(r.text)).toMatchObject({ saved: ["subsection"], subsection: "После бритья" });
    expect((await getOverrideRow(id))?.subcat).toBe("af");
    resetProductCache();
    expect(await sub()).toEqual({ id: "af", RU: "После бритья" });

    expect((await tool(t.access_token, "save_product_name", { id, subsection: "" })).isError).toBe(false);
    expect((await getOverrideRow(id))?.subcat).toBe("-");
    resetProductCache();
    expect(await sub()).toBeNull();

    const bad = await tool(t.access_token, "save_product_name", { id, subsection: "Шампуни" });   // a hair chip
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Nothing was saved");
    expect((await getOverrideRow(id))?.subcat).toBe("-");

    const sections = JSON.parse((await tool(t.access_token, "list_sections", {})).text).sections;
    const beard = sections.find((s: { id: string }) => s.id === "beard");
    expect(beard.subsections.map((s: { id: string }) => s.id)).toEqual(["oi", "ba", "af", "ge", "mw"]);
    expect(beard.subsections.find((s: { id: string }) => s.id === "mw").url.EN).toMatch(/\/collections\/beard-and-mustache-wax$/);
    expect(beard.subsections.find((s: { id: string }) => s.id === "af").url.ET).toMatch(/\/et\/collections\/raseerimisjargne-hooldus$/);
    expect(beard.subsections.find((s: { id: string }) => s.id === "ge").url).toBeUndefined();   // a chip, no page
    expect(sections.find((s: { id: string }) => s.id === "perfume").subsections).toEqual([]);

    const made = await tool(t.access_token, "create_product", {
      brand: "Captain Fawcett", name: "Maharajah Beard Balm — бальзам для бороды", section: "beard", subsection: "ba", price: 24.9,
    });
    expect(made.isError, made.text).toBe(false);
    const ownId = JSON.parse(made.text).created;
    expect(JSON.parse(made.text).subsection).toBe("Бальзамы");
    expect((await getCustomProduct(ownId))?.subcat).toBe("ba");
  });

  it("writes the owner's own product on its own row — text, Google pair, name — even while it is hidden, each with «Вернуть»", async () => {
    const { createCustomProduct, getCustomProduct, setCustomProductActive } = await import("@/lib/custom-products");
    const { getDescriptionOverride } = await import("@/lib/product-descriptions");
    const { getSeoOverride } = await import("@/lib/product-seo");
    const { listAudit } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const own = await createCustomProduct({ brand: "FLAWLESS", name: "Bond Building Styling Lotion — лосьон", cat: "styling", price: 24.9 });
    await setCustomProductActive(own.id, false);

    const d = await tool(t.access_token, "save_product_description", { id: own.id, ru: "Лосьон для укладки.", en: "A styling lotion." });
    expect(d.isError, d.text).toBe(false);
    const g = await tool(t.access_token, "save_product_google_text", {
      id: own.id, ru: { title: "FLAWLESS Bond Building Styling Lotion — лосьон", description: "Лосьон для укладки, который бережёт волосы." },
    });
    expect(g.isError, g.text).toBe(false);
    const n = await tool(t.access_token, "save_product_name", { id: own.id, name: "Bond Building Styling Lotion — лосьон для укладки" });
    expect(n.isError, n.text).toBe(false);

    expect(await getCustomProduct(own.id)).toMatchObject({
      name: "Bond Building Styling Lotion — лосьон для укладки",
      description: { RU: "Лосьон для укладки.", EN: "A styling lotion." },
      seo: { RU: { title: "FLAWLESS Bond Building Styling Lotion — лосьон" } },
      active: false,
    });
    // nothing in product_overrides, where it would shadow the row in the open shop
    expect(await getDescriptionOverride(own.id)).toBeNull();
    expect(await getSeoOverride(own.id)).toBeNull();
    expect(journalRows(await listAudit(10)).filter((x) => x.action === "product.update").map((x) => x.undo)).toEqual([
      { kind: "product", id: own.id, patch: { name: "Bond Building Styling Lotion — лосьон" } },
      { kind: "product", id: own.id, patch: { seo: null } },
      { kind: "product", id: own.id, patch: { description: null } },
    ]);
  });

  /* 26.10.2026 — prices and counts by Claude: a big price move only after
     the owner's yes, a count only over the count Claude read. */
  it("changes a price a little at once, a big change only with confirm — and «Вернуть» goes back to the catalogue's ladder", async () => {
    const { getOverrideRow, listAudit } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const multi = (await productsNow()).list.find((p) => p.sizes.length > 1 && p.sizes.every((s) => s.label))!;
    const was = multi.sizes.map((s) => ({ size: s.label!, price: s.price }));
    const small = Math.round(was[0].price * 110) / 100;
    const half = Math.round(was[1].price * 50) / 100;

    const r = await tool(t.access_token, "save_product_price", { id: multi.id, prices: [{ size: was[0].size, price: small }] });
    expect(r.isError, r.text).toBe(false);
    const ladder = was.map((s, i) => (i === 0 ? { ...s, price: small } : s));
    expect(await getOverrideRow(multi.id)).toMatchObject({ sizes: ladder, price: small });

    const big = await tool(t.access_token, "save_product_price", { id: multi.id, prices: [{ size: was[1].size, price: half }] });
    expect(big.isError).toBe(true);
    expect(big.text).toContain("confirm: true");
    expect(big.text).toContain("Nothing was saved");
    const yes = await tool(t.access_token, "save_product_price", { id: multi.id, prices: [{ size: was[1].size, price: half }], confirm: true });
    expect(yes.isError, yes.text).toBe(false);
    resetProductCache();
    expect((await productsNow()).list.find((p) => p.id === multi.id)!.sizes.slice(0, 2).map((s) => s.price)).toEqual([small, half]);

    for (const bad of [{ size: "999 л", price: 10 }, { size: was[0].size, price: 0 }]) {
      const r2 = await tool(t.access_token, "save_product_price", { id: multi.id, prices: [bad], confirm: true });
      expect(r2.isError, JSON.stringify(bad)).toBe(true);
    }
    const lines = journalRows(await listAudit(20)).filter((x) => x.action === "override.set" && (x.payload as { via?: string }).via === "claude");
    expect(lines.at(-1)!.undo).toEqual({ kind: "override", id: multi.id, patch: { sizes: null, price: null } });
  });

  /* security review, 26.10.2026: each step under 30 % must not add up to a big
     move — the guard measures against the price before the day's first change */
  it("does not let small steps add up past 30 % within a day", async () => {
    const t = await tokens();
    const multi = (await productsNow()).list.find((p) => p.sizes.length > 1 && p.sizes.every((s) => s.label))!;
    const size = multi.sizes[0].label!;
    const start = multi.sizes[0].price;
    const step = (k: number) => Math.round(start * k * 100) / 100;
    expect((await tool(t.access_token, "save_product_price", { id: multi.id, prices: [{ size, price: step(0.8) }] })).isError).toBe(false);
    const second = await tool(t.access_token, "save_product_price", { id: multi.id, prices: [{ size, price: step(0.6) }] });
    expect(second.isError).toBe(true);
    expect(second.text).toContain("before today's changes");
    expect((await tool(t.access_token, "save_product_price", { id: multi.id, prices: [{ size, price: step(0.6) }], confirm: true })).isError).toBe(false);
  });

  it("prices the owner's own product on its row, with «Вернуть»", async () => {
    const { createCustomProduct, getCustomProduct } = await import("@/lib/custom-products");
    const { listAudit } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const own = await createCustomProduct({ brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] });
    const r = await tool(t.access_token, "save_product_price", { id: own.id, prices: [{ size: "250 мл", price: 26.9 }] });
    expect(r.isError, r.text).toBe(false);
    expect(await getCustomProduct(own.id)).toMatchObject({ sizes: ["100 мл", "250 мл"], prices: [14.9, 26.9] });
    const line = journalRows(await listAudit(10)).find((x) => x.action === "product.update");
    expect(line!.undo).toEqual({ kind: "product", id: own.id, patch: { sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] } });
  });

  it("sets a count only over the count it read — a sale in between is not wiped", async () => {
    const { listMoves, move } = await import("@/lib/inventory");
    const t = await tokens();
    const multi = (await productsNow()).list.find((p) => p.sizes.length > 1 && p.sizes.every((s) => s.label))!;
    const size = multi.sizes[0].label!;
    const count = async () => JSON.parse((await tool(t.access_token, "get_product", { id: multi.id })).text).stock_count[0];
    expect(await count()).toEqual({ size, count: null });

    const first = await tool(t.access_token, "save_product_stock", { id: multi.id, size, count: 6, was: null });
    expect(first.isError, first.text).toBe(false);
    expect(JSON.parse(first.text)).toMatchObject({ size, was: null, count: 6, shop_says: "в наличии" });

    await move({ productId: multi.id, variant: size, delta: -1, reason: "sale_web", ref: "R-100001", actor: "system" });
    const stale = await tool(t.access_token, "save_product_stock", { id: multi.id, size, count: 4, was: 6 });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("is now 5 pcs");
    expect(stale.text).toContain("Nothing was saved");
    expect(await count()).toEqual({ size, count: 5 });

    const fixed = await tool(t.access_token, "save_product_stock", { id: multi.id, size, count: 4, was: 5 });
    expect(fixed.isError, fixed.text).toBe(false);
    expect(await count()).toEqual({ size, count: 4 });
    expect((await listMoves({ productId: multi.id }))[0]).toMatchObject({ delta: -1, reason: "adjust", ref: "Claude", actor: "claude" });

    expect((await tool(t.access_token, "save_product_stock", { id: multi.id, count: 1, was: 4 })).text).toContain("Which size?");
  });

  /* step 4 of Dim's list (26.10.2026): a new product, hidden until the owner
     adds photos and shows it in the panel. */
  it("creates a new product hidden — readable and changeable by its id, never in the shop, never twice", async () => {
    const { getCustomProduct } = await import("@/lib/custom-products");
    const { listAudit } = await import("@/lib/orders");
    const t = await tokens();
    const args = {
      brand: "FLAWLESS",
      name: "Bond Building Styling Lotion — лосьон для укладки",
      section: "styling",
      sizes: [{ size: "100 мл", price: 24.9 }, { size: "250 мл", price: 39.9 }],
      description: { ru: "Лосьон для укладки, который укрепляет волосы.", en: "A styling lotion that strengthens hair." },
    };
    const r = await tool(t.access_token, "create_product", args);
    expect(r.isError, r.text).toBe(false);
    const made = JSON.parse(r.text);
    expect(made).toMatchObject({
      hidden: true, brand: "FLAWLESS", description: ["ru", "en"],
      names: { EN: "Bond Building Styling Lotion — lotion for styling" },
    });
    const id = made.created as string;
    expect(await getCustomProduct(id)).toMatchObject({ active: false, cat: "styling", sizes: ["100 мл", "250 мл"], prices: [24.9, 39.9] });
    expect((await listAudit(5)).find((x) => x.action === "product.create")?.payload).toMatchObject({ id, via: "claude", hidden: true });

    resetProductCache();
    expect((await productsNow()).list.some((p) => p.id === id)).toBe(false);
    const read = JSON.parse((await tool(t.access_token, "get_product", { id })).text);
    expect(read).toMatchObject({ id, hidden: true, url: null, description: { RU: args.description.ru } });
    expect(JSON.parse((await tool(t.access_token, "search_products", { query: "FLAWLESS Bond" })).text).found).toBe(0);
    const withHidden = JSON.parse((await tool(t.access_token, "search_products", { query: "FLAWLESS Bond", include_hidden: true })).text);
    expect(withHidden.products[0]).toMatchObject({ id, hidden: true, url: null });

    const again = await tool(t.access_token, "create_product", args);
    expect(again.isError).toBe(true);
    expect(again.text).toContain(id);
    for (const bad of [
      { ...args, name: "Bond Lotion — эликсир" },
      { ...args, name: "Another Lotion — лосьон", sizes: undefined },
      { ...args, name: "Third Lotion — лосьон", section: "kitchen" },
      { ...args, name: "Fourth Lotion — лосьон", description: { et: "Juuksesprei для волос." } },
    ]) {
      const refused = await tool(t.access_token, "create_product", JSON.parse(JSON.stringify(bad)));
      expect(refused.isError, bad.name).toBe(true);
      expect(refused.text).toContain("Nothing was created");
    }
  });

  /* «Тексты страниц» by Claude (26.10.2026): a section's or brand's Google
     pair and the line under its heading, in settings.page_texts. */
  it("reads and writes a section's and a brand's page texts, «» gives a field back, and the journal keeps the old ones", async () => {
    const { getSettingRaw, listAudit } = await import("@/lib/orders");
    const { journalRows } = await import("@/lib/audit-undo");
    const t = await tokens();
    const before = JSON.parse((await tool(t.access_token, "get_page_texts", { page: "section", key: "beard" })).text);
    expect(before.texts.RU.by_owner).toEqual([]);
    expect(before.texts.EN.intro).toContain("Beard oil");

    const r = await tool(t.access_token, "save_page_text", {
      page: "section", key: "beard",
      et: { intro: "Habemeõlid, palsamid ja raseerimistooted — meie barberite valik Mardi 1 salongist." },
      en: { title: "Beard Care: Oils, Balms & Shaving" },
    });
    expect(r.isError, r.text).toBe(false);
    const after = JSON.parse(r.text).texts;
    expect(after.ET.intro).toContain("meie barberite valik");
    expect(after.ET.by_owner).toEqual(["intro"]);
    expect(after.EN.title).toBe("Beard Care: Oils, Balms & Shaving");
    expect(after.RU).toEqual(before.texts.RU);

    const brand = await tool(t.access_token, "save_page_text", { page: "brand", key: "kevin.murphy", ru: { intro: "Kevin.Murphy — австралийский уход для волос." } });
    expect(brand.isError, brand.text).toBe(false);
    expect(JSON.parse(brand.text).key).toBe("Kevin.Murphy");

    const back = await tool(t.access_token, "save_page_text", { page: "section", key: "beard", en: { title: "" } });
    expect(back.isError, back.text).toBe(false);
    expect(JSON.parse(back.text).texts.EN.title).toBe(before.texts.EN.title);
    expect((await getSettingRaw("page_texts")).value).toEqual({
      cat: { beard: { ET: { intro: "Habemeõlid, palsamid ja raseerimistooted — meie barberite valik Mardi 1 salongist." } } },
      brand: { "Kevin.Murphy": { RU: { intro: "Kevin.Murphy — австралийский уход для волос." } } },
    });

    const first = journalRows(await listAudit(10)).filter((x) => x.action === "setting.set").at(-1)!;
    expect(first.undo).toMatchObject({ kind: "setting", key: "page_texts" });
  });

  /* Dim, 26.10.2026: the page texts can be translated — Claude reads the
     owner's Russian and saves its Estonian and English the same way */
  it("translates the owner's own Russian page text into et and en", async () => {
    const { INSTRUCTIONS } = await import("@/lib/mcp/tools");
    expect(INSTRUCTIONS).toContain("translate his words faithfully into et and en");
    const t = await tokens();
    await tool(t.access_token, "save_page_text", { page: "section", key: "styling", ru: { intro: "Воск, паста и глина — укладка от наших барберов." } });
    const read = JSON.parse((await tool(t.access_token, "get_page_texts", { page: "section", key: "styling" })).text);
    expect(read.texts.RU).toMatchObject({ intro: "Воск, паста и глина — укладка от наших барберов.", by_owner: ["intro"] });
    expect(read.texts.ET.by_owner).toEqual([]);
    const r = await tool(t.access_token, "save_page_text", {
      page: "section", key: "styling",
      et: { intro: "Vaha, pasta ja savi — soeng meie barberitelt." },
      en: { intro: "Wax, paste and clay — styling from our barbers." },
    });
    expect(r.isError, r.text).toBe(false);
    const texts = JSON.parse(r.text).texts;
    expect([texts.RU.by_owner, texts.ET.by_owner, texts.EN.by_owner]).toEqual([["intro"], ["intro"], ["intro"]]);
    expect(texts.EN.intro).toBe("Wax, paste and clay — styling from our barbers.");
  });

  it("refuses page texts that are too long, Russian on the Estonian page, or for a page the shop does not have — and saves nothing", async () => {
    const { getSettingRaw } = await import("@/lib/orders");
    const t = await tokens();
    for (const args of [
      { page: "section", key: "beard", et: { title: "Habe — масло для бороды" } },
      { page: "section", key: "beard", ru: { title: "Б".repeat(71) } },
      { page: "section", key: "beard", en: { description: "Beard care. No further product details are given." } },
      { page: "section", key: "kitchen", ru: { intro: "Кухня." } },
      { page: "brand", key: "Nobody Brand", ru: { intro: "Текст." } },
      { page: "section", key: "beard" },
    ]) {
      const r = await tool(t.access_token, "save_page_text", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
    expect((await getSettingRaw("page_texts")).found).toBe(false);
  });

  it("reads an article back in the language asked for", async () => {
    const t = await tokens();
    const made = await upsertPost({ title: { RU: "Борода зимой", ET: "Habe talvel" }, body: { RU: "<p>Масло.</p>", ET: "<p>Õli.</p>" } });
    const r = JSON.parse((await tool(t.access_token, "get_post", { slug: made.slug, lang: "ET" })).text);
    expect(r).toMatchObject({ title: "Habe talvel", body: "<p>Õli.</p>", written_in: ["RU", "ET"] });
  });
});

describe("shopBody and searchProducts", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);

  it("takes markdown too, and points every product link at this language's page", async () => {
    resetProductCache();
    const { list } = await productsNow();
    const byId = new Map(list.map((p) => [p.id, p]));
    const md = shopBody("## Шампуни\n\nВозьмите [Angel.Wash](https://rempireshop.com/products/kevin-murphy-angel-wash).", "ET", byId);
    expect(md.html).toContain("<h2>Шампуни</h2>");
    expect(md.html).toContain('<a href="/et/products/kevin-murphy-angel-wash">Angel.Wash</a>');
    expect(md.ids).toEqual(["kevin-murphy-angel-wash"]);
    // a picture dressed up to look allowed is still judged by the address the sanitiser keeps
    const photo = list.find((p) => p.id === "kevin-murphy-angel-wash")!.photos[0];
    const dressed = shopBody(`<p>x</p><IMG alt='src="${photo}"' SRC='https://evil.example/x.jpg'><img data-src="${photo}" src="https://evil.example/y.jpg">`, "RU", byId, new Set([photo]));
    expect(dressed.html).not.toContain("evil.example");
    expect(dressed.html).not.toContain("<img");
    const fine = shopBody(`<p>x</p><img src="${photo}" alt="Angel">`, "RU", byId, new Set([photo]));
    expect(fine.html).toContain(`<img src="${photo}" alt="Angel"`);
    const found = searchProducts(list, "kevin murphy шампунь", 25).map((p) => p.id);
    expect(found).toContain("kevin-murphy-angel-wash");
    expect(searchProducts(list, "", 5)).toEqual([]);
  });
});

/* The admin's «Блог» list — a draft Claude saved shows without a reload
   (Dim, testing the connector, 20.10.2026: «the draft did not appear
   instantly»). loadAdminBlog() cut out of app.js and run against stubs. */
describe("the admin blog list refreshes itself", () => {
  const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  const src = (() => {
    const at = APP.indexOf("function loadAdminBlog(force)");
    let depth = 0;
    for (let i = APP.indexOf("{", at); i < APP.length; i++) {
      if (APP[i] === "{") depth++;
      else if (APP[i] === "}" && --depth === 0) return APP.slice(at, i + 1);
    }
    throw new Error("no loadAdminBlog");
  })();
  function panel(S: Record<string, unknown>, answer: unknown) {
    const calls: string[] = [];
    let renders = 0;
    const run = new Function("S", "SRV", "apiJson", "render", `${src}\nreturn loadAdminBlog;`)(
      S, {},
      (u: string) => { calls.push(u); return answer === "throw" ? Promise.reject(new Error("x")) : Promise.resolve(answer); },
      () => { renders++; },
    ) as (force: boolean) => void;
    return { run, calls, renders: () => renders };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const posts = (...slugs: string[]) => slugs.map((s) => ({ slug: s, status: "draft", updatedAt: "t" }));

  it("asks again once the list is half a minute old, and draws only what changed", async () => {
    const S: Record<string, unknown> = { screen: "admin", adminTab: "blog", adminBlog: posts("a"), adminBlogAt: Date.now() - 31_000 };
    const p = panel(S, { status: 200, body: { ok: true, posts: posts("claude-draft", "a") } });
    p.run(false);
    await tick();
    expect(p.calls).toEqual(["/api/admin/blog/"]);
    expect((S.adminBlog as Array<{ slug: string }>).map((x) => x.slug)).toEqual(["claude-draft", "a"]);
    expect(p.renders()).toBe(1);
  });

  it("does not ask while the list is fresh, and never redraws over an open article", async () => {
    const fresh: Record<string, unknown> = { screen: "admin", adminTab: "blog", adminBlog: posts("a"), adminBlogAt: Date.now() };
    const p1 = panel(fresh, { status: 200, body: { ok: true, posts: posts("a") } });
    p1.run(false);
    expect(p1.calls).toEqual([]);
    const editing: Record<string, unknown> = { screen: "admin", adminTab: "blog", adminBlog: posts("a"), adminBlogAt: 0, adminBlogEdit: {} };
    const p2 = panel(editing, { status: 200, body: { ok: true, posts: posts("b", "a") } });
    p2.run(false);
    await tick();
    expect(p2.calls).toHaveLength(1);
    expect(p2.renders()).toBe(0);
  });

  it("a background refresh that fails keeps the list and says nothing", async () => {
    const S: Record<string, unknown> = { screen: "admin", adminTab: "blog", adminBlog: posts("a"), adminBlogAt: 0 };
    const p = panel(S, "throw");
    p.run(false);
    await tick();
    expect(S.adminBlogListErr).toBeUndefined();
    expect(S.adminBlog).toEqual(posts("a"));
  });
});
