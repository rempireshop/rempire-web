/**
 * The booking app's key to /api/partner/* (docs/partner-api.md), and its
 * budget there.
 *
 * REMPIRE booking (rempire.ee) is a separate app on its own server. It asks
 * this shop about its products, and it has no admin session to show: it
 * sends one shared secret instead,
 *
 *   Authorization: Bearer <BOOKING_API_SECRET>
 *
 * set to the same value on both sides (Vercel here, the booking app's host
 * there). Nothing else opens these routes — the admin cookie does not, and
 * src/middleware.ts never sees /api at all.
 *
 *   BOOKING_API_SECRET unset, or shorter than 16 characters
 *                         → 503 {"error":"not_configured"}: the door is shut,
 *                           and says so, rather than open to a guessable key.
 *                           The same sixteen-character floor as SESSION_SECRET
 *                           (src/lib/auth.ts).
 *   header missing, not Bearer, or another value
 *                         → 401 {"error":"unauthorized"}
 *
 * The compare is constant-time over SHA-256 digests, so neither the length
 * nor any prefix of the secret leaks through the answer's timing.
 *
 * Every answer of these routes carries `cache-control: no-store`: a price or
 * a stock count must never sit in a CDN or a browser cache.
 *
 * Route usage:
 *   const denied = requirePartner(req);
 *   if (denied) return denied;
 *   const over = partnerOverBudget("lookup");
 *   if (over) return over;
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { rateLimit, rateLimitWaitS } from "@/lib/auth";

export const PARTNER_SECRET_ENV = "BOOKING_API_SECRET";
const MIN_SECRET = 16;

export const PARTNER_NO_STORE = { "cache-control": "no-store" } as const;

/** A JSON answer of a partner route — always no-store. */
export function partnerJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PARTNER_NO_STORE });
}

function partnerSecret(): string | null {
  const s = process.env[PARTNER_SECRET_ENV];
  return typeof s === "string" && s.length >= MIN_SECRET ? s : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** True when the presented bearer token is the configured secret. */
export function partnerTokenOk(header: string | null, secret: string): boolean {
  if (!header) return false;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]), digest(secret));
}

/**
 * null when the request may go on; otherwise the answer to send back
 * (503 not_configured, or 401 unauthorized).
 */
export function requirePartner(req: Request): Response | null {
  const secret = partnerSecret();
  if (!secret) return partnerJson({ error: "not_configured" }, 503);
  if (!partnerTokenOk(req.headers.get("authorization"), secret)) {
    return partnerJson({ error: "unauthorized" }, 401);
  }
  return null;
}

/* ---------- the budget ----------------------------------------------------

   A leaked secret must not be able to run up the shop's OpenAI bill, nor
   lean on the catalogue. So each route has a ceiling, kept by the shop's own
   in-memory limiter (rateLimit() in src/lib/auth.ts): a Map in the serverless
   instance, nothing written to the database or anywhere else.

     lookup     120 requests a minute
     identify    20 photo matches a minute, and 500 a day

   identify counts only the requests that would reach OpenAI — a photo that
   passed every check, with a key configured — so a 400 or a 413 spends
   nothing and costs nothing. lookup counts every request that got past the
   secret. Over a ceiling → 429 {"error":"rate_limited"}, with Retry-After in
   whole seconds.

   One partner, one budget: the counters are not per address, because a
   stolen key can be used from anywhere. Only requests that showed the right
   secret are counted, so a stranger cannot spend the booking app's budget.

   «Per instance», plainly: Vercel Fluid Compute keeps a warm instance and
   reuses it, so for one barbershop's traffic this is one counter most of the
   day. A cold start or a second instance starts its own, so the hard bound
   is 500 photo matches a day for each instance alive at the same time. A
   counter shared by every instance would need a database write per request;
   this version writes nothing (docs/partner-api.md § «Limits»). */

type Ceiling = { bucket: string; max: number; windowMs: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const PARTNER_LIMITS = {
  lookup: [{ bucket: "partner-lookup-min", max: 120, windowMs: MINUTE }],
  identify: [
    { bucket: "partner-identify-min", max: 20, windowMs: MINUTE },
    { bucket: "partner-identify-day", max: 500, windowMs: DAY },
  ],
} as const satisfies Record<string, readonly Ceiling[]>;

export type PartnerBudget = keyof typeof PARTNER_LIMITS;

/** The one key every counter is kept under — see «One partner, one budget». */
const PARTNER = "booking";

/**
 * null while the route is inside its budget (and counts this request);
 * otherwise the 429 to send back. The minute is asked first, so a request
 * the minute refuses does not use up a place in the day.
 */
export function partnerOverBudget(kind: PartnerBudget): Response | null {
  for (const c of PARTNER_LIMITS[kind]) {
    if (rateLimit(c.bucket, PARTNER, c.max, c.windowMs)) {
      const wait = Math.max(1, rateLimitWaitS(c.bucket, PARTNER));
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { ...PARTNER_NO_STORE, "retry-after": String(wait) } },
      );
    }
  }
  return null;
}
