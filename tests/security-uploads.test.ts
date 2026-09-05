/**
 * Security re-audit, 04.09.2026 — uploads and «Убрать фон»
 * (src/app/api/admin/upload/route.ts, src/app/api/admin/upload/cutout/route.ts,
 * src/lib/photo-cutout.ts, src/lib/storage.ts).
 *
 * What is pinned: the model call and the source fetch have a deadline, so a
 * hung upstream is a plain 502 and not a function held open until the
 * platform kills it; an upstream error that echoes the key never reaches
 * the browser; only a product photo of ours can be cut out — no traversal,
 * no other prefix, no other host; forty cut-outs an hour per session; the
 * delete door never opens for the gift-card PDFs the shop writes for itself;
 * an upload's owner id is a slug or nothing.
 */
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { CUTOUT_ENDPOINT } from "@/lib/photo-cutout";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  R2_BUCKET: "rempire-media",
  R2_PUBLIC_BASE: "https://media.rempireshop.com",
};
const KEY = "products/touchable/1700000000000-photo.webp";

let admin = "";
let original: Buffer;
let cutout: Buffer;

type Call = { url: string; method: string; signal: unknown };

/**
 * One stub for the three hosts the cut-out route talks to. `hang` names the
 * one that never answers on its own: it rejects only when the request's
 * AbortSignal fires — like a dead socket would — and, so that a route with
 * no deadline cannot hang the suite, gives up by itself after four seconds.
 */
function stubNet(opts: { hang?: "openai" | "source"; openaiStatus?: number; openaiBody?: string } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      const method = (init?.method || "GET").toUpperCase();
      calls.push({ url: u, method, signal: init?.signal });
      const hang = () =>
        new Promise<Response>((_, reject) => {
          const s = init?.signal;
          if (s) s.addEventListener("abort", () => reject(s.reason ?? new Error("aborted")), { once: true });
          const t = setTimeout(() => reject(new Error("no deadline was set")), 4000);
          (t as unknown as { unref?: () => void }).unref?.();
        });
      if (u.startsWith(R2_ENV.R2_PUBLIC_BASE + "/")) {
        return opts.hang === "source" ? hang() : Promise.resolve(new Response(new Uint8Array(original), { status: 200 }));
      }
      if (u === CUTOUT_ENDPOINT) {
        if (opts.hang === "openai") return hang();
        const status = opts.openaiStatus ?? 200;
        if (status !== 200) {
          return Promise.resolve(new Response(opts.openaiBody ?? JSON.stringify({ error: { message: "boom" } }), { status }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: cutout.toString("base64") }] }), {
          status: 200, headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response("", { status: 200 })); // the bucket
    }),
  );
  return calls;
}

function post(body: unknown, cookie = admin) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/upload/cutout/`, { method: "POST", headers, body: JSON.stringify(body) });
}

function upload(file: Buffer, fields: Record<string, string>, cookie = admin) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(file)], "photo.png"));
  for (const [k, v] of Object.entries({ kind: "product", ...fields })) form.append(k, v);
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/upload/`, { method: "POST", body: form, headers });
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  original = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 40, b: 40 } } }).webp().toBuffer();
  cutout = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } }).png().toBuffer();
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  for (const [k, v] of Object.entries(R2_ENV)) process.env[k] = v;
  process.env.PHOTO_CUTOUT = "openai";
  process.env.OPENAI_API_KEY = "sk-test-leak-me-not";
  vi.spyOn(console, "error").mockImplementation(() => {});
  await truncateAll();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const k of Object.keys(R2_ENV)) delete process.env[k];
  delete process.env.PHOTO_CUTOUT;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PHOTO_CUTOUT_TIMEOUT_MS;
});

/* ---------- «Убрать фон» ------------------------------------------------- */

