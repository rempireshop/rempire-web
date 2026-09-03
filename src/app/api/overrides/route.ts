/**
 * GET /api/overrides — everything the storefront needs to render the owner's
 * edits: per-product overrides (price, stock, SEO, subcategory, variant photo
 * order, video, the photo gallery he uploaded) and the shop settings (chat bot
 * on/off, the home-page banner, mail flows, shipping rules).
 *
 * Public and cached at the edge for half a minute — a price change is visible
 * within 30 s, and a burst of shoppers costs one query. "Public" is meant
 * literally, so only the keys in PUBLIC_SETTINGS below leave the server.
 *
 * When there is no database the shop must still work, so the answer is a plain
 * 503 with {ok:false}; public/shop2/app.js falls back to its localStorage copy.
 */
import { mergeContent } from "@/lib/content";
import { getOverrides, getSettings } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SETTINGS: Record<string, unknown> = {
  chatbot: true,
  bundles: true,
  // the home-page banner: null means «стандартный» — app.js draws its built-in
  // slides. An object is { slides: [...], interval } written by the owner.
  hero: null,
  flows: { abandoned: false, birthday: false, backstock: true },
  shipping: {},
};

/**
 * The settings this route is allowed to publish.
 *
 * `settings` is a free-form key/value table — PUT /api/admin/settings takes any
 * key matching /^[a-z0-9_.-]{1,64}$/i with an arbitrary jsonb value. Serving all
 * of it made every future note-to-self, token or internal flag a public
 * document, cached at the edge for 30 s (audit M1). A key that is not on this
 * list stays on the server until someone puts it here on purpose.
 */
const PUBLIC_SETTINGS = [
  "chatbot",
  "bundles",
  "hero",
  "flows",
  "shipping",
  "shipping_rules",
  // the shop's own words about itself — company details, hours, socials, the
  // announcement bar, the contact page. Public by nature: every one of these
  // strings is printed in the footer of every page.
  "content",
] as const;

export async function GET() {
  try {
    const [overrides, stored] = await Promise.all([getOverrides(), getSettings()]);
    const published = Object.fromEntries(
      Object.entries(stored).filter(([k]) => (PUBLIC_SETTINGS as readonly string[]).includes(k)),
    );
    /* `content` is the one setting that is a document rather than a value: a
       spread would let a half-written row erase the company name, so it is
       merged onto the defaults (and sanitised on the way) instead. */
    const content = mergeContent(published.content);
    return Response.json(
      { ok: true, overrides, settings: { ...DEFAULT_SETTINGS, ...published, content } },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[api/overrides] unavailable:", err);
    return Response.json(
      { ok: false, error: "db_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
