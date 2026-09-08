/**
 * Route fuzzing — every API route, every method it exports, driven with a
 * fixed corpus of hostile bodies, fields, ids and query strings.
 *
 * What every case asserts (tests/fuzz-harness.ts checkResponse):
 *   · no 5xx — with a live database and every upstream stubbed, the only
 *     legitimate 5xx left is "this deployment has no key for X" (503
 *     not_configured / no_api_key / storage_not_configured);
 *   · no stack frame, no node_modules path, no absolute file path in the body;
 *   · a 4xx JSON answer is {ok:false, error:"<code>"} — never a bare message.
 *
 * The auth matrix (no cookie / garbage cookie / tampered signature / expired)
 * and the "a method the route does not export" checks live at the bottom.
 *
 * See docs/testing.md § «Фаззинг API».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { setupDb, teardownDb } from "./helpers";
import {
  CRON_SECRET,
  ORIGIN,
  PRODUCT,
  PRODUCT_2,
  adminCookieHeader,
  checkResponse,
  customerCookieHeader,
  hostileBodies,
  hostileValues,
  installFetchStub,
  makeRequest,
  resetIps,
  seedFixtures,
  setEnv,
  setFuzzEnv,
  unexpectedFetches,
  violations,
  type Fixtures,
  type ReqOpts,
} from "./fuzz-harness";

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response> | Response;

interface RouteCase {
  /** "POST /api/orders/" — the label every violation is reported under. */
  name: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Exported handler names this file drives; anything else must be undefined. */
  exports: string[];
  load: () => Promise<Record<string, unknown>>;
  auth?: "admin" | "customer" | "cron";
  /** Path params for a dynamic segment. */
  params?: Record<string, string>;
  /** A well-formed body, mutated field by field. */
  body?: Record<string, unknown>;
  /** Extra request options (multipart, NextRequest, cron header, …). */
  req?: Partial<ReqOpts>;
  /** false for HTML/CSV/PDF routes — the {ok,error} shape check is skipped. */
  jsonBody?: boolean;
  /** Query strings to fuzz on top of the path. */
  queries?: string[];
  /** Money- and stock-shaped routes: every field sees the whole corpus. */
  deep?: boolean;
}

let F: Fixtures;
let restoreEnv: () => void = () => {};
const BODIES = hostileBodies();
const PAGINATION = ["?limit=0", "?limit=-1", "?limit=1e9", "?limit=abc", "?limit=1&limit=2", "?limit=" + "9".repeat(400)];

