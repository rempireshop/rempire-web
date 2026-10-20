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
      ["search_products", "get_product", "list_sections", "list_posts", "get_post", "save_draft"],
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
    const found = searchProducts(list, "kevin murphy шампунь", 25).map((p) => p.id);
    expect(found).toContain("kevin-murphy-angel-wash");
    expect(searchProducts(list, "", 5)).toEqual([]);
  });
});
