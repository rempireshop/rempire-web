/**
 * The R2 client: the signature arithmetic, the key rules, and the two verbs
 * driven against a stubbed fetch — no bucket, no network, no credentials.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteObject,
  encodePath,
  isAllowedKey,
  keyFromUrl,
  mediaKey,
  publicUrl,
  putObject,
  signRequest,
  slugify,
  StorageError,
  storageConfig,
  storageConfigured,
  thumbKey,
} from "@/lib/storage";

const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  R2_BUCKET: "rempire-media",
  R2_PUBLIC_BASE: "https://media.rempireshop.com/",
};

function setEnv(on: boolean) {
  for (const [k, v] of Object.entries(R2_ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  setEnv(false);
});

/* ---------- signature version 4 ------------------------------------------ */

/*
 * The published AWS example "GET Object" (Signature Version 4 test suite):
 * bucket examplebucket, object test.txt, a Range header, 24 May 2013. If this
 * passes, every byte of the canonical request, the scope and the HMAC chain is
 * in the right order — which is the only thing R2 will tell us about, and it
 * will tell us with a 403 and no explanation.
 */
describe("SigV4", () => {
  const VECTOR = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    emptySha: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    canonicalHash: "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    signature: "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  };

  const signed = () =>
    signRequest({
      method: "GET",
      url: VECTOR.url,
      headers: { range: "bytes=0-9" },
      payloadHash: VECTOR.emptySha,
      accessKeyId: VECTOR.accessKeyId,
      secretAccessKey: VECTOR.secretAccessKey,
      region: "us-east-1",
      service: "s3",
      now: new Date("2013-05-24T00:00:00.000Z"),
    });

  it("builds the canonical request AWS publishes", () => {
    expect(signed().canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${VECTOR.emptySha}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        VECTOR.emptySha,
      ].join("\n"),
    );
  });

  it("builds the string to sign AWS publishes", () => {
    expect(signed().stringToSign).toBe(
      ["AWS4-HMAC-SHA256", "20130524T000000Z", "20130524/us-east-1/s3/aws4_request", VECTOR.canonicalHash].join("\n"),
    );
  });

  it("produces the published signature and Authorization header", () => {
    const s = signed();
    expect(s.signature).toBe(VECTOR.signature);
    expect(s.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 " +
        `Credential=${VECTOR.accessKeyId}/20130524/us-east-1/s3/aws4_request, ` +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        `Signature=${VECTOR.signature}`,
    );
  });

  it("defaults to R2's region and service", () => {
    const s = signRequest({
      method: "PUT",
      url: "https://acc123.r2.cloudflarestorage.com/rempire-media/hero/1-a.webp",
      payloadHash: VECTOR.emptySha,
      accessKeyId: "k",
      secretAccessKey: "s",
      now: new Date("2026-09-03T10:00:00.000Z"),
    });
    expect(s.headers.authorization).toContain("/20260903/auto/s3/aws4_request");
    expect(s.headers["x-amz-date"]).toBe("20260903T100000Z");
  });

  it("signs the path segment by segment, leaving the slashes alone", () => {
    expect(encodePath("products/touchable/17-a b.webp")).toBe("products/touchable/17-a%20b.webp");
  });
});

/* ---------- keys ---------------------------------------------------------- */