describe("POST /api/admin/upload/cutout", () => {
  it("a model that never answers is a 502 within the deadline, not a function held open", async () => {
    process.env.PHOTO_CUTOUT_TIMEOUT_MS = "40";
    const calls = stubNet({ hang: "openai" });
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const t0 = Date.now();
    const res = await POST(post({ key: KEY }));
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "cutout_failed" });
    const model = calls.find((c) => c.url === CUTOUT_ENDPOINT);
    expect(model?.signal).toBeInstanceOf(AbortSignal);
    // nothing was stored on a failure
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("the fetch of the original has a deadline of its own", async () => {
    process.env.PHOTO_CUTOUT_TIMEOUT_MS = "40";
    const calls = stubNet({ hang: "source" });
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const t0 = Date.now();
    const res = await POST(post({ key: KEY }));
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "source_unavailable" });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls.some((c) => c.url === CUTOUT_ENDPOINT)).toBe(false);
  });

  it("an upstream error that echoes the key never reaches the browser", async () => {
    stubNet({ openaiStatus: 401, openaiBody: JSON.stringify({ error: { message: "Incorrect API key provided: sk-test-leak-me-not" } }) });
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "cutout_failed" });
    expect(text).not.toContain("sk-test");
    expect(text).not.toContain("openai");
    // and neither does the server log line
    for (const call of (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      expect(JSON.stringify(call)).not.toContain("sk-test-leak-me-not");
    }
  });

  it("only a product photo of ours: no traversal, no other prefix, no other host, no other type", async () => {
    const calls = stubNet();
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const bodies: unknown[] = [
      { key: "products/../hero/1.webp" },
      { key: "products/x/1.webp/../../y.webp" },
      { key: "hero/1.webp" },
      { key: "reviews/x/1.webp" },
      { key: "videos/x/1.mp4" },
      { key: "giftcards/rmp-acde-fghj.pdf" },
      { key: "products/x/1.svg" },
      { key: "products/x/1.webp?x=1" },
      { key: "Products/x/1.webp" },
      { key: "products/x/1\u0000.webp" },
      { key: " products/x/1.webp" },
      { key: "/products/x/1.webp" },
      { key: "products//x/1.webp" },
      { key: "products/x/" + "a".repeat(300) + ".webp" },
      { url: "https://evil.example/products/x/1.webp" },
      { url: "https://media.rempireshop.com.evil.example/products/x/1.webp" },
      { url: "https://media.rempireshop.com/../products/x/1.webp" },
      { url: "https://media.rempireshop.com/hero/1.webp" },
      { url: "https://media.rempireshop.com/products/x/1.webp/../../giftcards/x.pdf" },
      { url: "javascript:alert(1)" },
      { key: ["products/x/1.webp"] },
      { key: { toString: () => "products/x/1.webp" } },
      {},
    ];
    for (const body of bodies) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error, JSON.stringify(body)).toBe("bad_key");
    }
    expect(calls).toHaveLength(0);
  });

  it("forty cut-outs an hour per session, then 429 — the model is not asked again", async () => {
    const calls = stubNet();
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    for (let i = 0; i < 40; i++) {
      expect((await POST(post({ key: KEY }))).status, `call ${i + 1}`).toBe(200);
    }
    const modelCalls = calls.filter((c) => c.url === CUTOUT_ENDPOINT).length;
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(calls.filter((c) => c.url === CUTOUT_ENDPOINT).length).toBe(modelCalls);
  }, 60_000);
});

/* ---------- the upload route --------------------------------------------- */

describe("the upload route", () => {
  it("DELETE never touches the gift-card PDFs, nor anything outside the upload prefixes", async () => {
    const calls = stubNet();
    const { DELETE } = await import("@/app/api/admin/upload/route");
    for (const key of ["giftcards/rmp-acde-fghj.pdf", "products/../giftcards/x.pdf", "products/x/../../y.webp", "etc/passwd", "products/x/1.webp\u0000"]) {
      const res = await DELETE(new Request(`${ORIGIN}/api/admin/upload/?key=${encodeURIComponent(key)}`, { method: "DELETE", headers: { cookie: admin } }));
      expect(res.status, key).toBe(400);
      expect((await res.json()).error, key).toBe("bad_key");
    }
    expect(calls).toHaveLength(0);
    // a photo of ours still goes
    const ok = await DELETE(new Request(`${ORIGIN}/api/admin/upload/?key=${KEY}`, { method: "DELETE", headers: { cookie: admin } }));
    expect(ok.status).toBe(200);
    expect(calls.filter((c) => c.method === "DELETE").length).toBe(2);
  });

  it("an upload's owner id is a slug — a custom id lands under products/c-…, a path does not land at all", async () => {
    const calls = stubNet();
    const { POST } = await import("@/app/api/admin/upload/route");
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    for (const productId of ["../../x", "x/../y", "a b", "x".repeat(81), "%2e%2e", ".hidden", "-lead"]) {
      const res = await POST(upload(png, { productId }));
      expect(res.status, productId).toBe(400);
      expect((await res.json()).error, productId).toBe("bad_id");
    }
    expect(calls).toHaveLength(0);
    const ok = await POST(upload(png, { productId: "c-proraso-beard-balm" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).key).toMatch(/^products\/c-proraso-beard-balm\/\d+-photo\.webp$/);
  });
});
