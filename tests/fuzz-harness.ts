/**
 * Shared rig for the fuzz suites (tests/fuzz-*.test.ts) — see docs/testing.md
 * § «Фаззинг API».
 *
 * Everything here is deterministic: one seeded PRNG, one fixed corpus of
 * hostile values, one fixed set of fake ids. A failure reproduces on the next
 * run without a "flaky" label, which is the only way a fuzz suite is worth
 * keeping in CI.
 *
 * No network: `installFetchStub()` replaces global fetch with a router that
 * answers the four upstreams this app talks to (OpenAI, Resend, Telegram,
 * Montonio/Omniva) from canned bodies. A test that reaches an unexpected host
 * fails loudly rather than dialling out.
 */
import { expect, vi } from "vitest";
import { NextRequest } from "next/server";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { CUSTOMER_COOKIE, makeCustomerToken } from "@/lib/customers";
import { TEST_SECRET } from "./helpers";

export const ORIGIN = "https://rempireshop.com";
export const HOST = "rempireshop.com";
export const CRON_SECRET = "fuzz-cron-secret-0123456789";

type Min = { id: string; p: number; s: string };
const IN_STOCK = (catalogueMin as Min[]).filter((p) => p.s === "in");
export const PRODUCT = IN_STOCK[0];
/** A second product, so a test that makes one of them tracked-and-empty
 *  (stock invariants) cannot make every later order out_of_stock. */
export const PRODUCT_2 = IN_STOCK[1];

/* ---------- deterministic randomness ------------------------------------- */

/** mulberry32 — 32 bits of state, same sequence on every machine. */
export function prng(seed = 0x5eed1234): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

/* ---------- the corpus ---------------------------------------------------- */

/* Built with String.fromCharCode so the literals survive every editor, shell
   and diff between here and CI. */
export const NUL = String.fromCharCode(0);
const ZERO_WIDTH = String.fromCharCode(0x200b);
const RTL_OVERRIDE = String.fromCharCode(0x202e);
const LONG = "x".repeat(10_000);

/** Strings that have historically broken something, somewhere. */
export const HOSTILE_STRINGS: readonly string[] = [
  "",
  "   ",
  LONG,
  "😀🇪🇪" + ZERO_WIDTH + RTL_OVERRIDE + NUL + "tail",
  "a" + NUL + "b",
  "<script>alert(1)</script>",
  "'; DROP TABLE orders; --",
  "{{7*7}}",
  "%00",
  "../../etc/passwd",
  "..%2f..%2fetc%2fpasswd",
  "javascript:alert(1)",
  "=cmd|' /C calc'!A0",
  "@SUM(1+1)*cmd|' /C calc'!A0",
  "a@b",
  "x@@y.com",
  "a@b.c " + "a".repeat(300),
  "NaN",
  "Infinity",
  "-1",
  "1e308",
  "not-a-uuid",
  "00000000-0000-0000-0000-000000000000",
  "R-999999",
  "%2e%2e%2f",
];

export const HOSTILE_NUMBERS: readonly number[] = [0, -0, -1, 1, 0.1 + 0.2, 1e308, -1e308, 2 ** 53, -(2 ** 53), 99999];

/** Anything at all — the "wrong type" axis. */
export function hostileValues(): readonly unknown[] {
  const deep = deepObject(120);
  return [
    null,
    true,
    false,
    [],
    {},
    [1, 2, 3],
    [{ id: null }],
    deep,
    ...HOSTILE_NUMBERS,
    ...HOSTILE_STRINGS,
  ];
}

/** `{a:{a:{a:…}}}` — JSON.parse handles this depth, recursive validators may not. */
export function deepObject(depth: number): unknown {
  let out: unknown = 1;
  for (let i = 0; i < depth; i++) out = { a: out };
  return out;
}

/** Body-level abuse: the request never even reaches a field. */
export function hostileBodies(): Array<{ label: string; raw: string | null }> {
  return [
    { label: "no body", raw: null },
    { label: "empty string", raw: "" },
    { label: "invalid json", raw: "{not json" },
    { label: "json array", raw: "[]" },
    { label: "json number", raw: "5" },
    { label: "json null", raw: "null" },
    { label: "json string", raw: '"hello"' },
    { label: "json true", raw: "true" },
    { label: "deeply nested", raw: JSON.stringify(deepObject(120)) },
    { label: "2 MB body", raw: JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024) }) },
  ];
}

