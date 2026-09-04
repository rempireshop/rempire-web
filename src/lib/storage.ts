/**
 * Cloudflare R2 — the shop's media bucket, spoken to in plain S3.
 *
 * R2 is S3-compatible, so the whole client is one signed `fetch`: AWS Signature
 * Version 4 with node:crypto. No AWS SDK — it is ~3 MB of JavaScript for two
 * verbs, and this file is under two hundred lines.
 *
 * Endpoint (path style, the only one R2 offers on the API host):
 *   https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 * Region is always the literal `auto`, service `s3`.
 *
 * Public reads never come through here. The bucket is published on its own
 * hostname (a custom domain like https://media.rempireshop.com, or the
 * pub-….r2.dev one) and R2_PUBLIC_BASE names it; publicUrl() just joins.
 *
 * Environment (values live in Vercel / .env.local, never in the repo):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *   R2_PUBLIC_BASE
 * With any of them missing storageConfigured() is false and the admin says so
 * — nothing else in the shop changes. See docs/media.md.
 */
import { createHash, createHmac } from "node:crypto";

export const ALGORITHM = "AWS4-HMAC-SHA256";
export const R2_REGION = "auto";
export const R2_SERVICE = "s3";

/** Where an uploaded file is allowed to land. Nothing else is ever written.
 *  `videos/` holds the product videos the owner uploads himself — see
 *  src/lib/video.ts and docs/media.md. */
export const KEY_PREFIXES = ["products/", "hero/", "reviews/", "blog/", "videos/"] as const;
export type MediaKind = "product" | "hero" | "review" | "blog" | "video";

export class StorageError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 500, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.status = status;
  }
}

/* ---------- configuration ------------------------------------------------ */

export type StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

function env(name: string): string {
  return (process.env[name] || "").trim();
}

/** The five variables, or null when even one of them is missing. */
export function storageConfig(): StorageConfig | null {
  const accountId = env("R2_ACCOUNT_ID");
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const bucket = env("R2_BUCKET");
  const publicBase = env("R2_PUBLIC_BASE").replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBase };
}

export function storageConfigured(): boolean {
  return storageConfig() !== null;
}

/** The browser-facing address of an object. Empty string when unconfigured. */
export function publicUrl(key: string): string {
  const cfg = storageConfig();
  if (!cfg) return "";
  return `${cfg.publicBase}/${key.replace(/^\/+/, "")}`;
}

/* ---------- keys --------------------------------------------------------- */

/**
 * A file name the bucket, a URL and a shell can all live with: lower case,
 * ASCII, no spaces. Cyrillic names transliterate to nothing useful, so an
 * empty result falls back to "photo" rather than producing a bare timestamp.
 */
export function slugify(name: string): string {
  const base = String(name || "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "") // drop the extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base || "photo";
}

/**
 * Ids come from the catalogue (`touchable`, `killer-curls-wash`) and from the
 * database (a uuid). Anything else is refused rather than repaired: an id that
 * needed cleaning up is an id that came from somewhere it should not have.
 */
function safeId(id: string): string {
  const s = String(id || "").trim().toLowerCase();
  if (!s || s.length > 80 || s.includes("..") || !/^[a-z0-9][a-z0-9._-]*$/.test(s)) {
    throw new StorageError("bad_id", 400, String(id).slice(0, 60));
  }
  return s;
}

/**
 * `products/<id>/<timestamp>-<slug>.webp`, `hero/<timestamp>-<slug>.webp`,
 * `reviews/<id>/<timestamp>-<slug>.webp`, `videos/<id>/<timestamp>-<slug>.mp4`.
 * The timestamp is what makes a replacement a new URL, so no cache anywhere
 * has to be persuaded to forget the old picture.
 *
 * `ext` exists for the one kind that is not a WebP: an uploaded video keeps
 * mp4/mov, since nothing here transcodes it (src/lib/video.ts).
 */
export function mediaKey(
  kind: MediaKind,
  filename: string,
  ownerId?: string | null,
  now = Date.now(),
  ext = "webp",
): string {
  const stamp = String(now);
  const slug = slugify(filename);
  const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "webp";
  if (kind === "hero") return `hero/${stamp}-${slug}.${safeExt}`;
  if (kind === "blog") return `blog/${stamp}-${slug}.${safeExt}`;
  if (kind === "product") return `products/${safeId(String(ownerId || ""))}/${stamp}-${slug}.${safeExt}`;
  if (kind === "review") return `reviews/${safeId(String(ownerId || ""))}/${stamp}-${slug}.${safeExt}`;
  if (kind === "video") return `videos/${safeId(String(ownerId || ""))}/${stamp}-${slug}.${safeExt}`;
  throw new StorageError("bad_kind", 400, String(kind));
}

/** `…/x.webp` → `…/x-thumb.webp`. */
export function thumbKey(key: string): string {
  return key.replace(/\.webp$/, "-thumb.webp");
}

/**
 * True only for a key this shop wrote: one of the prefixes above, plain
 * characters, no traversal, no empty segment. Everything that deletes or
 * signs goes through here first. mp4/mov are here for `videos/` — this is a
 * coarse "is this one of ours" gate, not the place that decides which kind
 * may hold which extension; the upload route does that.
 */
export function isAllowedKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const k = key.trim();
  if (!k || k.length > 200 || k !== key) return false;
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(k)) return false;
  if (k.includes("//") || k.includes("..")) return false;
  if (!KEY_PREFIXES.some((p) => k.startsWith(p))) return false;
  return /\.(webp|jpg|jpeg|png|mp4|mov)$/.test(k);
}