function routes(): RouteCase[] {
  const admin = { cookie: adminCookieHeader() };
  const cust = { cookie: customerCookieHeader(F.customerEmail) };
  const cron = { headers: { authorization: `Bearer ${CRON_SECRET}` } };
  const goodOrder = {
    lang: "RU",
    items: [{ id: PRODUCT.id, variant: null, qty: 1 }],
    customer: { name: "Fuzz Ostja", email: "fuzz@example.com", phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE", carrier: "omniva", pointId: "1", pointName: "Kristiine" },
    discountCode: null,
    notes: "note",
  };

  return [
    /* ---- public ---------------------------------------------------------- */
    { deep: true, name: "POST /api/orders/", path: "/api/orders/", method: "POST", exports: ["POST"], load: () => import("@/app/api/orders/route"), body: goodOrder },
    { name: "POST /api/carts/", path: "/api/carts/", method: "POST", exports: ["POST"], load: () => import("@/app/api/carts/route"), body: { email: "fuzz@example.com", lang: "RU", items: [{ id: PRODUCT.id, qty: 2, size: 0 }] } },
    { deep: true, name: "POST /api/promos/check/", path: "/api/promos/check/", method: "POST", exports: ["POST"], load: () => import("@/app/api/promos/check/route"), body: { code: "FUZZ10", subtotal: 100, shipping: 5 } },
    { deep: true, name: "POST /api/giftcards/check/", path: "/api/giftcards/check/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/giftcards/check/route"), body: { code: "RMP-ACDE-FGHJ" } },
    /* The printable card. Answers `application/pdf`, so no {ok,error} shape to
       check; every case here is a 404, because the token never verifies —
       which is exactly the property that matters (a guessed code buys nothing
       without the HMAC). See tests/giftcard-mail-pdf.test.ts for the 200. */
    { name: "GET /api/giftcards/[code]/pdf/", path: "/api/giftcards/x/pdf/", method: "GET", exports: ["GET"], load: () => import("@/app/api/giftcards/[code]/pdf/route"), params: { code: "RMP-ACDE-FGHJ" }, jsonBody: false, queries: ["", "?t=", "?t=junk", "?t=../../etc/passwd", "?t=" + "9".repeat(400), "?t=%00"] },
    { name: "GET /api/overrides/", path: "/api/overrides/", method: "GET", exports: ["GET"], load: () => import("@/app/api/overrides/route") },
    { name: "GET /api/bundles/", path: "/api/bundles/", method: "GET", exports: ["GET"], load: () => import("@/app/api/bundles/route") },
    { name: "GET /api/geo/", path: "/api/geo/", method: "GET", exports: ["GET"], load: () => import("@/app/api/geo/route"), req: { next: true } },
    { name: "POST /api/track/", path: "/api/track/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/track/route"), body: { sid: "s1", type: "view", path: "/", productId: PRODUCT.id, value: 1, lang: "RU", ref: "google.com" } },
    { name: "POST /api/stock-alerts/", path: "/api/stock-alerts/", method: "POST", exports: ["POST"], load: () => import("@/app/api/stock-alerts/route"), body: { email: "fuzz@example.com", productId: PRODUCT.id, lang: "RU" } },
    // search: the storefront's last-resort «what does this phrase mean» call.
    // With no OPENAI_API_KEY (which is the suite) it never reaches the model —
    // the body is still read and checked first, so this walks the validation.
    { name: "POST /api/search/", path: "/api/search/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/search/route"), body: { q: "жирные волосы", lang: "RU" } },
    { name: "GET /api/reviews/", path: "/api/reviews/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/reviews/route"), queries: [`?product=${PRODUCT.id}`] },
    { name: "POST /api/reviews/", path: "/api/reviews/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/reviews/route"), body: { product: PRODUCT.id, name: "Фазз", rating: 5, text: "Отличный товар, всем советую.", lang: "RU", consent: true, website: "" } },
    { name: "GET /api/blog/", path: "/api/blog/", method: "GET", exports: ["GET"], load: () => import("@/app/api/blog/route"), queries: ["?lang=RU&page=1", "?page=-1", "?page=1e9", "?page=abc", "?lang=" + "x".repeat(500)] },
    { name: "GET /api/blog/[slug]/", path: "/api/blog/x/", method: "GET", exports: ["GET"], load: () => import("@/app/api/blog/[slug]/route"), params: { slug: "fuzz-post" } },
    { name: "GET /api/shipping/points/", path: "/api/shipping/points/", method: "GET", exports: ["GET"], load: () => import("@/app/api/shipping/points/route"), queries: ["?country=EE&carrier=omniva", "?country=zz&carrier=all", "?country=&carrier=", "?country=EE&country=LV"] },
    { name: "GET /api/payments/methods/", path: "/api/payments/methods/", method: "GET", exports: ["GET"], load: () => import("@/app/api/payments/methods/route") },
    { name: "GET /api/payments/mock/", path: "/api/payments/mock/", method: "GET", exports: ["GET"], load: () => import("@/app/api/payments/mock/route"), jsonBody: false, queries: ["", "?t=abc", "?t=abc&do=paid", "?do=failed"] },
    { deep: true, name: "POST /api/payments/create/", path: "/api/payments/create/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/payments/create/route"), body: { orderId: F.orderId, method: "bank", bank: "LHVBEE22", lang: "RU" } },
    { name: "POST /api/payments/notify/", path: "/api/payments/notify/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/payments/notify/route"), body: { mockToken: "not.a.token" } },
    { name: "GET /api/payments/return/", path: "/api/payments/return/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/payments/return/route"), jsonBody: false, queries: ["", "?mock-token=junk", "?n=R-999999"] },
    { name: "POST /api/payments/return/", path: "/api/payments/return/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/payments/return/route"), jsonBody: false, body: { "mock-token": "junk" } },
    { name: "GET /api/admin/mail/preview/", path: "/api/admin/mail/preview/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/mail/preview/route"), jsonBody: false, queries: ["?template=order-confirmed&lang=RU", "?template=../../etc/passwd", "?format=json", "?format=text", "?lang=zz"] },

    /* ---- customer account ------------------------------------------------ */
    { name: "POST /api/account/code/", path: "/api/account/code/", method: "POST", exports: ["POST"], load: () => import("@/app/api/account/code/route"), body: { email: "fuzz@example.com", lang: "RU" } },
    { name: "POST /api/account/login/", path: "/api/account/login/", method: "POST", exports: ["POST"], load: () => import("@/app/api/account/login/route"), body: { email: "fuzz@example.com", code: "123456", lang: "RU" } },
    { name: "POST /api/account/logout/", path: "/api/account/logout/", method: "POST", exports: ["POST"], load: () => import("@/app/api/account/logout/route") },
    { name: "GET /api/account/me/", path: "/api/account/me/", method: "GET", exports: ["GET", "PATCH"], load: () => import("@/app/api/account/me/route"), auth: "customer", req: cust },
    { name: "PATCH /api/account/me/", path: "/api/account/me/", method: "PATCH", exports: ["GET", "PATCH"], load: () => import("@/app/api/account/me/route"), auth: "customer", req: cust, body: { name: "Фазз", phone: "+372 1", birthday: "1990-02-28", marketing: true, lang: "ET" } },
    { name: "GET /api/account/pricing/", path: "/api/account/pricing/", method: "GET", exports: ["GET"], load: () => import("@/app/api/account/pricing/route"), auth: "customer", req: cust },
    { name: "POST /api/account/pro-request/", path: "/api/account/pro-request/", method: "POST", exports: ["POST"], load: () => import("@/app/api/account/pro-request/route"), auth: "customer", req: cust, body: { company: "Salon OÜ", regCode: "12345678", phone: "+372 1" } },
    { name: "POST /api/account/return-request/", path: "/api/account/return-request/", method: "POST", exports: ["POST"], load: () => import("@/app/api/account/return-request/route"), auth: "customer", req: cust, body: { number: "R-100001" } },

    /* ---- admin ----------------------------------------------------------- */
    { name: "POST /api/admin/login/", path: "/api/admin/login/", method: "POST", exports: ["POST"], load: () => import("@/app/api/admin/login/route"), body: { password: "wrong password" } },
    { name: "POST /api/admin/logout/", path: "/api/admin/logout/", method: "POST", exports: ["POST"], load: () => import("@/app/api/admin/logout/route") },
    { name: "GET /api/admin/me/", path: "/api/admin/me/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/me/route"), req: admin },
    { name: "GET /api/admin/migrate/", path: "/api/admin/migrate/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/admin/migrate/route"), auth: "admin", req: admin },
    { name: "POST /api/admin/migrate/", path: "/api/admin/migrate/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/admin/migrate/route"), auth: "admin", req: admin },
    { name: "GET /api/admin/audit/", path: "/api/admin/audit/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/audit/route"), auth: "admin", req: admin, queries: PAGINATION },
    { name: "GET /api/admin/orders/", path: "/api/admin/orders/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/orders/route"), auth: "admin", req: admin, queries: [...PAGINATION, "?status=paid", "?status=' or 1=1--", "?q=%00", "?q=" + "x".repeat(5000)] },
    { name: "GET /api/admin/orders/[id]/", path: "/api/admin/orders/x/", method: "GET", exports: ["GET", "PATCH"], load: () => import("@/app/api/admin/orders/[id]/route"), auth: "admin", req: admin, params: { id: "" } },
    { name: "PATCH /api/admin/orders/[id]/", path: "/api/admin/orders/x/", method: "PATCH", exports: ["GET", "PATCH"], load: () => import("@/app/api/admin/orders/[id]/route"), auth: "admin", req: admin, params: { id: "" }, body: { status: "paid", note: "ok", labelStep: false } },
    { name: "GET /api/admin/orders/[id]/messages/", path: "/api/admin/orders/x/messages/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/orders/[id]/messages/route"), auth: "admin", req: admin, params: { id: "" } },
    // «По счёту — для компаний»: the invoice PDF and «Отметить оплаченным» / «Отправить счёт ещё раз» (src/lib/invoices.ts)
    { name: "GET /api/admin/orders/[id]/invoice/", path: "/api/admin/orders/x/invoice/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/admin/orders/[id]/invoice/route"), auth: "admin", req: admin, params: { id: "" }, jsonBody: false },
    { name: "POST /api/admin/orders/[id]/invoice/", path: "/api/admin/orders/x/invoice/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/admin/orders/[id]/invoice/route"), auth: "admin", req: admin, params: { id: "" }, body: { action: "paid" } },
    // «Вернуть деньги» — money leaving the shop through the provider that took it (src/lib/payments/refund.ts)
    { name: "POST /api/admin/orders/[id]/refund/", path: "/api/admin/orders/x/refund/", method: "POST", exports: ["POST"], load: () => import("@/app/api/admin/orders/[id]/refund/route"), auth: "admin", req: admin, params: { id: "" }, body: { amount: 1 } },
    { name: "GET /api/admin/overrides/", path: "/api/admin/overrides/", method: "GET", exports: ["GET", "PUT"], load: () => import("@/app/api/admin/overrides/route"), auth: "admin", req: admin },
    { deep: true, name: "PUT /api/admin/overrides/", path: "/api/admin/overrides/", method: "PUT", exports: ["GET", "PUT"], load: () => import("@/app/api/admin/overrides/route"), auth: "admin", req: admin, body: { id: PRODUCT.id, price: 9.9, stock: "in", seoTitle: "t", seoDesc: "d", subcat: "s", varImg: [0], videoUrl: "https://x/y", gallery: [{ url: "/a.webp", thumb: "/a.webp", alt: "" }], proPrice: 5, description: { RU: "о" }, seo: { RU: { title: "t", desc: "d" }, ET: { title: "e" } } } },
    { name: "GET /api/admin/settings/", path: "/api/admin/settings/", method: "GET", exports: ["GET", "PUT"], load: () => import("@/app/api/admin/settings/route"), auth: "admin", req: admin },
    { deep: true, name: "PUT /api/admin/settings/", path: "/api/admin/settings/", method: "PUT", exports: ["GET", "PUT"], load: () => import("@/app/api/admin/settings/route"), auth: "admin", req: admin, body: { chatbot: true, bundles: false, hero: null, flows: { abandoned: true }, pricing: { proDiscountPct: 20 }, gift_amounts: [25, 50, 100] } },
    { name: "GET /api/admin/bundles/", path: "/api/admin/bundles/", method: "GET", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/bundles/route"), auth: "admin", req: admin },
    { deep: true, name: "POST /api/admin/bundles/", path: "/api/admin/bundles/", method: "POST", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/bundles/route"), auth: "admin", req: admin, body: { id: "fuzz-set", cat: "beard", title: { RU: "Фазз", ET: "F", EN: "F" }, desc: { RU: "о" }, items: [{ productId: PRODUCT.id, variant: 0, qty: 1 }, { productId: PRODUCT_2.id, variant: 0, qty: 1 }], price: 1, image: null, active: true, sort: 10 } },
    { name: "PATCH /api/admin/bundles/", path: "/api/admin/bundles/", method: "PATCH", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/bundles/route"), auth: "admin", req: admin, body: { id: "beard-start", active: false, order: ["beard-start"] } },
    { name: "DELETE /api/admin/bundles/", path: "/api/admin/bundles/", method: "DELETE", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/bundles/route"), auth: "admin", req: admin, queries: ["?id=fuzz-set", "?id=", "?id=%00", "?id=%2e%2e%2f"] },
    { name: "GET /api/admin/promos/", path: "/api/admin/promos/", method: "GET", exports: ["GET", "POST", "PATCH"], load: () => import("@/app/api/admin/promos/route"), auth: "admin", req: admin },
    { name: "POST /api/admin/promos/", path: "/api/admin/promos/", method: "POST", exports: ["GET", "POST", "PATCH"], load: () => import("@/app/api/admin/promos/route"), auth: "admin", req: admin, body: { code: "FUZZ20", kind: "percent", value: 20, minSubtotal: 0, startsAt: null, endsAt: null, maxUses: 10, active: true, note: "n" } },
    { name: "PATCH /api/admin/promos/", path: "/api/admin/promos/", method: "PATCH", exports: ["GET", "POST", "PATCH"], load: () => import("@/app/api/admin/promos/route"), auth: "admin", req: admin, body: { code: "FUZZ10", active: false } },
    { name: "GET /api/admin/customers/", path: "/api/admin/customers/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/admin/customers/route"), auth: "admin", req: admin, queries: [...PAGINATION, "?tier=pro", "?tier=nonsense", "?format=csv", "?q=%00"], jsonBody: false },
    // partners: «+ Партнёр» — create-or-promote by e-mail, sends the welcome letter (stubbed Resend)
    { deep: true, name: "POST /api/admin/customers/", path: "/api/admin/customers/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/admin/customers/route"), auth: "admin", req: admin, body: { email: "partner-fuzz@example.com", company: "Salon Fuzz OÜ", phone: "+372 1", name: "Fuzz", regCode: "12345678", lang: "RU", tier: "pro" } },
    { name: "GET /api/admin/customers/[id]/", path: "/api/admin/customers/x/", method: "GET", exports: ["GET", "PATCH"], load: () => import("@/app/api/admin/customers/[id]/route"), auth: "admin", req: admin, params: { id: "" } },
    { deep: true, name: "PATCH /api/admin/customers/[id]/", path: "/api/admin/customers/x/", method: "PATCH", exports: ["GET", "PATCH"], load: () => import("@/app/api/admin/customers/[id]/route"), auth: "admin", req: admin, params: { id: "" }, body: { action: "reject", tier: "retail", notes: "n", pointsDelta: 5, note: "why" } },
    // admin redesign phase 3: «Маркетинг → Подарочные карты → Выпущенные карты»
    { name: "GET /api/admin/giftcards/", path: "/api/admin/giftcards/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/giftcards/route"), auth: "admin", req: admin },
    { name: "GET /api/admin/reviews/", path: "/api/admin/reviews/", method: "GET", exports: ["GET", "PATCH"], load: () => import("@/app/api/admin/reviews/route"), auth: "admin", req: admin, queries: ["?status=pending", "?status=nonsense"] },
    { name: "PATCH /api/admin/reviews/", path: "/api/admin/reviews/", method: "PATCH", exports: ["GET", "PATCH"], load: () => import("@/app/api/admin/reviews/route"), auth: "admin", req: admin, body: { id: "", status: "approved" } },
    { name: "GET /api/admin/blog/", path: "/api/admin/blog/", method: "GET", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/blog/route"), auth: "admin", req: admin, queries: ["", "?id=not-a-uuid", "?slug=fuzz-post", "?slug=%00", "?id="] },
    { name: "POST /api/admin/blog/", path: "/api/admin/blog/", method: "POST", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/blog/route"), auth: "admin", req: admin, body: { title: { RU: "т" }, excerpt: { RU: "э" }, body: { RU: "b" }, coverUrl: "/a.webp", coverAlt: { RU: "a" }, tags: ["a"], products: [PRODUCT.id], seoTitle: { RU: "s" }, seoDesc: { RU: "d" }, author: "a" } },
    { name: "PATCH /api/admin/blog/", path: "/api/admin/blog/", method: "PATCH", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/blog/route"), auth: "admin", req: admin, body: { id: "", slug: "fuzz-post", publish: true } },
    { name: "DELETE /api/admin/blog/", path: "/api/admin/blog/", method: "DELETE", exports: ["GET", "POST", "PATCH", "DELETE"], load: () => import("@/app/api/admin/blog/route"), auth: "admin", req: admin, queries: ["?id=not-a-uuid", "?id=", "?id=%2e%2e%2f"] },
    { name: "GET /api/admin/inventory/", path: "/api/admin/inventory/", method: "GET", exports: ["GET", "PUT"], load: () => import("@/app/api/admin/inventory/route"), auth: "admin", req: admin, queries: [...PAGINATION, "?filter=low", "?filter=nope", "?q=%00"] },
    { name: "PUT /api/admin/inventory/", path: "/api/admin/inventory/", method: "PUT", exports: ["GET", "PUT"], load: () => import("@/app/api/admin/inventory/route"), auth: "admin", req: admin, body: { productId: PRODUCT.id, variant: "", ean: "4740123456789", lowThreshold: 3 } },
    { name: "GET /api/admin/inventory/lookup/", path: "/api/admin/inventory/lookup/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/inventory/lookup/route"), auth: "admin", req: admin, queries: ["?ean=4740123456789", "?ean=", "?ean=" + "9".repeat(500), "?ean=%00"] },
    { name: "GET /api/admin/inventory/moves/", path: "/api/admin/inventory/moves/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/admin/inventory/moves/route"), auth: "admin", req: admin, queries: [...PAGINATION, "?since=not-a-date", "?since=" + "9".repeat(40), "?reason=nope", `?productId=${PRODUCT.id}`] },
    { deep: true, name: "POST /api/admin/inventory/moves/", path: "/api/admin/inventory/moves/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/admin/inventory/moves/route"), auth: "admin", req: admin, body: { productId: PRODUCT.id, variant: "", delta: 1, reason: "goods_in", ref: "r" } },
    { name: "GET /api/admin/analytics/", path: "/api/admin/analytics/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/analytics/route"), auth: "admin", req: admin, queries: ["?range=7d", "?range=nope", "?range="] },
    { name: "GET /api/admin/analytics/gsc/", path: "/api/admin/analytics/gsc/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/analytics/gsc/route"), auth: "admin", req: admin },
    { name: "GET /api/admin/overview/", path: "/api/admin/overview/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/overview/route"), auth: "admin", req: admin },
    { name: "GET /api/admin/flows/", path: "/api/admin/flows/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/flows/route"), auth: "admin", req: admin },
    { name: "GET /api/admin/reports/orders/", path: "/api/admin/reports/orders/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/reports/orders/route"), auth: "admin", req: admin, jsonBody: false, queries: ["?month=2026-09", "?month=nope", "?from=2026-01-01&to=2026-12-31&format=csv", "?month=2026-09&format=xlsx", "?month=2026-09&format=exe", "?from=2026-12-31&to=2026-01-01", "?month=9999-12", "?month=0000-00", "?month=0000-01", "?month=1000-01", "?from=0000-01-01&to=9999-12-31", "?from=2026-02-30&to=2026-02-31"] },
    { name: "GET /api/admin/shipping/rates/", path: "/api/admin/shipping/rates/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/shipping/rates/route"), auth: "admin", req: admin, queries: ["?country=EE", "?country=zz", "?country="] },
    { name: "POST /api/admin/shipments/", path: "/api/admin/shipments/", method: "POST", exports: ["POST"], load: () => import("@/app/api/admin/shipments/route"), auth: "admin", req: admin, body: { orderId: F.paidOrderId, weight: 1, carrier: "omniva" } },
    { name: "GET /api/admin/shipments/[id]/label/", path: "/api/admin/shipments/x/label/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/shipments/[id]/label/route"), auth: "admin", req: admin, params: { id: "" }, jsonBody: false },
    { deep: true, name: "POST /api/admin/pos-orders/", path: "/api/admin/pos-orders/", method: "POST", exports: ["POST"], load: () => import("@/app/api/admin/pos-orders/route"), auth: "admin", req: admin, body: { items: [{ id: PRODUCT.id, variant: null, qty: 1 }], customer: { name: "Гость", email: "", phone: "" }, payment: { method: "cash" }, discountPercent: 10 } },
    { name: "GET /api/admin/pos-orders/[id]/receipt/", path: "/api/admin/pos-orders/x/receipt/", method: "GET", exports: ["GET"], load: () => import("@/app/api/admin/pos-orders/[id]/receipt/route"), auth: "admin", req: admin, params: { id: "" }, jsonBody: false, queries: ["?lang=RU", "?lang=zz"] },
    { name: "POST /api/admin/mail/send/", path: "/api/admin/mail/send/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/admin/mail/send/route"), auth: "admin", req: admin, body: { orderId: "", customerMessage: "вопрос", reply: "ответ" } },
    { name: "POST /api/admin/mail/test/", path: "/api/admin/mail/test/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/admin/mail/test/route"), auth: "admin", req: admin, body: { template: "order-confirmed", to: "fuzz@example.com", lang: "RU" } },
    { name: "POST /api/admin/ai/text/", path: "/api/admin/ai/text/", method: "POST", exports: ["POST", "GET"], load: () => import("@/app/api/admin/ai/text/route"), auth: "admin", req: { ...admin, next: true }, body: { task: "seo", lang: "RU", input: { name: "X", brand: "Y", category: "hair" } } },
    { name: "GET /api/admin/upload/", path: "/api/admin/upload/", method: "GET", exports: ["GET", "POST", "DELETE"], load: () => import("@/app/api/admin/upload/route"), auth: "admin", req: admin },
    { name: "DELETE /api/admin/upload/", path: "/api/admin/upload/", method: "DELETE", exports: ["GET", "POST", "DELETE"], load: () => import("@/app/api/admin/upload/route"), auth: "admin", req: admin, queries: ["?key=products/a.webp", "?key=../../etc/passwd", "?key=", "?key=%00"] },
    /* product creation: «Убрать фон» is off in this suite (no PHOTO_CUTOUT), so
       every body answers 503 before any network — the fetch stub sees nothing */
    { name: "POST /api/admin/upload/cutout/", path: "/api/admin/upload/cutout/", method: "POST", exports: ["POST"], load: () => import("@/app/api/admin/upload/cutout/route"), auth: "admin", req: admin, body: { key: "products/a/1-a.webp", url: "https://media.rempireshop.com/products/a/1-a.webp" } },
    /* product creation: the owner's own products (custom_products) */
    { name: "GET /api/admin/products/", path: "/api/admin/products/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/admin/products/route"), auth: "admin", req: admin },
    { deep: true, name: "POST /api/admin/products/", path: "/api/admin/products/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/admin/products/route"), auth: "admin", req: admin, body: { brand: "Фазз", name: "Balm — бальзам для бороды", cat: "beard", subcat: "ba", price: 9.9, sizes: ["100 мл"], prices: [9.9], description: { RU: "о", ET: "e", EN: "e" }, seo: { RU: { title: "t", desc: "d" } }, gallery: [{ url: "/a.webp", thumb: "/a.webp", alt: "" }] } },
    { name: "GET /api/admin/products/[id]/", path: "/api/admin/products/x/", method: "GET", exports: ["GET", "PUT", "DELETE"], load: () => import("@/app/api/admin/products/[id]/route"), auth: "admin", req: admin, params: { id: "" } },
    { deep: true, name: "PUT /api/admin/products/[id]/", path: "/api/admin/products/x/", method: "PUT", exports: ["GET", "PUT", "DELETE"], load: () => import("@/app/api/admin/products/[id]/route"), auth: "admin", req: admin, params: { id: "" }, body: { brand: "Фазз", name: "Balm", cat: "beard", price: 12, sizes: ["75 мл", "250 мл"], prices: [9, 16], active: true } },
    { name: "DELETE /api/admin/products/[id]/", path: "/api/admin/products/x/", method: "DELETE", exports: ["GET", "PUT", "DELETE"], load: () => import("@/app/api/admin/products/[id]/route"), auth: "admin", req: admin, params: { id: "" } },

    /* ---- pages outside /api ------------------------------------------------
       The request-time product page of a product the owner created, in its
       three languages, and the sitemap the app serves for those products
       (src/lib/product-page.ts, src/app/sitemap-custom.xml/route.ts). HTML
       and XML, so no {ok,error} shape — what matters is that no id, however
       hostile, is a 5xx, a file path, or a page for a hidden row. */
    { name: "GET /shop2/p/[id]/", path: "/shop2/p/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/p/[id]/route"), params: { id: "" }, jsonBody: false },
    { name: "GET /shop2/et/p/[id]/", path: "/shop2/et/p/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/et/p/[id]/route"), params: { id: "" }, jsonBody: false },
    { name: "GET /shop2/en/p/[id]/", path: "/shop2/en/p/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/en/p/[id]/route"), params: { id: "" }, jsonBody: false },
    { name: "GET /sitemap-custom.xml", path: "/sitemap-custom.xml", method: "GET", exports: ["GET"], load: () => import("@/app/sitemap-custom.xml/route"), jsonBody: false },
    /* The request-time blog pages (src/lib/blog-page.ts) — the list and one
       post, three languages — and the OG card drawn for a created product or a
       post (src/lib/og-card.ts). Same rule: hostile slugs/file names are a 404
       or a 400, never a 5xx or a file path. */
    { name: "GET /shop2/blog/", path: "/shop2/blog/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/blog/route"), jsonBody: false },
    { name: "GET /shop2/et/blog/", path: "/shop2/et/blog/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/et/blog/route"), jsonBody: false },
    { name: "GET /shop2/en/blog/", path: "/shop2/en/blog/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/en/blog/route"), jsonBody: false },
    { name: "GET /shop2/blog/[slug]/", path: "/shop2/blog/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/blog/[slug]/route"), params: { slug: "" }, jsonBody: false },
    { name: "GET /shop2/et/blog/[slug]/", path: "/shop2/et/blog/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/et/blog/[slug]/route"), params: { slug: "" }, jsonBody: false },
    { name: "GET /shop2/en/blog/[slug]/", path: "/shop2/en/blog/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/en/blog/[slug]/route"), params: { slug: "" }, jsonBody: false },
    { name: "GET /shop2/og/[file]", path: "/shop2/og/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/og/[file]/route"), params: { file: "" }, jsonBody: false },
    /* The catch-all under /shop2/ (src/lib/notfound-page.ts): everything the
       rewrites and the routes above did not claim. It reads nothing but the
       request path, so the hostile shapes it has to survive are addresses —
       an unfinished escape, a very long segment, a traversal attempt — none
       of which may become a 5xx or reach a file. */
    { name: "GET /shop2/[...path]/", path: "/shop2/x/", method: "GET", exports: ["GET"], load: () => import("@/app/shop2/[...path]/route"), jsonBody: false },

    /* ---- assistant, cron, e2e -------------------------------------------- */
    { name: "GET /api/assistant/", path: "/api/assistant/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/assistant/route"), req: { next: true } },
    { name: "POST /api/assistant/", path: "/api/assistant/", method: "POST", exports: ["GET", "POST"], load: () => import("@/app/api/assistant/route"), req: { next: true, headers: { origin: "https://rempireshop.com" } }, body: { messages: [{ role: "user", content: "привет" }], lang: "RU", mode: "shop" }, jsonBody: false },
    { name: "GET /api/cron/flows/", path: "/api/cron/flows/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/cron/flows/route"), auth: "cron", req: cron },
    { name: "GET /api/cron/events-retention/", path: "/api/cron/events-retention/", method: "GET", exports: ["GET", "POST"], load: () => import("@/app/api/cron/events-retention/route"), auth: "cron", req: cron },
    { name: "GET /api/e2e/bootstrap/", path: "/api/e2e/bootstrap/", method: "GET", exports: ["GET"], load: () => import("@/app/api/e2e/bootstrap/route") },
    { name: "GET /api/e2e/gift-card/", path: "/api/e2e/gift-card/", method: "GET", exports: ["GET"], load: () => import("@/app/api/e2e/gift-card/route"), req: admin, queries: [`?order=${F.orderId}`, "?order=", "?order=%00"] },
    { name: "GET /api/e2e/mail/", path: "/api/e2e/mail/", method: "GET", exports: ["GET"], load: () => import("@/app/api/e2e/mail/route"), req: admin, queries: ["?template=order-confirmed", "?to=fuzz@example.com", "?template=&to=", "?template=%00&to=%00"] },
  ];
}