/* ---------- requests ------------------------------------------------------ */

let ipCounter = 0;
/** A fresh address per call: the limiters are per IP, and this suite is not testing them here. */
export function freshIp(): string {
  ipCounter += 1;
  return `198.18.${(ipCounter >> 8) % 200}.${(ipCounter % 250) + 1}`;
}
export function resetIps(): void {
  ipCounter = 0;
}

export function adminCookieHeader(): string {
  return `${ADMIN_COOKIE}=${makeSessionToken()}`;
}
export function customerCookieHeader(email: string): string {
  return `${CUSTOMER_COOKIE}=${makeCustomerToken(email)}`;
}

export interface ReqOpts {
  method?: string;
  body?: unknown;
  /** Sent verbatim — for the "not even JSON" cases. */
  raw?: string | null;
  cookie?: string;
  headers?: Record<string, string>;
  contentType?: string | null;
  ip?: string;
  next?: boolean;
}

export function makeRequest(path: string, opts: ReqOpts = {}): Request {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    host: HOST,
    "x-forwarded-for": opts.ip ?? freshIp(),
    ...opts.headers,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | undefined;
  if (opts.raw !== undefined && opts.raw !== null) body = opts.raw;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined && opts.contentType !== null) {
    headers["content-type"] = opts.contentType ?? "application/json";
  }
  const init = { method, headers } as RequestInit & { body?: string };
  if (body !== undefined && method !== "GET" && method !== "HEAD") init.body = body;
  const url = `${ORIGIN}${path}`;
  // NextRequest's own RequestInit is narrower than the DOM one (`signal` may
  // not be null there); the cast keeps one builder for both kinds of route.
  return opts.next
    ? (new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]) as unknown as Request)
    : new Request(url, init);
}

/* ---------- the checks ---------------------------------------------------- */

/**
 * 503s a healthy shop is allowed to answer: the deployment is missing a key
 * for an optional upstream. Anything else in the 5xx range is a bug — with a
 * live database and every stub answering, no input may produce one.
 */
const ENV_5XX_CODES = new Set(["not_configured", "no_api_key", "storage_not_configured", "not_implemented"]);

/** A stack frame that reached the wire is a leak, whatever the status. */
const STACK_RX = /(\n\s+at\s+\S|node_modules[\\/]|\.ts:\d+:\d+|[A-Za-z]:\\Users\\)/;

export interface Violation {
  where: string;
  why: string;
  status: number;
  body: string;
}

export function violations(): { list: Violation[]; assertClean: () => void } {
  const list: Violation[] = [];
  return {
    list,
    assertClean() {
      const summary = list
        .slice(0, 40)
        .map((v) => `${v.where}: ${v.why} [${v.status}] ${v.body.slice(0, 220)}`)
        .join("\n");
      expect(summary, `${list.length} violation(s)`).toBe("");
    },
  };
}

export interface CheckOpts {
  /** Statuses that are correct for this call even though they are 5xx. */
  allow5xx?: boolean;
  /** Skip the "4xx must be {ok:false,error}" shape check (HTML/CSV/PDF routes). */
  jsonBody?: boolean;
}

/**
 * The one assertion every fuzz case makes. Returns the parsed body so a caller
 * can add its own invariant on top.
 */
