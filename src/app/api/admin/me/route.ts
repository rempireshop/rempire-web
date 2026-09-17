/**
 * GET /api/admin/me — "is this browser signed in?"
 *
 * The admin screen asks on boot: 200 means show the panel, 401 means show the
 * login card. It also reports whether the server has an admin password at all,
 * so a fresh deployment can say so instead of failing silently.
 */
import { isAdmin, sessionSecretOk } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* sessionSecretOk(), not the bare env var: a SESSION_SECRET under sixteen
     characters cannot sign a session (makeSessionToken throws on it), so a
     deployment carrying one is NOT configured — saying otherwise here left the
     panel with no way to tell a wrong password from an unusable secret. */
  const configured = Boolean(process.env.ADMIN_PASSWORD_HASH) && sessionSecretOk();
  if (!isAdmin(req)) {
    return Response.json(
      { ok: false, error: "unauthorized", configured },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json({ ok: true, admin: true, configured }, { headers: { "cache-control": "no-store" } });
}