/** Every dot path in a template body — branches as well as leaves, arrays by index. */
function bodyPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 3 || value == null || typeof value !== "object") return prefix ? [prefix] : [];
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const out = prefix ? [prefix] : [];
  for (const [k, v] of entries) out.push(...bodyPaths(v, prefix ? `${prefix}.${k}` : k, depth + 1));
  return out;
}

const WINDOW = 8;
/** A deterministic slice of the corpus, offset by the field's own index. */
function window<T>(corpus: readonly T[], i: number): T[] {
  const start = (i * 5) % corpus.length;
  return Array.from({ length: WINDOW }, (_, j) => corpus[(start + j) % corpus.length]);
}

/** Sentinel for "delete this key" — distinct from a value of undefined. */
const DROP = Symbol("drop");

/** A deep copy of `body` with one path replaced (or removed). */
function setPath(body: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const copy = structuredClone(body) as Record<string, unknown>;
  const keys = path.split(".");
  let node: Record<string, unknown> = copy;
  for (const k of keys.slice(0, -1)) {
    const next = node[k];
    if (!next || typeof next !== "object") return copy;
    node = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === DROP) delete node[last];
  else node[last] = value;
  return copy;
}

/** The dynamic-segment values every [id] route is fuzzed with. */
function idCorpus(good: string): string[] {
  return [
    good,
    "",
    " ",
    "0",
    "-1",
    "9".repeat(40),
    "not-a-uuid",
    "00000000-0000-0000-0000-000000000000",
    "R-999999",
    "../../etc/passwd",
    "%2e%2e%2fadmin",
    "<script>alert(1)</script>",
    "'; drop table orders; --",
    "a".repeat(3000),
    "fuzz@example.com",
  ];
}