export async function checkResponse(
  bag: Violation[],
  where: string,
  res: Response,
  opts: CheckOpts = {},
): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
  const status = res.status;
  let text = "";
  try {
    text = await res.text();
  } catch (err) {
    bag.push({ where, why: `body unreadable: ${String(err)}`, status, body: "" });
    return { status, text, json: null };
  }
  const ct = res.headers.get("content-type") ?? "";
  let json: Record<string, unknown> | null = null;
  if (ct.includes("application/json") && text) {
    try {
      const parsed = JSON.parse(text);
      json = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      bag.push({ where, why: "content-type says JSON but the body is not", status, body: text });
    }
  }

  if (status >= 500) {
    const code = typeof json?.error === "string" ? json.error : "";
    const envRefusal = (status === 503 || status === 501) && ENV_5XX_CODES.has(code);
    if (!opts.allow5xx && !envRefusal) {
      bag.push({ where, why: "5xx", status, body: text });
    }
  }
  if (STACK_RX.test(text)) {
    bag.push({ where, why: "stack trace / path in the body", status, body: text });
  }
  if (status >= 400 && status < 500 && json && opts.jsonBody !== false) {
    if (json.ok !== undefined && json.ok !== false) {
      bag.push({ where, why: "4xx without ok:false", status, body: text });
    }
    if (typeof json.error !== "string" || !json.error) {
      bag.push({ where, why: "4xx without an error code", status, body: text });
    }
  }
  return { status, text, json };
}

/* ---------- environment --------------------------------------------------- */

/**
 * Every optional integration is switched ON with a fake key, so the fuzz runs
 * reach the code behind the "not configured" doors rather than bouncing off
 * them. The upstreams themselves are the stub below.
 *
 * The previous values are snapshotted and handed back as a restore function:
 * vitest runs test files sequentially in one worker process
 * (`fileParallelism: false`), so leaving RESEND_API_KEY or PAYMENT_PROVIDER
 * set here would quietly change what the next file sees.
 */
const FUZZ_ENV: Record<string, string> = {
  PAYMENT_PROVIDER: "mock",
  PUBLIC_BASE_URL: ORIGIN,
  CRON_SECRET,
  OPENAI_API_KEY: "sk-fuzz-not-a-real-key",
  RESEND_API_KEY: "re_fuzz_not_a_real_key",
  MAIL_RETRY_DELAY_MS: "0", // no 400 ms nap on a stubbed 5xx
  R2_ACCOUNT_ID: "fuzz-account",
  R2_ACCESS_KEY_ID: "fuzz-key",
  R2_SECRET_ACCESS_KEY: "fuzz-secret",
  R2_BUCKET: "fuzz-bucket",
  R2_PUBLIC_BASE: "https://media.example.test",
  // product creation: «Убрать фон» on, so POST /api/admin/upload/cutout runs
  // its whole path against the stub instead of answering 503 to everything
  PHOTO_CUTOUT: "openai",
};
const FUZZ_ENV_OFF = [
  "E2E_BOOTSTRAP",
  "E2E_EXPOSE_LOGIN_CODE",
  "MONTONIO_ACCESS_KEY",
  "MONTONIO_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "BLOB_READ_WRITE_TOKEN",
  "GSC_SERVICE_ACCOUNT_JSON",
];

export function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Applies the fuzz environment; call the result in afterAll to put it back. */
export function setFuzzEnv(): () => void {
  const names = [...Object.keys(FUZZ_ENV), ...FUZZ_ENV_OFF, "SESSION_SECRET", "ADMIN_PASSWORD_HASH"];
  const saved = new Map(names.map((n) => [n, process.env[n]]));
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  for (const [k, v] of Object.entries(FUZZ_ENV)) process.env[k] = v;
  for (const k of FUZZ_ENV_OFF) delete process.env[k];
  return () => {
    for (const [k, v] of saved) setEnv(k, v);
  };
}

const OPENAI_REPLY = JSON.stringify({ reply: "ok", product_ids: [], tab: "", description: "d", title: "t" });
/** A 1×1 PNG — what the media host and the image edit endpoint hand back. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Hosts the stub was asked for and had no answer to — asserted empty by the suite. */
export const unexpectedFetches = new Set<string>();