/** The key inside a public URL of ours, or null when the URL is someone else's. */
export function keyFromUrl(url: string): string | null {
  const cfg = storageConfig();
  if (!cfg) return null;
  const base = `${cfg.publicBase}/`;
  if (!String(url || "").startsWith(base)) return null;
  const key = String(url).slice(base.length).split("?")[0];
  return isAllowedKey(key) ? key : null;
}

/* ---------- signature version 4 ------------------------------------------ */

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986, and `/` survives — S3 signs the path segment by segment. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/** `20130524T000000Z` and `20130524`, the only two date formats SigV4 knows. */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export type SignInput = {
  method: string;
  url: string;
  /** Everything except host, x-amz-date and x-amz-content-sha256 — added here. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  now?: Date;
};

export type SignedRequest = {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  signedHeaders: string;
};

/**
 * The whole of SigV4 in one function, and it hands back its intermediate
 * strings — the canonical request and the string to sign are exactly what the
 * AWS test vectors publish, so the test can check the arithmetic rather than
 * only the happy path.
 */
export function signRequest(input: SignInput): SignedRequest {
  const region = input.region || R2_REGION;
  const service = input.service || R2_SERVICE;
  const u = new URL(input.url);
  const { amzDate, dateStamp } = amzDates(input.now || new Date());

  const headers: Record<string, string> = { host: u.host };
  for (const [k, v] of Object.entries(input.headers || {})) headers[k.toLowerCase()] = String(v).trim();
  headers["x-amz-content-sha256"] = input.payloadHash;
  headers["x-amz-date"] = amzDate;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].replace(/\s+/g, " ").trim()}\n`).join("");
  const signedHeaders = names.join(";");

  // R2 takes no query parameters on put/delete, but an empty canonical query
  // string is still a line of the canonical request.
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    input.method.toUpperCase(),
    encodePath(decodeURIComponent(u.pathname)),
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers.authorization =
    `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, canonicalRequest, stringToSign, signature, signedHeaders };
}

/* ---------- the two verbs ------------------------------------------------ */

function objectUrl(cfg: StorageConfig, key: string): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${encodePath(key)}`;
}

function requireConfig(): StorageConfig {
  const cfg = storageConfig();
  if (!cfg) throw new StorageError("storage_not_configured", 503);
  return cfg;
}

export type PutInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  /** Defaults to a year — every key carries its own timestamp. */
  cacheControl?: string;
};

export type PutResult = { key: string; url: string; bytes: number };

/** PUT one object. Throws StorageError on anything that is not a 2xx. */
export async function putObject(input: PutInput): Promise<PutResult> {
  const cfg = requireConfig();
  if (!isAllowedKey(input.key)) throw new StorageError("bad_key", 400, input.key);
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
  const url = objectUrl(cfg, input.key);
  const signed = signRequest({
    method: "PUT",
    url,
    headers: {
      "content-type": input.contentType,
      "content-length": String(body.length),
      "cache-control": input.cacheControl || "public, max-age=31536000, immutable",
    },
    payloadHash: sha256(body),
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });

  const res = await fetch(url, { method: "PUT", headers: signed.headers, body: body as unknown as BodyInit });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new StorageError("put_failed", 502, `${res.status} ${detail}`);
  }
  return { key: input.key, url: publicUrl(input.key), bytes: body.length };
}

/** DELETE one object. R2 answers 204 for a key that was never there. */
export async function deleteObject(key: string): Promise<void> {
  const cfg = requireConfig();
  if (!isAllowedKey(key)) throw new StorageError("bad_key", 400, key);
  const url = objectUrl(cfg, key);
  const signed = signRequest({
    method: "DELETE",
    url,
    payloadHash: sha256(""),
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });
  const res = await fetch(url, { method: "DELETE", headers: signed.headers });
  if (!res.ok && res.status !== 404) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new StorageError("delete_failed", 502, `${res.status} ${detail}`);
  }
}
