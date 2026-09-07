/**
 * GET /shop2/<anything> — the shop's 404, and only that.
 *
 * Where this sits in the routing order matters, so it is worth stating: Vercel
 * answers a prerendered `index.html` in the filesystem phase, next.config.ts's
 * `afterFiles` rewrites do the same locally, then Next's own dynamic routes get
 * their turn — this one and the more specific `p/[id]`, `blog`, `blog/[slug]`
 * and `og/[file]` beside it — and only then does the `/shop2/:path+` fallback
 * rewrite hand out the shell. So every real page is already served before this
 * route is reached; what arrives here is either one of the screens that live
 * only in the browser (they get the shell at 200, exactly as before) or an
 * address the shop has no page for, which now gets a real 404 instead of the
 * home page at 200 — Dim, 07.09.2026. src/lib/notfound-page.ts decides which,
 * on the same shapes app.js's own router accepts.
 *
 * A catch-all cannot match `/shop2/` itself (it needs a segment), and the more
 * specific routes above win over it, so nothing that already worked changes.
 */
import { notFoundPageResponse } from "@/lib/notfound-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return notFoundPageResponse(new URL(req.url).pathname);
}
