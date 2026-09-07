/**
 * POST /api/search — the fourth and last pass of the shop's search.
 *
 *   { q: "cheveux gras", lang?: "RU"|"ET"|"EN" }
 *   → 200 { ok: true, terms: ["жирные волосы","oily",…], cached: false }
 *
 * The storefront asks ONLY when its own three passes came back with almost
 * nothing (public/shop2/app.js, askSearchAI): names, then descriptions in all
 * three languages, then the curated concern table answer nine phrases in ten
 * on their own, instantly and for nothing. So this route is rare by
 * construction — and every answer, including an empty one, is remembered for
 * a day (src/lib/search-terms.ts), so the same phrase is never billed twice
 * on one instance.
 *
 * Guards, the same posture as src/app/api/assistant/route.ts:
 *   · no OPENAI_API_KEY → 503 {enabled:false}, and the shop stops asking for
 *     the rest of the session;
 *   · same-origin only (a browser always sends Origin on a fetch POST);
 *   · 12 calls a minute per IP, in-memory, best-effort;
 *   · one short question, a small answer, temperature 0, JSON only.
 *
 * Nothing here can make the shop fail: every path that is not a clean answer
 * is a status code with an empty term list behind it, and the storefront
 * treats all of them the same — keep the results already on screen. The
 * model's words are search terms and nothing else; they are never shown.
 */
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/auth";
import { extractJsonObject } from "@/lib/ai-json";
import {
  buildSearchTermsPrompt,
  cachedTerms,
  cleanSearchQuery,
  cleanSearchTerms,
  isSearchLang,
  rememberTerms,
  searchCacheKey,
} from "@/lib/search-terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
/** Eight two-word terms in a JSON list — 120 is generous. */
const MAX_TOKENS = 120;
const NO_STORE = { "cache-control": "no-store" } as const;

/* The shop's own hosts — the same list src/app/api/assistant/route.ts keeps,
   for the same reason: a same-origin call is fine on any deployment URL, and
   anything genuinely cross-origin has to be one of these. */
const ALLOWED_HOSTS = new Set([
  "rempireshop.diipsolutions.eu",
  "www.rempireshop.diipsolutions.eu",
  "rempireshop.com",
  "www.rempireshop.com",
  "localhost:3300",
]);

function crossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // not a browser fetch; the checks below still apply
  try {
    const host = new URL(origin).host;
    const self = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    return host !== self && !ALLOWED_HOSTS.has(host);
  } catch {
    return true;
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, enabled: Boolean(process.env.OPENAI_API_KEY), model: MODEL }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (crossOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden", terms: [] }, { status: 403, headers: NO_STORE });
  }
  if (rateLimit("search-ai", clientIp(req), 12, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited", terms: [] }, { status: 429, headers: NO_STORE });
  }

  /* The body is read and checked BEFORE the key: a shop with no key answers
     the same 503 either way (the storefront's first call is always a good
     body, and that is what switches the asking off for the session), and
     doing it in this order means tests/fuzz-routes.test.ts really walks the
     validation instead of bouncing off an env check. */
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json", terms: [] }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "bad_json", terms: [] }, { status: 400, headers: NO_STORE });
  }
  const { q: rawQ, lang: rawLang } = body as { q?: unknown; lang?: unknown };
  const q = cleanSearchQuery(rawQ);
  if (!q) {
    return NextResponse.json({ ok: false, error: "bad_query", terms: [] }, { status: 400, headers: NO_STORE });
  }
  const lang = isSearchLang(rawLang) ? rawLang : "RU";

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, enabled: false, error: "disabled", terms: [] }, { status: 503, headers: NO_STORE });
  }

  const cacheKey = searchCacheKey(q, lang);
  const hit = cachedTerms(cacheKey);
  if (hit) {
    return NextResponse.json({ ok: true, terms: hit, cached: true }, { headers: NO_STORE });
  }

  const { system, user } = buildSearchTermsPrompt(q, lang);
  let data: unknown;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) {
      console.error("search-terms openai error", r.status, (await r.text()).slice(0, 200));
      return NextResponse.json({ ok: false, error: "upstream", terms: [] }, { status: 502, headers: NO_STORE });
    }
    data = await r.json();
  } catch {
    // an offline lambda, a DNS hiccup, a timeout — the shopper keeps the page
    return NextResponse.json({ ok: false, error: "upstream", terms: [] }, { status: 502, headers: NO_STORE });
  }

  const choice = (data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> })?.choices?.[0] ?? {};
  const extracted = extractJsonObject(choice.message?.content, { finishReason: choice.finish_reason });
  const terms = cleanSearchTerms(extracted.value);
  /* An empty answer is an answer: «what is my order number» has no catalogue
     words behind it, and remembering that is what keeps the next visitor who
     types it from costing anything at all. */
  rememberTerms(cacheKey, terms);
  return NextResponse.json({ ok: true, terms, cached: false }, { headers: NO_STORE });
}
