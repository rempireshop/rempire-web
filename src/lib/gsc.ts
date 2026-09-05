/**
 * Google Search Console — last 28 days, via a service account. No `googleapis`
 * dependency: the OAuth token is a JWT this signs by hand with node:crypto
 * (RS256), the same technique src/lib/payments/jwt.ts uses for Montonio.
 *
 * Env:
 *   GSC_SERVICE_ACCOUNT_JSON  the whole key file Google hands you when you
 *                             create the service account — its raw JSON text
 *                             (client_email + private_key are all this reads).
 *   GSC_SITE_URL              "sc-domain:rempireshop.com" — a domain property,
 *                             not a URL-prefix one, so http/https and www.
 *                             are one property.
 *
 * The service account must be added as a user of that property in Search
 * Console itself (Settings → Users and permissions → Add user, the
 * client_email, read access is enough) — GSC_SERVICE_ACCOUNT_JSON alone does
 * not grant access. See docs/analytics.md.
 *
 * The result (totals + top 20 queries + top 20 pages) is cached in
 * `settings.gsc_cache` for 24 hours — Search Console's own numbers lag by
 * 2-3 days anyway, so asking more often than that buys nothing and only
 * spends the API's quota. Missing env → {ok:false, error:"not_configured"},
 * checked BEFORE the cache so a shop that never configured this never grows
 * a stale row for it either.
 */
import { createSign } from "node:crypto";
import { getSettings, setSetting } from "@/lib/orders";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const CACHE_MS = 24 * 60 * 60 * 1000;

type ServiceAccount = { client_email: string; private_key: string };

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Escapes the line breaks that sit INSIDE string literals — what you get
 *  when the key file was pasted from a viewer that had already turned the
 *  private key's `\n` into real lines. Breaks between members are ordinary
 *  JSON whitespace and stay as they are. */
function escapeNewlinesInStrings(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") { out += c + (s[i + 1] ?? ""); i++; continue; }
      if (c === '"') inString = false;
      else if (c === "\n") { out += "\\n"; continue; }
      else if (c === "\r") continue;
    } else if (c === '"') inString = true;
    out += c;
  }
  return out;
}

/** The variable is pasted by a person into a web form, so the same key file
 *  arrives in a few shapes: as-is; wrapped in an extra pair of quotes; with
 *  real line breaks inside the private key; with the `\n` doubled to `\\n`;
 *  or base64-encoded. Every shape is Google's file underneath — read them all
 *  rather than send the owner back to the form with «bad key». */
