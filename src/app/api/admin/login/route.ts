/**
 * POST /api/admin/login  {password} → sets the rmp_admin cookie for 30 days.
 *
 * The password is compared against the scrypt digest in ADMIN_PASSWORD_HASH;
 * five tries a minute per IP, and a wrong password never says which half was
 * wrong.
 */
import { adminCookie, clientIp, rateLimit, verifyPassword } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("login", ip, 5, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  if (!process.env.ADMIN_PASSWORD_HASH) {
    console.error("[api/admin/login] ADMIN_PASSWORD_HASH is not set — nobody can sign in.");
    return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  }
  if (!process.env.SESSION_SECRET) {
    console.error("[api/admin/login] SESSION_SECRET is not set — no session can be signed.");
    return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  if (!verifyPassword(password)) {
    await writeAuditSafe(`ip:${ip}`, "admin.login.failed");
    return Response.json({ ok: false, error: "bad_password" }, { status: 401 });
  }

  await writeAuditSafe(`ip:${ip}`, "admin.login");
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": adminCookie(req), "cache-control": "no-store" } },
  );
}
