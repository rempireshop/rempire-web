/**
 * GET /api/admin/customers?q=&tier=&limit= — the «Клиенты» tab's list.
 *
 * `tier` — "" (everyone), "retail", "pro", or "pending" (asked for pro,
 * not yet decided — customers.pro_requested_at is not null and tier is
 * still 'retail'). `q` matches e-mail, name, phone or company.
 *
 * `?format=csv` answers the same rows as a CSV download instead of JSON —
 * see customersToCsv() in src/lib/loyalty.ts.
 */
import { requireAdmin } from "@/lib/auth";
import { customersToCsv, listCustomersAdmin } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const tierParam = url.searchParams.get("tier") ?? "";
  const tier = tierParam === "retail" || tierParam === "pro" || tierParam === "pending" ? tierParam : "";

  try {
    const customers = await listCustomersAdmin({
      q: url.searchParams.get("q") ?? undefined,
      tier,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });

    if (url.searchParams.get("format") === "csv") {
      return new Response(customersToCsv(customers), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="customers.csv"',
          "cache-control": "no-store",
        },
      });
    }

    return Response.json({ ok: true, customers }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/customers] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
