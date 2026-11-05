/**
 * GET  /api/admin/migrate — which migrations are applied / pending.
 * POST /api/admin/migrate — apply the pending ones.
 *
 * Normally unnecessary: `npm run build` runs `tools/migrate.mjs --if-configured`
 * after every deploy. This is the manual fallback for a database that was
 * connected after the build, or for checking state from the admin screen.
 *
 * A migration writes through exec(), which src/lib/db.ts does not read for
 * cache purges, and no deploy follows this one to start the CDN afresh — so
 * once anything was applied, every tagged public answer is dropped here
 * (they are kept for up to a day: src/lib/feed-cache.ts).
 */
import { requireAdmin } from "@/lib/auth";
import { refreshBlogCache } from "@/lib/blog-cache";
import { refreshFeedCache } from "@/lib/feed-cache";
import { refreshHiddenCache } from "@/lib/hidden-cache";
import { migratePending, migrationStatus } from "@/lib/migrate";
import { writeAuditSafe } from "@/lib/orders";
import { refreshReviewsCache } from "@/lib/reviews-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, ...(await migrationStatus()) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/migrate] status failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const result = await migratePending();
    if (result.applied.length) {
      // each never throws: the migration is already applied
      refreshFeedCache();
      refreshHiddenCache();
      refreshReviewsCache();
      refreshBlogCache();
    }
    await writeAuditSafe("admin", "db.migrate", result);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    /* The detail goes to the log, not to the browser: a Postgres error carries
       table names, column names and sometimes a role or host (audit L2). */
    console.error("[api/admin/migrate] failed:", err);
    return Response.json({ ok: false, error: "migrate_failed" }, { status: 500 });
  }
}