function parseServiceAccountJson(raw: string): Record<string, unknown> | null {
  // a BOM from a Windows editor and the curly quotes a rich-text copy leaves
  // behind are not the owner's mistake to fix by hand
  const text = raw.replace(/^﻿/, "").replace(/[“”„]/g, '"').trim();
  const candidates: string[] = [text];
  const unquoted = text.replace(/^['"`]+/, "").replace(/['"`]+$/, "");
  if (unquoted !== text) candidates.push(unquoted);
  candidates.push(escapeNewlinesInStrings(text), escapeNewlinesInStrings(unquoted));
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && !text.startsWith("{")) {
    try {
      candidates.push(Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8"));
    } catch {
      /* not base64 — nothing to add */
    }
  }
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const j = parseServiceAccountJson(raw);
  if (!j) return null;
  if (typeof j.client_email !== "string" || typeof j.private_key !== "string" || !j.client_email || !j.private_key) {
    return null;
  }
  // a key whose `\n` arrived doubled would not sign; PEM needs real lines
  const private_key = j.private_key.includes("\\n") && !j.private_key.includes("\n")
    ? j.private_key.replace(/\\n/g, "\n")
    : j.private_key;
  return { client_email: j.client_email, private_key };
}

/** A short-lived (1 h) JWT asserting this service account, per RFC 7523. */
function signedJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${base64url(signer.sign(sa.private_key))}`;
}

/* Kept in memory across warm invocations only — well inside the token's own
   1 h expiry, and never written anywhere persistent (it is a bearer secret). */
let cachedToken: { token: string; exp: number } | null = null;

/** Tests only — forget the cached bearer token, so each test starts clean
 *  instead of silently reusing whatever an earlier test's fetch stub minted
 *  (the token's own validity is real wall-clock time, deliberately not the
 *  `now` a test passes to getSearchConsoleSummary() — a real Google token
 *  really would still be valid a simulated "36 hours later"). */
export function resetGscTokenCache(): void {
  cachedToken = null;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.exp - 60_000 > now) return cachedToken.token;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt(sa),
    }),
  });
  if (!r.ok) throw new Error(`gsc token exchange failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("gsc token exchange: no access_token in response");
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

type SearchRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function searchAnalyticsQuery(token: string, siteUrl: string, body: Record<string, unknown>): Promise<SearchRow[]> {
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`gsc searchAnalytics.query failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { rows?: SearchRow[] };
  return j.rows ?? [];
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last 28 FULL days. Search Console's own data lags 2-3 days, so the window
 *  ends 3 days back — otherwise the freshest few days would show as a
 *  misleading dip that is really just "not reported yet". */
function last28Days(now: Date): { startDate: string; endDate: string } {
  const end = new Date(now.getTime() - 3 * 86_400_000);
  const start = new Date(end.getTime() - 27 * 86_400_000);
  return { startDate: dateStr(start), endDate: dateStr(end) };
}

export type GscQueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscPageRow = { page: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscSummary = {
  ok: true;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: GscQueryRow[];
  topPages: GscPageRow[];
  fetchedAt: string;
  cached: boolean;
};
/** not_configured — no key / no site url; bad_key — the key variable is set
 *  but is not the JSON file Google hands out (a half-pasted file, a path
 *  instead of the contents, a key without client_email/private_key);
 *  fetch_failed — Google did not answer or refused (service account not
 *  added to the property, API not enabled). The first two are settings
 *  states the panel explains; the third is the one it calls an error. */
export type GscUnavailable = { ok: false; error: "not_configured" | "bad_key" | "fetch_failed"; shape?: KeyShape };

/** What a bad_key value looks like — never the value itself. The panel turns
 *  each into one plain sentence so the owner knows what to re-paste. */
export type KeyShape = "empty" | "pem_only" | "path" | "no_client_email" | "no_private_key" | "curly_quotes" | "not_json";

export function keyShape(raw: string): KeyShape {
  const t = raw.replace(/^﻿/, "").trim();
  if (!t) return "empty";
  if (!t.startsWith("{") && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) return "pem_only";
  if (/^[A-Za-z]:[\\/]|^\/|^~\//.test(t) || /^[\w.-]+\.json$/i.test(t)) return "path";
  if (/[“”„«»]/.test(t)) return "curly_quotes";
  const j = parseServiceAccountJson(t);
  if (!j) return "not_json";
  if (typeof j.client_email !== "string" || !j.client_email) return "no_client_email";
  if (typeof j.private_key !== "string" || !j.private_key) return "no_private_key";
  return "not_json";
}

/** settings.value comes back already-parsed from most call sites, but
 *  src/lib/orders.ts has at least one spot that still guards a jsonb column
 *  being a string — same defensive read here. */
function parsedCache(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** `now` is the caller's clock (real in production, fixed in tests) — comparing
 *  against the real Date.now() here would make the 24h cache untestable and,
 *  worse, would let the two clocks quietly disagree if this is ever called
 *  with a `now` that is not "right now" for some other reason. */
function freshCache(raw: unknown, now: Date): GscSummary | null {
  const c = parsedCache(raw);
  if (!c || c.ok !== true) return null;
  const fetchedAt = typeof c.fetchedAt === "string" ? Date.parse(c.fetchedAt) : NaN;
  if (!Number.isFinite(fetchedAt) || now.getTime() - fetchedAt > CACHE_MS) return null;
  return { ...(c as unknown as GscSummary), cached: true };
}

export async function getSearchConsoleSummary(now: Date = new Date()): Promise<GscSummary | GscUnavailable> {
  const sa = serviceAccount();
  const siteUrl = (process.env.GSC_SITE_URL ?? "").trim();
  const rawKey = process.env.GSC_SERVICE_ACCOUNT_JSON ?? "";
  if (!sa && rawKey.trim()) return { ok: false, error: "bad_key", shape: keyShape(rawKey) };
  if (!sa || !siteUrl) return { ok: false, error: "not_configured" };

  try {
    const settings = await getSettings();
    const cached = freshCache(settings.gsc_cache, now);
    if (cached) return cached;
  } catch (err) {
    // A cache we cannot read is not a reason to refuse a live fetch.
    console.error("[gsc] cache read failed, fetching live:", err);
  }

  try {
    const token = await accessToken(sa);
    const { startDate, endDate } = last28Days(now);
    const [totals, queries, pages] = await Promise.all([
      searchAnalyticsQuery(token, siteUrl, { startDate, endDate }),
      searchAnalyticsQuery(token, siteUrl, { startDate, endDate, dimensions: ["query"], rowLimit: 20 }),
      searchAnalyticsQuery(token, siteUrl, { startDate, endDate, dimensions: ["page"], rowLimit: 20 }),
    ]);
    const t = totals[0];
    const summary: GscSummary = {
      ok: true,
      clicks: t?.clicks ?? 0,
      impressions: t?.impressions ?? 0,
      ctr: t?.ctr ?? 0,
      position: t?.position ?? 0,
      topQueries: queries.map((r) => ({
        query: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
      })),
      topPages: pages.map((r) => ({
        page: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
      })),
      fetchedAt: now.toISOString(),
      cached: false,
    };
    try {
      await setSetting("gsc_cache", summary);
    } catch (err) {
      console.error("[gsc] cache write failed (serving the live answer anyway):", err);
    }
    return summary;
  } catch (err) {
    console.error("[gsc] fetch failed:", err);
    return { ok: false, error: "fetch_failed" };
  }
}
