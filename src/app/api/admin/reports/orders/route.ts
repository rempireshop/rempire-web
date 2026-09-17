/**
 * GET /api/admin/reports/orders — the accountant export.
 *
 *   ?month=YYYY-MM                       (the admin's month picker)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD       (either works; `to` is inclusive)
 *   &format=csv|xlsx|json                (default json — summary + rows, for the admin card)
 *
 * One row per order that reached payment (status paid/shipped/delivered/
 * refunded — "shipped" and "delivered" are a paid order that moved on,
 * "refunded" is still worth a line so the accountant sees the reversal).
 *
 * VAT is split out of the VAT-inclusive `total` AT THE RATE EACH ORDER CARRIES
 * — never at the shop's current setting. This route used to read
 * settings.vat_rate on every request and hand it to every row, so a month
 * already filed came back restated the day the owner corrected the rate; a
 * re-export of March and March's original sheet disagreed, with nothing on
 * either to say which the tax office had. Where a row's rate comes from, and
 * what happens to an order written before it was recorded, is one function
 * with the reasoning beside it: rateFor() in src/lib/reports.ts. This file
 * deliberately no longer reads the setting at all.
 *
 * `channel` and `vat_rate` are each read only when the column exists (checked
 * once, cached — ordersHasChannelColumn / ordersHasVatRateColumn); `channel`
 * falls back to "web" for every row and `vat_rate` to rateFor()'s fallback, so
 * the export works on a deployment that is a migration behind rather than
 * answering 503.
 *
 * xlsx is a hand-rolled, dependency-free OOXML writer (src/lib/reports.ts —
 * the `xlsx` npm package is ~7.5 MB unpacked, over the task's "≤ 1 MB or
 * write CSV" bar); csv carries a UTF-8 BOM and a `;` delimiter for Excel on
 * an Estonian/Russian Windows install.
 */
import { requireAdmin } from "@/lib/auth";
import {
  explicitRange,
  listReportOrders,
  monthRange,
  ordersToCsv,
  ordersToXlsx,
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
    const rows = await listReportOrders(range.from, range.to);
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

    /* No top-level `vatRate` any more. A month that straddles a rate change
       has rows at two different rates, so one figure for the whole export was
       never able to be true — and the one that used to be reported here was
       the live setting, which is precisely the number this export must not be
       influenced by. Each row carries its own `vatRate` column instead, in the
       JSON exactly as in the CSV and the xlsx. */
    return Response.json(
      { ok: true, from: range.from, to: range.to, summary: summarize(rows), rows },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/admin/reports/orders] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
