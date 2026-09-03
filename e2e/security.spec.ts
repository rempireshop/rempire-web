import { expect, test } from "@playwright/test";
import { shopUrl } from "./fixtures";

/** Security smoke: admin routes refuse an unauthenticated caller, CSP is
 *  present. Desktop only, single run — see docs/testing.md. Pure API checks
 *  — no browser interaction needed, so no per-file rate-limit IP header
 *  either (these routes are not rate-limited the way login/orders are). */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "security spec — desktop project only, see docs/testing.md");
});

test("GET /api/admin/orders without a cookie is refused", async ({ request }) => {
  const res = await request.get("/api/admin/orders/");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

test("POST /api/assistant admin mode without a cookie is refused", async ({ request, baseURL }) => {
  // The route checks OPENAI_API_KEY before it checks the admin cookie
  // (src/app/api/assistant/route.ts) — and this suite deliberately runs with
  // no key at all (playwright.config.ts), so the assistant is off for
  // *everyone*, admin included: 503 {enabled:false}, never a 200. That is a
  // strictly *stronger* refusal than a 401 would be, but it is not the same
  // status code the task asks for literally — tests/assistant-admin-auth
  // .test.ts is the fast, isolated backstop that actually exercises the
  // cookie check with a key configured (fetch mocked, no real OpenAI call).
  // See docs/testing.md "What could not be automated" for the full story.
  const res = await request.post("/api/assistant/", {
    headers: { origin: baseURL || "" },
    data: { mode: "admin", messages: [{ role: "user", content: "hi" }] },
  });
  expect(res.status()).toBe(503);
  const body = await res.json();
  expect(body.enabled).toBe(false);
});

test("the shop and the admin panel send a Content-Security-Policy header", async ({ request }) => {
  const home = await request.get(shopUrl("", "/"));
  expect(home.headers()["content-security-policy"]).toContain("default-src 'self'");

  const admin = await request.get(shopUrl("", "/admin/"));
  // /shop2/* gets the strict policy — no 'unsafe-inline' in script-src
  // (next.config.ts csp()), since the admin panel is the one screen a
  // stranger's text (a review, an order note) ever reaches.
  const adminCsp = admin.headers()["content-security-policy"];
  expect(adminCsp).toContain("script-src 'self'");
  expect(adminCsp).not.toContain("script-src 'self' 'unsafe-inline'");
});
