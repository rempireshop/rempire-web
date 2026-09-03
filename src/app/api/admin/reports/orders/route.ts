/**
 * GET /api/admin/reports/orders — the accountant export.
 *
 *   ?month=YYYY-MM                       (the admin's month picker)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD       (either works; `to` is inclusive)
 *   &format=csv|xlsx|json                (default json — summary + rows, for the admin card)
 *
 * One row per order that reached payment (status paid/shipped/refunded —
 * "shipped" is a paid order that moved on, "refunded" is still worth a line
 * so the accountant sees the reversal). VAT is split out of the
 * VAT-inclusive `total` at settings.vat_rate (src/lib/reports.ts —
 * DEFAULT_VAT_RATE 24, Estonia's standard rate since 1 July 2025). `channel`
 * reads `orders.channel` when that column exists (checked once, cached —
 * see ordersHasChannelColumn) and falls back to "web" for every row when it
 * does not, so this route works whether or not the inventory agent's POS
 * column has landed.
 *
 * xlsx is a hand-rolled, dependency-free OOXML writer (src/lib/reports.ts —
 * the `xlsx` npm package is ~7.5 MB unpacked, over the task's "≤ 1 MB or
 * write CSV" bar); csv carries a UTF-8 BOM and a `;` delimiter for Excel on
 * an Estonian/Russian Windows install.
 */
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/orders";
import {
  explicitRange,
  listReportOrders,
  monthRange,
  ordersToCsv,
  ordersToXlsx,
  resolveVatRate,
  summarize,
} from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const month = (url.searchParams.get("month") || "").trim();
  const fromQ = (url.searchParams.get("from") || "").trim();
  const toQ = (url.searchParams.get("to") || "").trim();
  const format = (url.searchParams.get("format") || "json").toLowerCase();

  const range = month ? monthRange(month) : fromQ && toQ ? explicitRange(fromQ, toQ) : null;
  if (!range) {
    return Response.json(
      { ok: false, error: "bad_range", detail: "pass ?month=YYYY-MM or ?from=YYYY-MM-DD&to=YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (!["csv", "xlsx", "json"].includes(format)) {
    return Response.json({ ok: false, error: "bad_format" }, { status: 400 });
  }

  try {
    const settings = await getSettings();
    const vatRate = resolveVatRate(settings.vat_rate);
    const rows = await listReportOrders(range.from, range.to, vatRate);
    const stamp = `${range.from}_${range.to}`;

    if (format === "csv") {
      return new Response(ordersToCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="rempire-orders-${stamp}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    if (format === "xlsx") {
      const buf = ordersToXlsx(rows);
      return new Response(buf, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="rempire-orders-${stamp}.xlsx"`,
          "cache-control": "no-store",
          "content-length": String(buf.length),
        },
      });
    }

    return Response.json(
      { ok: true, from: range.from, to: range.to, vatRate, summary: summarize(rows), rows },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/admin/reports/orders] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