describe("keys", () => {
  it("slugifies a phone's file name", () => {
    expect(slugify("IMG_0421.HEIC")).toBe("img-0421"); // one separator, always a dash
    expect(slugify("Kevin Murphy Touchable.jpeg")).toBe("kevin-murphy-touchable");
    expect(slugify("Шампунь.jpg")).toBe("photo"); // nothing latin survives
    expect(slugify("")).toBe("photo");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it("builds one key shape per kind", () => {
    expect(mediaKey("product", "front.jpg", "touchable", 1756900000000)).toBe(
      "products/touchable/1756900000000-front.webp",
    );
    expect(mediaKey("hero", "banner.png", null, 1756900000000)).toBe("hero/1756900000000-banner.webp");
    expect(mediaKey("review", "x.jpg", "3f6b1c2e", 1756900000000)).toBe("reviews/3f6b1c2e/1756900000000-x.webp");
  });

  it("refuses an owner id that would break the key", () => {
    expect(() => mediaKey("product", "a.jpg", "../../etc")).toThrow(StorageError);
    expect(() => mediaKey("product", "a.jpg", "")).toThrow(StorageError);
  });

  it("names the thumbnail beside the photo", () => {
    expect(thumbKey("products/x/1-a.webp")).toBe("products/x/1-a-thumb.webp");
  });

  it("only allows keys this shop wrote", () => {
    expect(isAllowedKey("products/touchable/1-a.webp")).toBe(true);
    expect(isAllowedKey("hero/1-a.webp")).toBe(true);
    expect(isAllowedKey("reviews/abc/1-a.webp")).toBe(true);

    expect(isAllowedKey("secrets/keys.webp")).toBe(false); // wrong prefix
    expect(isAllowedKey("/products/x/1.webp")).toBe(false); // absolute
    expect(isAllowedKey("products/../../etc/passwd.webp")).toBe(false); // traversal
    expect(isAllowedKey("products//x/1.webp")).toBe(false); // empty segment
    expect(isAllowedKey("products/X/1.webp")).toBe(false); // upper case
    expect(isAllowedKey("products/x/1.exe")).toBe(false); // not an image
    expect(isAllowedKey(" products/x/1.webp")).toBe(false); // padded
    expect(isAllowedKey(`products/x/${"a".repeat(300)}.webp`)).toBe(false); // absurd
    expect(isAllowedKey(null)).toBe(false);
    expect(isAllowedKey(42)).toBe(false);
  });

  it("reads our own key back out of a public URL, and nobody else's", () => {
    setEnv(true);
    expect(keyFromUrl("https://media.rempireshop.com/products/x/1-a.webp")).toBe("products/x/1-a.webp");
    expect(keyFromUrl("https://media.rempireshop.com/products/x/1-a.webp?v=2")).toBe("products/x/1-a.webp");
    expect(keyFromUrl("https://evil.example/products/x/1-a.webp")).toBe(null);
    expect(keyFromUrl("https://media.rempireshop.com/secrets/a.webp")).toBe(null);
  });
});

/* ---------- configuration ------------------------------------------------- */

describe("configuration", () => {
  it("is off until all five variables are set", () => {
    setEnv(false);
    expect(storageConfigured()).toBe(false);
    expect(storageConfig()).toBe(null);
    expect(publicUrl("hero/1-a.webp")).toBe("");

    setEnv(true);
    delete process.env.R2_BUCKET;
    expect(storageConfigured()).toBe(false);

    process.env.R2_BUCKET = "rempire-media";
    expect(storageConfigured()).toBe(true);
    // the trailing slash on R2_PUBLIC_BASE must not double up
    expect(publicUrl("hero/1-a.webp")).toBe("https://media.rempireshop.com/hero/1-a.webp");
  });
});

/* ---------- put / delete -------------------------------------------------- */

describe("putObject / deleteObject", () => {
  beforeEach(() => setEnv(true));

  function stub(status = 200, body = "") {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: init as RequestInit });
        // 204 must not carry a body, and R2 answers a delete with exactly that
        return new Response(status === 204 ? null : body, { status });
      }),
    );
    return calls;
  }

  it("PUTs to the bucket endpoint with a signed Authorization header", async () => {
    const calls = stub(200);
    const out = await putObject({
      key: "products/touchable/1-a.webp",
      body: Buffer.from("not really a webp"),
      contentType: "image/webp",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://acc123.r2.cloudflarestorage.com/rempire-media/products/touchable/1-a.webp");
    expect(calls[0].init.method).toBe("PUT");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\//);
    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["cache-control"]).toContain("immutable");
    expect(headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);

    expect(out).toEqual({
      key: "products/touchable/1-a.webp",
      url: "https://media.rempireshop.com/products/touchable/1-a.webp",
      bytes: 17,
    });
  });

  it("turns a refusal from R2 into a StorageError", async () => {
    stub(403, "<Error>SignatureDoesNotMatch</Error>");
    await expect(
      putObject({ key: "hero/1-a.webp", body: Buffer.from("x"), contentType: "image/webp" }),
    ).rejects.toMatchObject({ code: "put_failed", status: 502 });
  });

  it("will not write outside the three prefixes", async () => {
    stub(200);
    await expect(
      putObject({ key: "../wp-config.php", body: Buffer.from("x"), contentType: "image/webp" }),
    ).rejects.toMatchObject({ code: "bad_key" });
  });

  it("deletes, and treats a missing object as already gone", async () => {
    const calls = stub(204);
    await deleteObject("hero/1-a.webp");
    expect(calls[0].init.method).toBe("DELETE");

    stub(404, "");
    await expect(deleteObject("hero/1-a.webp")).resolves.toBeUndefined();

    stub(500, "boom");
    await expect(deleteObject("hero/1-a.webp")).rejects.toMatchObject({ code: "delete_failed" });
  });

  it("says so plainly when there is no bucket configured", async () => {
    setEnv(false);
    stub(200);
    await expect(
      putObject({ key: "hero/1-a.webp", body: Buffer.from("x"), contentType: "image/webp" }),
    ).rejects.toMatchObject({ code: "storage_not_configured", status: 503 });
    await expect(deleteObject("hero/1-a.webp")).rejects.toMatchObject({ code: "storage_not_configured" });
  });
});
