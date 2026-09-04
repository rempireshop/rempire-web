/**
 * GET /api/giftcards/<code>/pdf/?t=<token> — the printable gift card.
 *
 * The link is what the gift-card letter, the receipt screen and the admin order
 * card all point at. `t` is an HMAC of the code under SESSION_SECRET
 * (src/lib/giftcard-pdf.ts giftPdfToken): the address cannot be derived from a
 * code somebody guessed, and the code cannot be derived from a URL somebody
 * scraped. Anything that does not verify is a 404, not a 403 — a wrong token
 * must not confirm that the code behind it exists.
 *
 * Where the bytes come from: the copy stored in R2 on the paid transition
 * (`giftcards/<code>.pdf`) when the bucket is configured, otherwise rendered on
 * demand. Both paths produce the same page — the store is a cache, not the
 * source of truth.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import {
  buildGiftCardPdf,
  fetchStoredGiftCardPdf,
  giftPdfFilename,
  storeGiftCardPdf,
  verifyGiftPdfToken,
} from "@/lib/giftcard-pdf";
import { getGiftCard, giftValidUntil, normaliseCode } from "@/lib/giftcards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const notFound = () => Response.json({ ok: false, error: "not_found" }, { status: 404 });

export async function GET(req: Request, ctx: Ctx) {
  /* A card is downloaded once or twice, by the person who was sent the link.
     Loose enough that reprinting it never locks anybody out, tight enough that
     the token is not something to grind against. */
  if (rateLimit("giftcard-pdf", clientIp(req), 30, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const { code: raw } = await ctx.params;
  const code = normaliseCode(decodeURIComponent(String(raw ?? "")));
  if (!code) return notFound();
  if (!verifyGiftPdfToken(code, new URL(req.url).searchParams.get("t"))) return notFound();

  let card;
  try {
    card = await getGiftCard(code);
  } catch (err) {
    console.error("[api/giftcards/pdf] lookup failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!card) return notFound();

  let bytes = await fetchStoredGiftCardPdf(code);
  if (!bytes) {
    try {
      bytes = await buildGiftCardPdf({
        code: card.code,
        amount: card.amount,
        lang: card.lang,
        createdAt: card.createdAt,
        validUntil: giftValidUntil(card.createdAt),
        recipient: card.recipient,
      });
    } catch (err) {
      // The fonts are the one thing this route cannot do without, and a
      // deployment that lost them is a misconfiguration, not a bad request.
      console.error("[api/giftcards/pdf] render failed:", err);
      return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    // Keep the copy for next time — a no-op without a bucket, never fatal.
    await storeGiftCardPdf(code, bytes);
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${giftPdfFilename(code)}"`,
      "content-length": String(bytes.length),
      // The card never changes, but the URL is a bearer link: private only.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