/** Answers the handful of hosts this app can dial, and nothing else. */
export function installFetchStub(): void {
  const stub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    // product creation: the image edit endpoint answers a picture, the chat
    // one an answer; the public media host serves the «original» photo
    if (url.includes("api.openai.com/v1/images/")) return json({ data: [{ b64_json: TINY_PNG.toString("base64") }] });
    if (url.includes("api.openai.com")) {
      return json({ model: "gpt-4.1-mini", choices: [{ message: { content: OPENAI_REPLY } }], usage: {} });
    }
    if (url.startsWith(FUZZ_ENV.R2_PUBLIC_BASE + "/")) return new Response(new Uint8Array(TINY_PNG), { status: 200 });
    if (url.includes("api.resend.com")) return json({ id: "re_fuzz_1" });
    if (url.includes("api.telegram.org")) return json({ ok: true });
    if (url.includes("r2.cloudflarestorage.com")) return new Response("", { status: 200 });
    if (url.includes("montonio")) return json({ error: "not configured" }, 401);
    if (/omniva|smartpost|itella|dpd|venipak|unisend/i.test(url)) return json([]);
    if (url.includes("googleapis.com") || url.includes("oauth2")) return json({ error: "no" }, 401);
    /* A host this stub does not know is a hole in the stub, not a licence to
       dial out: answer like a dead upstream and let the suite report it. */
    unexpectedFetches.add(new URL(url).host);
    return json({ error: "unstubbed" }, 502);
  });
  vi.stubGlobal("fetch", stub);
}

/* ---------- fixtures ------------------------------------------------------ */

export interface Fixtures {
  orderId: string;
  orderNumber: string;
  paidOrderId: string;
  paidOrderNumber: string;
  customerId: string;
  customerEmail: string;
  postId: string;
  postSlug: string;
  reviewId: string;
  promoCode: string;
  giftCode: string;
  /** A product the owner created (custom_products, `c-…`) — the request-time product page has a row to answer from. */
  customId: string;
  /** A newsletter draft (newsletters) — the letter routes have a row to answer from. */
  newsletterId: string;
}

/** One known row of every shape a route can be asked for, so "not_found" is a
 *  deliberate case rather than the only case every fuzz run ever reaches. */
export async function seedFixtures(): Promise<Fixtures> {
  const { query } = await import("@/lib/db");
  const { createOrder, setOrderStatus } = await import("@/lib/orders");
  const { addReview } = await import("@/lib/reviews");
  const { upsertPromo } = await import("@/lib/promos");
  const { upsertPost } = await import("@/lib/blog");
  const { recordLogin } = await import("@/lib/customers");
  const { createCustomProduct } = await import("@/lib/custom-products");
  const { createNewsletter } = await import("@/lib/newsletters");

  const base = {
    lang: "RU",
    items: [{ id: PRODUCT.id, qty: 1 }],
    customer: { name: "Fuzz Ostja", email: "fuzz@example.com", phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
  };
  const order = await createOrder(base);
  const paid = await createOrder(base);
  await setOrderStatus(paid.id, "paid", "fuzz");

  const customer = await recordLogin("fuzz@example.com", "RU");
  const review = await addReview({ productId: PRODUCT.id, name: "Fuzz", rating: 5, text: "Хороший товар, беру ещё.", lang: "RU" }, null);
  const promo = await upsertPromo({ code: "FUZZ10", kind: "percent", value: 10, minSubtotal: 0, startsAt: null, endsAt: null, maxUses: null, active: true, note: null });
  const post = await upsertPost({ title: { RU: "Фазз" }, body: { RU: "Текст" }, slug: "fuzz-post" });
  const custom = await createCustomProduct({
    brand: "Фазз", name: "Balm — бальзам для бороды", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [9.9, 19.9],
    description: { RU: "Описание." }, seo: { RU: { title: "Фазз бальзам", desc: "Описание для Google." } },
  });
  await query(
    "insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU') on conflict (code) do nothing",
    ["RMP-ACDE-FGHJ", 50, 50],
  );
  const news = await createNewsletter({
    title: "Фазз", subject: { RU: "Тема" }, body: { RU: "<p>Текст письма.</p>" }, products: [PRODUCT.id],
  });

  return {
    orderId: order.id,
    orderNumber: order.number,
    paidOrderId: paid.id,
    paidOrderNumber: paid.number,
    customerId: customer.id,
    customerEmail: customer.email,
    postId: post.id,
    postSlug: post.slug,
    reviewId: review.id,
    promoCode: promo.code,
    giftCode: "RMP-ACDE-FGHJ",
    customId: custom.id,
    newsletterId: news.id,
  };
}
