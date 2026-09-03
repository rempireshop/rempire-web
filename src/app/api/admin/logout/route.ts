/** POST /api/admin/logout — drops the rmp_admin cookie. */
import { clearAdminCookie, clientIp } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await writeAuditSafe(`ip:${clientIp(req)}`, "admin.logout");
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": clearAdminCookie(req), "cache-control": "no-store" } },
  );
}
