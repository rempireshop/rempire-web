/**
 * POST /api/admin/upload/cutout — «Убрать фон» (src/lib/photo-cutout.ts).
 *
 * The network is stubbed at fetch: the bucket, the original photo and OpenAI
 * all answer from here, so nothing leaves the machine. What is pinned: with
 * PHOTO_CUTOUT="openai" the route fetches the original, asks the image edit
 * endpoint for gpt-image-1 with a transparent background and stores the PNG
 * (plus its thumbnail) NEXT TO the original under a `-cutout` name; without
 * the switch it says so and calls nothing; when the model fails nothing is
 * written and the answer is a plain 502 — the original stays.
 */
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { cutoutEnabled, cutoutKey, CUTOUT_ENDPOINT } from "@/lib/photo-cutout";
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

type Call = { url: string; method: string; body?: unknown };

/** One stub for the three hosts the route talks to. */
function stubNet(opts: { openai?: number; source?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: unknown) => {
      const u = String(url);
      const method = ((init as RequestInit | undefined)?.method || "GET").toUpperCase();
      calls.push({ url: u, method, body: (init as RequestInit | undefined)?.body });
      if (u.startsWith(R2_ENV.R2_PUBLIC_BASE + "/")) {
        const status = opts.source ?? 200;
        return new Response(status === 200 ? new Uint8Array(original) : "nope", { status });
      }
      if (u === CUTOUT_ENDPOINT) {
        const status = opts.openai ?? 200;
        if (status !== 200) return new Response(JSON.stringify({ error: { message: "boom" } }), { status });
        return new Response(JSON.stringify({ data: [{ b64_json: cutout.toString("base64") }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 200 }); // the bucket
    }),
  );
  return calls;
}

function post(body: unknown, cookie = admin) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/upload/cutout/`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("photo cutout", () => {
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
    process.env.OPENAI_API_KEY = "sk-test";
    await truncateAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(R2_ENV)) delete process.env[k];
    delete process.env.PHOTO_CUTOUT;
    delete process.env.OPENAI_API_KEY;
  });

  it("cutoutEnabled() needs both the switch and a key; cutoutKey() lands next to the original", () => {
    expect(cutoutEnabled({ PHOTO_CUTOUT: "openai", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe(true);
    expect(cutoutEnabled({ PHOTO_CUTOUT: "openai" } as NodeJS.ProcessEnv)).toBe(false);
    expect(cutoutEnabled({ OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe(false);
    expect(cutoutEnabled({ PHOTO_CUTOUT: "yes", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe(false);
    expect(cutoutKey(KEY)).toBe("products/touchable/1700000000000-photo-cutout.png");
    expect(cutoutKey("products/touchable/1-a-cutout.png")).toBe("products/touchable/1-a-cutout.png");
  });

  it("success: fetches the original, asks gpt-image-1 for a transparent background, stores the PNG and its thumb", async () => {
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const calls = stubNet();
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      key: "products/touchable/1700000000000-photo-cutout.png",
      url: "https://media.rempireshop.com/products/touchable/1700000000000-photo-cutout.png",
      thumbUrl: "https://media.rempireshop.com/products/touchable/1700000000000-photo-cutout-thumb.webp",
    });
    expect(body.bytes).toBe(cutout.length);

    // the original was read from its public address, never rewritten
    expect(calls.find((c) => c.url === `${R2_ENV.R2_PUBLIC_BASE}/${KEY}` && c.method === "GET")).toBeTruthy();
    // the model call, with the parameters the feature promises
    const ai = calls.find((c) => c.url === CUTOUT_ENDPOINT)!;
    expect(ai.method).toBe("POST");
    const form = ai.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1");
    expect(form.get("background")).toBe("transparent");
    expect(String(form.get("prompt"))).toMatch(/exactly as it is photographed/);
    expect(String(form.get("prompt"))).toMatch(/remove the background/);
    // two PUTs — the PNG and its thumbnail — and nothing at the original key
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url);
    expect(puts).toEqual([
      `https://acc123.r2.cloudflarestorage.com/rempire-media/products/touchable/1700000000000-photo-cutout.png`,
      `https://acc123.r2.cloudflarestorage.com/rempire-media/products/touchable/1700000000000-photo-cutout-thumb.webp`,
    ]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("accepts the public URL of the photo instead of the key", async () => {
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    stubNet();
    const res = await POST(post({ url: `${R2_ENV.R2_PUBLIC_BASE}/${KEY}` }));
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("products/touchable/1700000000000-photo-cutout.png");
  });

  it("disabled: without PHOTO_CUTOUT=openai it says so and calls nothing — and the probe says so too", async () => {
    delete process.env.PHOTO_CUTOUT;
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const { GET } = await import("@/app/api/admin/upload/route");
    const calls = stubNet();
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "cutout_disabled" });
    expect(calls).toHaveLength(0);
    const probe = await (await GET(new Request(`${ORIGIN}/api/admin/upload/`, { headers: { cookie: admin } }))).json();
    expect(probe).toMatchObject({ ok: true, configured: true, cutout: false });

    process.env.PHOTO_CUTOUT = "openai";
    const probe2 = await (await GET(new Request(`${ORIGIN}/api/admin/upload/`, { headers: { cookie: admin } }))).json();
    expect(probe2.cutout).toBe(true);
  });

  it("failure: when the model answers 500 nothing is written and the owner gets a plain 502", async () => {
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const calls = stubNet({ openai: 500 });
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "cutout_failed" });
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("failure: an original that cannot be read is a 502 too, before any model call", async () => {
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const calls = stubNet({ source: 404 });
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "source_unavailable" });
    expect(calls.some((c) => c.url === CUTOUT_ENDPOINT)).toBe(false);
  });

  it("refuses a key that is not a product photo of ours, and anyone without the cookie", async () => {
    const { POST } = await import("@/app/api/admin/upload/cutout/route");
    const calls = stubNet();
    expect((await POST(post({ key: "hero/1-a.webp" }))).status).toBe(400);
    expect((await POST(post({ key: "../etc/passwd" }))).status).toBe(400);
    expect((await POST(post({ url: "https://evil.example/products/x/1.webp" }))).status).toBe(400);
    expect((await POST(post({ key: KEY }, ""))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
