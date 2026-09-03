import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JWT sign/verify on node:crypto.
 *
 * Montonio's own examples reach for the `jsonwebtoken` package; we do not add
 * the dependency for two functions. Everything Montonio needs is here: HS256,
 * `exp`, `iat`, and a constant-time signature compare.
 *
 * Deliberately narrow: HS256 only. A token whose header names any other
 * algorithm is rejected rather than trusted — the classic "alg: none" and
 * "alg: RS256 with the HMAC key" downgrades both die at that check.
 */

export class JwtError extends Error {
  constructor(public readonly code: JwtErrorCode) {
    super(code);
    this.name = "JwtError";
  }
}

export type JwtErrorCode =
  | "jwt_malformed"
  | "jwt_alg"
  | "jwt_signature"
  | "jwt_expired"
  | "jwt_payload";

type JsonObject = Record<string, unknown>;

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function signature(signingInput: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(signingInput).digest());
}

/**
 * Sign a payload. `expiresInSeconds` stamps `exp` (Montonio wants 10 minutes
 * on order tokens); `iat` is always stamped.
 */
export function signHs256(
  payload: JsonObject,
  secret: string,
  opts: { expiresInSeconds?: number } = {},
): string {
  if (!secret) throw new JwtError("jwt_signature");
  const now = Math.floor(Date.now() / 1000);
  const body: JsonObject = { ...payload, iat: now };
  if (opts.expiresInSeconds && body.exp === undefined) {
    body.exp = now + opts.expiresInSeconds;
  }
  const header = b64urlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = b64urlEncode(Buffer.from(JSON.stringify(body)));
  const input = `${header}.${claims}`;
  return `${input}.${signature(input, secret)}`;
}

/**
 * Verify a token and return its claims. Throws JwtError on any failure —
 * callers translate that into a refusal, never into a paid order.
 */
export function verifyHs256<T extends JsonObject = JsonObject>(
  token: string,
  secret: string,
  opts: { clockToleranceSeconds?: number } = {},
): T {
  if (!secret) throw new JwtError("jwt_signature");
  if (typeof token !== "string") throw new JwtError("jwt_malformed");
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("jwt_malformed");
  const [headerB64, claimsB64, sigB64] = parts;

  let header: JsonObject;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString("utf8")) as JsonObject;
  } catch {
    throw new JwtError("jwt_malformed");
  }
  if (header.alg !== "HS256") throw new JwtError("jwt_alg");

  const expected = signature(`${headerB64}.${claimsB64}`, secret);
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a mismatch
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new JwtError("jwt_signature");
  }

  let claims: unknown;
  try {
    claims = JSON.parse(b64urlDecode(claimsB64).toString("utf8"));
  } catch {
    throw new JwtError("jwt_malformed");
  }
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    throw new JwtError("jwt_payload");
  }

  const exp = (claims as JsonObject).exp;
  if (typeof exp === "number") {
    const tolerance = opts.clockToleranceSeconds ?? 60;
    if (Math.floor(Date.now() / 1000) > exp + tolerance) {
      throw new JwtError("jwt_expired");
    }
  }
  return claims as T;
}
