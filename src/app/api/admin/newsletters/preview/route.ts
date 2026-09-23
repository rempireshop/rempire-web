/**
 * POST /api/admin/newsletters/preview/  { lang, title?, subject?, blocks?, body?, products? }
 *   → { ok, lang, subject, html, text, ready }
 *
 * «Как увидит покупатель» — the letter under the block editor, redrawn while
 * the owner builds it, before anything is saved. The draft is cleaned exactly
 * as a save would clean it and rendered by the same function the send uses
 * (src/lib/newsletters.ts renderNewsletterDraft), so the picture on the
 * phone is the letter and not a drawing of one.
 *
 * The panel puts `html` into a sandboxed <iframe srcdoc> (no scripts; links
 * open in a new tab — hence the <base target="_blank"> added here and only
 * here, so a tap on a banner in the preview shows where it leads without
 * leaving the editor). `ready` is the languages the letter could go out in
 * right now — the panel says who would get the Russian one instead.
 *
 * Behind requireAdmin like every other door under /api/admin/newsletters/.
 * Nothing is written. NB trailing slash — next.config has trailingSlash: true.
 */
import { requireAdmin } from "@/lib/auth";
import { normalizeLangCode } from "@/lib/customers";
import { loadNewsletterBrand, renderNewsletterDraft } from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
/* The same ceiling as a save (../route.ts): what cannot be saved is not previewed. */
const MAX_BYTES = 400_000;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

/** Links in the preview open beside the editor, never inside the frame. (Not exported: a route file exports verbs only.) */
function previewHtml(html: string): string {
  return html.replace(/<head>/i, '<head>\n<base target="_blank">');
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let raw: string;
  try {
    raw = (await req.text()) || "{}";
  } catch {
    return bad("bad_request");
  }
  if (raw.length > MAX_BYTES) return bad("too_large", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("bad_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("bad_request");
  const input = body as Record<string, unknown>;
  const lang = normalizeLangCode(input.lang);

  try {
    await loadNewsletterBrand();
    const { mail, ready } = await renderNewsletterDraft(input, lang);
    return Response.json(
      { ok: true, lang, subject: mail.subject, html: previewHtml(mail.html), text: mail.text, ready },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/admin/newsletters/preview] failed:", err);
    return bad("unavailable", 503);
  }
}