function goodIdFor(name: string): string {
  if (name.includes("/customers/")) return F.customerId;
  if (name.includes("/blog/")) return F.postSlug;
  if (name.includes("/shipments/")) return F.paidOrderNumber;
  if (name.includes("/shop2/") || name.includes("/products/")) return F.customId;
  return F.orderId;
}

/**
 * A handler that throws is the worst failure of all — Next turns it into a 500
 * with the stack in the response — so it is caught here and reported as one
 * more violation rather than ending the whole run at the first one.
 */
async function call(r: RouteCase, opts: ReqOpts & { id?: string; query?: string } = {}): Promise<Response> {
  const mod = await r.load();
  const handler = mod[r.method] as Handler | undefined;
  if (typeof handler !== "function") throw new Error(`${r.name}: no ${r.method} export`);
  const params = r.params ? { ...r.params, ...(opts.id != null ? { [Object.keys(r.params)[0]]: opts.id } : {}) } : {};
  const req = makeRequest(`${r.path}${opts.query ?? ""}`, { ...r.req, ...opts, method: r.method });
  try {
    return await handler(req, { params: Promise.resolve(params) });
  } catch (err) {
    return Response.json({ ok: false, error: "threw", detail: String(err) }, { status: 599 });
  }
}

describe("API fuzzing", () => {
  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    installFetchStub();
    await setupDb();
    F = await seedFixtures();
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await teardownDb();
    restoreEnv();
  });
  beforeEach(() => {
    resetRateLimits();
    resetPayRateLimits();
    resetIps();
  });

  it("survives every hostile body shape on every route", async () => {
    const v = violations();
    for (const r of routes()) {
      const id = r.params ? goodIdFor(r.name) : undefined;
      for (const b of BODIES) {
        // GET/DELETE handlers never read a body; sending one only costs time.
        if ((r.method === "GET" || r.method === "DELETE") && b.label !== "no body") continue;
        const res = await call(r, { raw: b.raw, id, contentType: b.label === "no body" ? null : undefined });
        await checkResponse(v.list, `${r.name} [${b.label}]`, res, { jsonBody: r.jsonBody });
      }
      // wrong content-type, and a form post where JSON is expected
      if (r.method !== "GET" && r.method !== "DELETE") {
        for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
          const res = await call(r, { raw: JSON.stringify(r.body ?? {}), id, contentType: ct });
          await checkResponse(v.list, `${r.name} [content-type ${ct}]`, res, { jsonBody: r.jsonBody });
        }
      }
    }
    v.assertClean();
  }, 120_000);

  it("survives every field of every body being replaced by junk", async () => {
    const v = violations();
    const corpus = hostileValues();
    for (const r of routes()) {
      if (!r.body) continue;
      const id = r.params ? goodIdFor(r.name) : undefined;
      // every branch and every leaf, "customer.name" and "items.0.qty" included
      const paths = bodyPaths(r.body);
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        /* The money routes see the whole corpus; everywhere else a fixed
           window of it, rotated by field, keeps the suite under a minute
           while still walking every value across a route's own fields. */
        for (const value of r.deep ? corpus : window(corpus, i)) {
          const res = await call(r, { body: setPath(r.body, path, value), id });
          await checkResponse(v.list, `${r.name} [${path}]`, res, { jsonBody: r.jsonBody });
        }
        const res = await call(r, { body: setPath(r.body, path, DROP), id });
        await checkResponse(v.list, `${r.name} [no ${path}]`, res, { jsonBody: r.jsonBody });
      }
    }
    v.assertClean();
  }, 180_000);

  it("survives every hostile id in a dynamic path segment", async () => {
    const v = violations();
    for (const r of routes()) {
      if (!r.params) continue;
      for (const id of idCorpus(goodIdFor(r.name))) {
        const res = await call(r, { id, body: r.body });
        await checkResponse(v.list, `${r.name} [id=${id.slice(0, 24)}]`, res, { jsonBody: r.jsonBody });
      }
    }
    v.assertClean();
  }, 120_000);

  it("survives hostile query strings", async () => {
    const v = violations();
    const generic = ["?x=1&x=2", "?limit=" + "9".repeat(300), "?q=" + encodeURIComponent("'; drop table orders; --"), "?q=%ff%fe", "?" + "a=1&".repeat(500)];
    for (const r of routes()) {
      const id = r.params ? goodIdFor(r.name) : undefined;
      for (const query of [...(r.queries ?? []), ...generic]) {
        const res = await call(r, { query, id, body: r.body });
        await checkResponse(v.list, `${r.name} [${query.slice(0, 40)}]`, res, { jsonBody: r.jsonBody });
      }
    }
    v.assertClean();
  }, 120_000);

  it("refuses admin, customer and cron routes without a usable credential", async () => {
    const v = violations();
    const expired = "rmp_admin=v1.1000000000000.deadbeef";
    const tampered = adminCookieHeader().replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const credentials: Array<[string, ReqOpts, RouteCase["auth"][]]> = [
      ["none", {}, ["admin", "customer", "cron"]],
      ["garbage cookie", { cookie: "rmp_admin=%; rmp_cust=%%%" }, ["admin", "customer", "cron"]],
      ["tampered signature", { cookie: tampered }, ["admin", "cron"]],
      ["expired", { cookie: expired }, ["admin", "cron"]],
      // the two cookies are signed under different domain prefixes: neither
      // token may ever be replayed as the other (src/lib/customers.ts)
      ["customer cookie", { cookie: customerCookieHeader(F.customerEmail) }, ["admin"]],
      ["admin cookie", { cookie: adminCookieHeader() }, ["customer"]],
      ["wrong cron secret", { headers: { authorization: "Bearer nope" } }, ["cron"]],
      ["no bearer prefix", { headers: { authorization: CRON_SECRET } }, ["cron"]],
    ];
    for (const r of routes()) {
      if (!r.auth) continue;
      const id = r.params ? goodIdFor(r.name) : undefined;
      for (const [label, cred, applies] of credentials) {
        if (!applies.includes(r.auth)) continue;
        const res = await call(r, { ...cred, cookie: cred.cookie ?? "", headers: cred.headers ?? {}, id, body: r.body, query: r.queries?.[0] });
        const { status, json } = await checkResponse(v.list, `${r.name} [${label}]`, res, { jsonBody: r.jsonBody });
        if (status !== 401 && status !== 403) {
          v.list.push({ where: `${r.name} [${label}]`, why: "auth-gated route answered without a credential", status, body: JSON.stringify(json) });
        }
      }
    }
    v.assertClean();
  }, 120_000);

  it("exports no handler it does not implement", async () => {
    const v = violations();
    const ALL = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    const seen = new Set<string>();
    for (const r of routes()) {
      if (seen.has(r.path + r.exports.join())) continue;
      seen.add(r.path + r.exports.join());
      const mod = await r.load();
      for (const m of ALL) {
        const declared = r.exports.includes(m);
        const exported = typeof mod[m] === "function";
        if (declared !== exported) {
          v.list.push({ where: `${r.name} ${m}`, why: declared ? "declared but not exported" : "exported but not declared", status: 0, body: "" });
        }
      }
    }
    v.assertClean();
  });

  it("answers 405 with a code on the methods that exist only to refuse", async () => {
    const refusers: Array<[string, () => Promise<Record<string, unknown>>, string]> = [
      ["/api/track/", () => import("@/app/api/track/route"), "GET"],
      ["/api/giftcards/check/", () => import("@/app/api/giftcards/check/route"), "GET"],
      ["/api/payments/create/", () => import("@/app/api/payments/create/route"), "GET"],
      ["/api/payments/notify/", () => import("@/app/api/payments/notify/route"), "GET"],
      ["/api/admin/mail/send/", () => import("@/app/api/admin/mail/send/route"), "GET"],
      ["/api/admin/mail/test/", () => import("@/app/api/admin/mail/test/route"), "GET"],
      ["/api/admin/ai/text/", () => import("@/app/api/admin/ai/text/route"), "GET"],
    ];
    for (const [path, load, method] of refusers) {
      const mod = await load();
      const handler = mod[method] as Handler;
      const res = await handler(makeRequest(path, { method }), { params: Promise.resolve({}) });
      expect(res.status, path).toBe(405);
      const body = await res.json();
      expect(body.ok, path).toBe(false);
      expect(typeof body.error, path).toBe("string");
    }
  });


  it("fuzzes the multipart upload without ever storing junk", async () => {
    const v = violations();
    const upload = await import("@/app/api/admin/upload/route");
    const cookie = adminCookieHeader();
    // a real 1×1 PNG, so the happy path reaches sharp and the (stubbed) bucket
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const bodies: Array<[string, FormData | string]> = [
      ["not a form", "kind=product&file=x"],
      ["empty form", new FormData()],
    ];
    const form = (fields: Record<string, string | Blob>) => {
      const f = new FormData();
      for (const [k, val] of Object.entries(fields)) f.append(k, val);
      return f;
    };
    bodies.push(["no file", form({ kind: "product", productId: PRODUCT.id })]);
    bodies.push(["file is a string", form({ kind: "product", productId: PRODUCT.id, file: "not-a-file" })]);
    bodies.push(["bad kind", form({ kind: "../../etc", file: new Blob([png]) })]);
    bodies.push(["no product id", form({ kind: "product", file: new Blob([png]) })]);
    bodies.push(["not an image", form({ kind: "product", productId: PRODUCT.id, file: new Blob(["<script>alert(1)</script>"]) })]);
    bodies.push(["empty file", form({ kind: "product", productId: PRODUCT.id, file: new Blob([]) })]);
    bodies.push(["13 MB file", form({ kind: "product", productId: PRODUCT.id, file: new Blob([new Uint8Array(13 * 1024 * 1024)]) })]);
    bodies.push(["hostile alt + id", form({ kind: "product", productId: "../../x", alt: "<script>alert(1)</script>", file: new Blob([png]) })]);
    bodies.push(["a real png", form({ kind: "product", productId: PRODUCT.id, alt: "ok", file: new Blob([png]) })]);

    for (const [label, body] of bodies) {
      const init: RequestInit = { method: "POST", headers: { cookie }, body: body as BodyInit };
      const res = await upload.POST(new Request(`${ORIGIN}/api/admin/upload/`, init));
      const { status, json } = await checkResponse(v.list, `POST /api/admin/upload/ [${label}]`, res);
      // the one well-formed call must actually reach sharp and the bucket, or
      // every case above is only proving the 400 door works
      if (label === "a real png") {
        expect(status, label).toBe(200);
        expect(json?.key, label).toMatch(/^products\//);
      }
    }
    // and without the cookie at all
    const anon = await upload.POST(new Request(`${ORIGIN}/api/admin/upload/`, { method: "POST", body: form({ kind: "product" }) }));
    expect(anon.status).toBe(401);
    v.assertClean();
  }, 60_000);

  it("keeps the assistant's admin mode behind the cookie and the Origin header", async () => {
    const { POST } = await import("@/app/api/assistant/route");
    const body = { messages: [{ role: "user", content: "подними цену" }], mode: "admin" };

    // no Origin at all: the admin panel always sends one, so this fails closed
    const noOrigin = await POST(makeRequest("/api/assistant/", { method: "POST", body, next: true, cookie: adminCookieHeader() }) as never);
    expect(noOrigin.status).toBe(403);

    // Origin, no cookie
    const noCookie = await POST(
      makeRequest("/api/assistant/", { method: "POST", body, next: true, headers: { origin: ORIGIN } }) as never,
    );
    expect(noCookie.status).toBe(401);

    // a cross-origin Origin is refused before anything else
    const foreign = await POST(
      makeRequest("/api/assistant/", { method: "POST", body, next: true, headers: { origin: "https://evil.example" }, cookie: adminCookieHeader() }) as never,
    );
    expect(foreign.status).toBe(403);
  });

  it("never bounces the shopper off the mock gateway to another origin", async () => {
    const { GET } = await import("@/app/api/payments/mock/route");
    const { mockSecret, signMockTicket } = await import("@/lib/payments/mock");
    const secret = mockSecret();

    const evil = signMockTicket(
      { orderRef: "R-100001", ref: "r", returnUrl: "https://evil.example/steal", amount: 10 },
      secret,
    );
    const away = await GET(makeRequest(`/api/payments/mock/?t=${encodeURIComponent(evil)}&do=paid`));
    expect(away.status).toBe(400);
    expect(away.headers.get("location")).toBeNull();

    const good = signMockTicket(
      { orderRef: "R-100001", ref: "r", returnUrl: `${ORIGIN}/api/payments/return/`, amount: 10 },
      secret,
    );
    const back = await GET(makeRequest(`/api/payments/mock/?t=${encodeURIComponent(good)}&do=paid`));
    expect(back.status).toBe(303);
    expect(new URL(back.headers.get("location")!).origin).toBe(ORIGIN);
  });

  it("refuses the cron routes when no CRON_SECRET is configured at all", async () => {
    const flows = await import("@/app/api/cron/flows/route");
    const retention = await import("@/app/api/cron/events-retention/route");
    const saved = process.env.CRON_SECRET;
    setEnv("CRON_SECRET", undefined);
    try {
      for (const route of [flows, retention]) {
        const attempts: Record<string, string>[] = [{}, { authorization: `Bearer ${CRON_SECRET}` }, { authorization: "Bearer " }];
        for (const headers of attempts) {
          const res = await route.GET(makeRequest("/api/cron/x/", { headers }));
          expect(res.status).toBe(503);
          expect((await res.json()).error).toBe("not_configured");
        }
      }
    } finally {
      setEnv("CRON_SECRET", saved);
    }
  });


  /* The two structural checks. Everything above fuzzes the routes this file
     knows about; these make sure that set stays the set of routes that
     exists, and that nothing under /api/admin/ ever ships without its lock. */

  it("fuzzes every route on disk", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join, sep: SEP } = await import("node:path");
    const found: string[] = [];
    /* The whole of src/app, not only /api: the product pages and the sitemap
       are route handlers too (src/app/shop2/**, src/app/sitemap-custom.xml),
       and a page added tomorrow must land in the table above the same day. */
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "route.ts") {
          const rel = dir.split(SEP).join("/").replace(/^src\/app\/?/, "");
          found.push(rel ? `/${rel}/` : "/");
        }
      }
    };
    walk("src/app");
    /* One shape for both sides: a dynamic segment is "[id]" on disk and the
       placeholder "x" in the table above, and neither identifies the route. */
    const shape = (path: string) =>
      path.split("/").filter((seg) => seg && seg !== "x" && !/^\[.+\]$/.test(seg)).join("/");
    const covered = new Set(routes().map((r) => shape(r.path)));
    const missing = found.map(shape).filter((p) => !covered.has(p));
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("locks every route under /api/admin/ that is not a session endpoint", async () => {
    const { readdirSync, statSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    /* login/logout/me are the session itself, and mail/preview renders demo
       data only — docs/backend.md and that route's own comment say why. */
    const OPEN = ["login", "logout", "me", join("mail", "preview")].map((p) => join("src", "app", "api", "admin", p, "route.ts"));
    const unlocked: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "route.ts" && !OPEN.includes(full) && !readFileSync(full, "utf8").includes("requireAdmin")) {
          unlocked.push(full);
        }
      }
    };
    walk(join("src", "app", "api", "admin"));
    expect(unlocked).toEqual([]);
  });

  it("never reached a host the fetch stub does not know", () => {
    expect([...unexpectedFetches]).toEqual([]);
  });

  it("keeps all three e2e doors shut unless E2E_BOOTSTRAP is on and NODE_ENV is not production", async () => {
    const bootstrap = await import("@/app/api/e2e/bootstrap/route");
    const gift = await import("@/app/api/e2e/gift-card/route");
    const mail = await import("@/app/api/e2e/mail/route");
    const admin = adminCookieHeader();

    // default: the flag is not set at all
    expect((await bootstrap.GET()).status).toBe(404);
    expect((await gift.GET(makeRequest(`/api/e2e/gift-card/?order=${F.orderId}`, { cookie: admin }))).status).toBe(404);
    expect((await mail.GET(makeRequest("/api/e2e/mail/", { cookie: admin }))).status).toBe(404);

    // the flag on, but production semantics: still shut
    const nodeEnv = process.env.NODE_ENV;
    setEnv("E2E_BOOTSTRAP", "1");
    setEnv("NODE_ENV", "production");
    expect((await bootstrap.GET()).status).toBe(404);
    expect((await gift.GET(makeRequest(`/api/e2e/gift-card/?order=${F.orderId}`, { cookie: admin }))).status).toBe(404);
    expect((await mail.GET(makeRequest("/api/e2e/mail/", { cookie: admin }))).status).toBe(404);

    // the flag on outside production: bootstrap opens, the other two still need the cookie
    setEnv("NODE_ENV", "test");
    expect((await bootstrap.GET()).status).toBe(200);
    expect((await gift.GET(makeRequest(`/api/e2e/gift-card/?order=${F.orderId}`))).status).toBe(401);
    expect((await gift.GET(makeRequest(`/api/e2e/gift-card/?order=${F.orderId}`, { cookie: admin }))).status).toBe(200);
    expect((await mail.GET(makeRequest("/api/e2e/mail/"))).status).toBe(401);
    expect((await mail.GET(makeRequest("/api/e2e/mail/", { cookie: admin }))).status).toBe(200);
    setEnv("NODE_ENV", nodeEnv);
    setEnv("E2E_BOOTSTRAP", undefined);
  });
});
