/**
 * POST /api/partner/products/identify — «what is this bottle?» from a photo
 * (docs/partner-api.md). Behind BOOKING_API_SECRET (src/lib/partner-auth.ts).
 *
 * Body: {"image": "data:image/jpeg;base64,…", "lang"?: "ru"|"et"|"en"}
 *       JPEG, PNG or WebP, at most 2 MB once decoded.
 *
 * The shop's own OpenAI key (OPENAI_API_KEY, the model src/lib/openai-chat.ts
 * picks) is shown the photo and a numbered list of the on-sale products —
 * brand, name, sizes, one short line each — and answers with up to three
 * numbers. Nothing else goes to OpenAI: no price, no stock. The photo is not
 * stored here, and nothing is written anywhere.
 *
 *   200 {"items": [Product, … up to 3]}  best first; [] when nothing fits
 *   400 {"error": "bad_request"}        not a JPEG/PNG/WebP data URL
 *   413 {"error": "too_large"}          over 2 MB decoded
 *   429 {"error": "rate_limited"}       past 20 photo matches a minute or 500 a
 *                                       day (src/lib/partner-auth.ts), with
 *                                       Retry-After; counted only for a photo
 *                                       that would go to OpenAI
 *   503 {"error": "not_configured"}     no OPENAI_API_KEY (or no BOOKING_API_SECRET)
 *   502 {"error": "upstream"}           OpenAI could not be reached, or refused
 */
import { extractJsonObject } from "@/lib/ai-json";
import { chatParams, openaiModel } from "@/lib/openai-chat";
import { partnerJson, partnerOverBudget, requirePartner } from "@/lib/partner-auth";
import {
  findRow,
  identifyCandidates,
  loadPartnerCatalog,
  PARTNER_LANGS,
  productsOf,
  type PartnerLang,
} from "@/lib/partner-products";
import type { CatalogueLevelRow } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/* base64 is 4/3 of the bytes, plus the JSON around it */
const MAX_BODY_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;
const MAX_MATCHES = 3;
const MAX_TOKENS = 120;
const TIMEOUT_MS = 25_000;

const BAD = { error: "bad_request" } as const;
const TOO_LARGE = { error: "too_large" } as const;
const UPSTREAM = { error: "upstream" } as const;

const DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/;

/** Does the decoded file really start like the type it claims? */
function sniff(kind: string, b: Buffer): boolean {
  if (kind === "jpeg" || kind === "jpg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (kind === "png") return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === "webp") return b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";
  return false;
}

const SYSTEM =
  "You identify a retail hair, beard or skin care product in a photo taken in a barbershop. " +
  "Choose only from the numbered catalogue (number|brand|name|sizes). " +
  'Answer JSON only: {"matches":[{"n":<catalogue number>,"s":<size number from 1, or 0 if unsure>}]}, ' +
  "best match first, at most 3, and an empty list when no catalogue product is in the photo.";

export async function POST(req: Request) {
  const denied = requirePartner(req);
  if (denied) return denied;

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return partnerJson(BAD, 400);
  }
  if (raw.length > MAX_BODY_CHARS) return partnerJson(TOO_LARGE, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return partnerJson(BAD, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return partnerJson(BAD, 400);
  const { image, lang: langRaw } = body as { image?: unknown; lang?: unknown };

  const langStr = langRaw == null ? "ru" : typeof langRaw === "string" ? langRaw.trim().toLowerCase() : "";
  if (!(PARTNER_LANGS as readonly string[]).includes(langStr)) return partnerJson(BAD, 400);
  const lang = langStr as PartnerLang;

  if (typeof image !== "string") return partnerJson(BAD, 400);
  const m = DATA_URL.exec(image.trim());
  if (!m) return partnerJson(BAD, 400);
  const bytes = Buffer.from(m[2].replace(/[\r\n]/g, ""), "base64");
  if (!bytes.length) return partnerJson(BAD, 400);
  if (bytes.length > MAX_IMAGE_BYTES) return partnerJson(TOO_LARGE, 413);
  if (!sniff(m[1], bytes)) return partnerJson(BAD, 400);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return partnerJson({ error: "not_configured" }, 503);

  /* Every check is behind us, so this photo goes to OpenAI: count it here and
     nowhere earlier — a refused body costs nothing and spends nothing. */
  const over = partnerOverBudget("identify");
  if (over) return over;

  try {
    const cat = await loadPartnerCatalog();
    const cands = identifyCandidates(cat);
    if (!cands.length) return partnerJson({ items: [] });
    const list = cands
      .map((c, i) => {
        const sizes = c.sizes.filter(Boolean);
        return `${i + 1}|${c.brand}|${c.name}` + (sizes.length ? `|${sizes.map((s, k) => `${k + 1}:${s}`).join(";")}` : "");
      })
      .join("\n");
    const mime = m[1] === "jpg" ? "jpeg" : m[1];

    let data: unknown;
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          ...chatParams(openaiModel(), { maxTokens: MAX_TOKENS, temperature: 0 }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: [
                { type: "text", text: list },
                { type: "image_url", image_url: { url: `data:image/${mime};base64,${bytes.toString("base64")}`, detail: "low" } },
              ],
            },
          ],
        }),
      });
      if (!r.ok) {
        console.error("[api/partner/products/identify] openai error", r.status, (await r.text()).slice(0, 200));
        return partnerJson(UPSTREAM, 502);
      }
      data = await r.json();
    } catch (err) {
      console.error("[api/partner/products/identify] openai unreachable:", err instanceof Error ? err.message : err);
      return partnerJson(UPSTREAM, 502);
    }

    const choice = (data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> })?.choices?.[0] ?? {};
    const value = extractJsonObject(choice.message?.content, { finishReason: choice.finish_reason }).value as
      | { matches?: unknown }
      | null;
    /* An answer with no usable list in it is «no match», not an outage — the
       same reading POST /api/search/ gives a reply it cannot use. */
    const matches = value && typeof value === "object" && Array.isArray(value.matches) ? value.matches : [];

    /* The model's numbers back to shelf rows: a size it named, or every size
       of the product when it could not tell — never more than three rows. */
    const rows: CatalogueLevelRow[] = [];
    const seen = new Set<string>();
    for (const hit of matches) {
      if (rows.length >= MAX_MATCHES) break;
      const n = Number((hit as { n?: unknown })?.n);
      const s = Number((hit as { s?: unknown })?.s);
      const c = Number.isInteger(n) && n >= 1 && n <= cands.length ? cands[n - 1] : null;
      if (!c) continue;
      const named = c.sizes.filter(Boolean);
      const sizes = Number.isInteger(s) && s >= 1 && s <= named.length ? [named[s - 1]] : c.sizes;
      for (const v of sizes) {
        if (rows.length >= MAX_MATCHES) break;
        const k = c.productId + "\u0000" + v;
        if (seen.has(k)) continue;
        seen.add(k);
        const row = findRow(cat, c.productId, v);
        if (row) rows.push(row);
      }
    }
    return partnerJson({ items: await productsOf(cat, rows, lang) });
  } catch (err) {
    console.error("[api/partner/products/identify] failed:", err);
    return partnerJson({ error: "server_error" }, 500);
  }
}
